import os
import re
import uuid
from datetime import datetime, timezone

import requests
from pymongo import ASCENDING, DESCENDING, MongoClient

MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "KorczakControl").strip() or "KorczakControl"
BUSCAS_COLLECTION = os.getenv("MONGODB_BUSCAS_COLLECTION", "Buscas").strip() or "Buscas"
SEARXNG_URL = os.getenv("SEARXNG_URL", "").strip().rstrip("/")
SEARCH_MAX_RESULTS = max(1, min(int(os.getenv("SEARCH_MAX_RESULTS", "8")), 20))
SEARCH_RATE_LIMIT = max(1, int(os.getenv("SEARCH_RATE_LIMIT", "30")))

_client = None
_collection = None
_indexes_ready = False


def _now():
    return datetime.now(timezone.utc).isoformat()


def _db():
    global _client, _collection, _indexes_ready
    if not MONGODB_URI:
        raise RuntimeError("MONGODB_URI não configurado")
    if _collection is None:
        _client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            socketTimeoutMS=15000,
            appname="KorczakAI",
        )
        _collection = _client[MONGODB_DATABASE][BUSCAS_COLLECTION]
    if not _indexes_ready:
        _collection.create_index([("id_usuario", ASCENDING), ("query_normalized", ASCENDING), ("created_at", DESCENDING)])
        _collection.create_index([("id_usuario", ASCENDING), ("terms", ASCENDING), ("created_at", DESCENDING)])
        _collection.create_index([("id_chat", ASCENDING), ("created_at", DESCENDING)])
        _indexes_ready = True
    return _collection


def normalize_query(query):
    value = re.sub(r"\s+", " ", str(query or "").strip().casefold())[:500]
    return value


def _terms(query):
    words = re.findall(r"[\wÀ-ÿ]{3,}", normalize_query(query), re.UNICODE)
    stop = {"para", "com", "uma", "por", "sobre", "como", "que", "dos", "das", "the", "and", "com"}
    return list(dict.fromkeys(w for w in words if w not in stop))[:20]


def _clean_result(item):
    if not isinstance(item, dict):
        return None
    url = str(item.get("url") or "").strip()
    title = str(item.get("title") or "").strip()
    content = str(item.get("content") or item.get("snippet") or "").strip()
    if not url.startswith(("http://", "https://")) or not title:
        return None
    return {"title": title[:300], "url": url[:1500], "snippet": content[:1600]}


def _search_searxng(query):
    if not SEARXNG_URL:
        raise RuntimeError("SEARXNG_URL não configurado")
    response = requests.get(
        f"{SEARXNG_URL}/search",
        params={"q": query, "format": "json", "language": "pt-BR", "safesearch": 1},
        headers={"Accept": "application/json", "User-Agent": "KorczakAI/1.0"},
        timeout=(5, 15),
    )
    response.raise_for_status()
    payload = response.json()
    raw_results = payload.get("results", [])
    results = []
    for item in raw_results:
        cleaned = _clean_result(item)
        if cleaned:
            results.append(cleaned)
        if len(results) >= SEARCH_MAX_RESULTS:
            break
    return results


def _related_history(user_id, query, chat_id=None, limit=5):
    if not user_id or not MONGODB_URI:
        return []
    terms = _terms(query)
    if not terms:
        return []
    clauses = [{"terms": {"$in": terms}}]
    if chat_id:
        clauses.append({"id_chat": chat_id})
    try:
        cursor = _db().find(
            {"id_usuario": user_id, "$or": clauses},
            {"_id": 0, "id": 1, "id_usuario": 1, "id_chat": 1, "query": 1, "results": 1, "created_at": 1},
        ).sort("created_at", DESCENDING).limit(max(1, min(limit, 10)))
        return list(cursor)
    except Exception:
        return []


def related_context(user_id, query, chat_id=None, limit=5):
    documents = _related_history(user_id, query, chat_id, limit)
    if not documents:
        return []
    context = []
    for document in documents:
        context.append(
            {
                "query": document.get("query", ""),
                "results": document.get("results", [])[:SEARCH_MAX_RESULTS],
                "created_at": document.get("created_at"),
            }
        )
    return context


def search_and_store(query, user_id, chat_id=None):
    normalized = normalize_query(query)
    if not normalized:
        return {"results": [], "previous": [], "stored": False}
    if not user_id:
        raise ValueError("ID do usuário é obrigatório")
    previous = related_context(user_id, normalized, chat_id, limit=5)
    results = _search_searxng(normalized)
    document = {
        "id": str(uuid.uuid4()),
        "id_usuario": str(user_id),
        "id_chat": str(chat_id) if chat_id else None,
        "query": normalized,
        "query_normalized": normalized,
        "terms": _terms(normalized),
        "results": results,
        "created_at": _now(),
        "provider": "searxng",
        "result_count": len(results),
    }
    _db().insert_one(document)
    return {"results": results, "previous": previous, "stored": True, "search_id": document["id"]}


def healthcheck():
    if not SEARXNG_URL:
        return False
    try:
        response = requests.get(f"{SEARXNG_URL}/config", timeout=(2, 4), headers={"Accept": "application/json"})
        return response.ok
    except requests.RequestException:
        return False
