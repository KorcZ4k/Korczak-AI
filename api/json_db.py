import os
import uuid
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument

DEFAULT_MODEL = os.getenv("MODEL", "qwen2.5:0.5b").strip() or "qwen2.5:0.5b"
MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "KorczakControl").strip() or "KorczakControl"
CHATS_COLLECTION = os.getenv("MONGODB_CHATS_COLLECTION", "Chats").strip() or "Chats"

_client = None
_collection = None
_indexes_ready = False


def now():
    return datetime.now(timezone.utc).isoformat()


def _collection():
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
        _collection = _client[MONGODB_DATABASE][CHATS_COLLECTION]
    if not _indexes_ready:
        _collection.create_index([("usuario", ASCENDING), ("metadata.updated_at", DESCENDING)])
        _collection.create_index([("usuario", ASCENDING), ("id", ASCENDING)], unique=True)
        _indexes_ready = True
    return _collection


def _normalize(chat):
    chat = dict(chat or {})
    chat.pop("_id", None)
    chat.setdefault("id", str(uuid.uuid4()))
    chat.setdefault("nome", "Nova conversa")
    chat.setdefault("instrucoes", "")
    chat.setdefault("modelo", DEFAULT_MODEL)
    chat.setdefault("memoria", [])
    chat.setdefault("memoria_automatica", [])
    chat.setdefault("fontes", [])
    chat.setdefault("fontes_web", [])
    chat.setdefault("mensagens", [])
    chat.setdefault("usuario", None)
    chat.setdefault("preferencias", {"temperature": 0.35, "web_search": True})
    chat.setdefault("metadata", {})
    chat["metadata"].setdefault("created_at", now())
    chat["metadata"].setdefault("updated_at", chat["metadata"]["created_at"])
    return chat


def _safe_list(value, max_items=100):
    return value if isinstance(value, list) else []


def list_chats(user):
    cursor = _collection().find(
        {"usuario": user},
        {"_id": 0, "id": 1, "nome": 1, "modelo": 1, "metadata": 1},
    ).sort("metadata.updated_at", DESCENDING)
    return [_normalize(item) for item in cursor]


def get_chat(chat_id, user):
    if not isinstance(chat_id, str) or not chat_id or len(chat_id) > 100:
        return None
    item = _collection().find_one({"id": chat_id, "usuario": user}, {"_id": 0})
    return _normalize(item) if item else None


def create_chat(user, name="Nova conversa", instructions="", model=DEFAULT_MODEL):
    timestamp = now()
    chat = {
        "id": str(uuid.uuid4()),
        "nome": str(name or "Nova conversa").strip()[:200] or "Nova conversa",
        "instrucoes": str(instructions or "").strip()[:8000],
        "modelo": str(model or DEFAULT_MODEL).strip()[:120] or DEFAULT_MODEL,
        "memoria": [],
        "memoria_automatica": [],
        "fontes": [],
        "fontes_web": [],
        "mensagens": [],
        "usuario": user,
        "preferencias": {"temperature": 0.35, "web_search": True},
        "metadata": {"created_at": timestamp, "updated_at": timestamp},
    }
    _collection().insert_one(chat)
    return _normalize(chat)


def update_chat(chat_id, user, **changes):
    fields = ("nome", "instrucoes", "modelo", "memoria", "memoria_automatica", "fontes", "fontes_web", "mensagens", "preferencias")
    update = {}
    for field in fields:
        if field in changes and changes[field] is not None:
            value = changes[field]
            if field in {"memoria", "memoria_automatica", "fontes", "fontes_web", "mensagens"}:
                value = _safe_list(value)
            elif field in {"nome", "instrucoes", "modelo"}:
                value = str(value)[:12000]
            elif field == "preferencias" and not isinstance(value, dict):
                continue
            update[field] = value
    update["metadata.updated_at"] = now()
    item = _collection().find_one_and_update(
        {"id": chat_id, "usuario": user},
        {"$set": update},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    return _normalize(item) if item else None


def delete_chat(chat_id, user):
    result = _collection().delete_one({"id": chat_id, "usuario": user})
    return result.deleted_count == 1
