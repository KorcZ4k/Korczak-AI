import json
import os
import re
import uuid
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument

DEFAULT_MODEL = os.getenv("MODEL", "qwen2.5:0.5b").strip() or "qwen2.5:0.5b"
MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "KorczakControl").strip() or "KorczakControl"
CHATS_COLLECTION = os.getenv("MONGODB_CHATS_COLLECTION", "Chats").strip() or "Chats"

MAX_NAME = 200
MAX_INSTRUCTIONS = 8000
MAX_MODEL = 120
MAX_LIST_ITEMS = 100
MAX_MEMORY_ITEM = 4000
MAX_SOURCE_ITEM = 8000
MAX_MESSAGES = 30
MAX_MESSAGE_CONTENT = 12000
MAX_CHAT_BYTES = 900_000
MODEL_PATTERN = re.compile(r"[A-Za-z0-9_.:/-]{1,120}")

_client = None
_mongo_collection = None
_indexes_ready = False


def now():
    return datetime.now(timezone.utc).isoformat()


def _collection():
    global _client, _mongo_collection, _indexes_ready
    if not MONGODB_URI:
        raise RuntimeError("MONGODB_URI não configurado")
    if _mongo_collection is None:
        _client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            socketTimeoutMS=15000,
            appname="KorczakAI",
        )
        _mongo_collection = _client[MONGODB_DATABASE][CHATS_COLLECTION]
    if not _indexes_ready:
        _mongo_collection.create_index([("usuario", ASCENDING), ("metadata.updated_at", DESCENDING)])
        _mongo_collection.create_index([("usuario", ASCENDING), ("id", ASCENDING)], unique=True)
        _indexes_ready = True
    return _mongo_collection


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


def _safe_string(value, limit, default=""):
    if not isinstance(value, str):
        return default
    return value.strip()[:limit]


def _safe_list(value, max_items=MAX_LIST_ITEMS, item_limit=MAX_MEMORY_ITEM):
    if not isinstance(value, list):
        raise ValueError("Campo de lista inválido")
    if len(value) > max_items:
        raise ValueError("Lista excede o limite permitido")
    cleaned = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError("Itens de lista devem ser texto")
        item = item.strip()[:item_limit]
        if item:
            cleaned.append(item)
    return cleaned


def _safe_messages(value):
    if not isinstance(value, list) or len(value) > MAX_MESSAGES:
        raise ValueError("Mensagens excedem o limite permitido")
    cleaned = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Mensagem inválida")
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            raise ValueError("Mensagem inválida")
        content = content.strip()[:MAX_MESSAGE_CONTENT]
        if content:
            cleaned.append({"role": role, "content": content})
    return cleaned


def _safe_preferences(value):
    if not isinstance(value, dict):
        raise ValueError("Preferências inválidas")
    allowed = {"temperature", "web_search"}
    unknown = set(value) - allowed
    if unknown:
        raise ValueError("Preferência não suportada")
    result = {"temperature": 0.35, "web_search": True}
    if "temperature" in value:
        try:
            temperature = float(value["temperature"])
        except (TypeError, ValueError):
            raise ValueError("Temperature inválida")
        if not 0 <= temperature <= 1.5:
            raise ValueError("Temperature fora do intervalo permitido")
        result["temperature"] = temperature
    if "web_search" in value:
        if not isinstance(value["web_search"], bool):
            raise ValueError("web_search deve ser booleano")
        result["web_search"] = value["web_search"]
    return result


def _validate_chat_size(chat):
    size = len(json.dumps(chat, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size > MAX_CHAT_BYTES:
        raise ValueError("Chat excede o tamanho máximo permitido")


def list_chats(user):
    cursor = _collection().find(
        {"usuario": user},
        {"_id": 0, "id": 1, "nome": 1, "modelo": 1, "metadata": 1},
    ).sort("metadata.updated_at", DESCENDING).limit(200)
    return [_normalize(item) for item in cursor]


def get_chat(chat_id, user):
    if not isinstance(chat_id, str) or not chat_id or len(chat_id) > 100:
        return None
    item = _collection().find_one({"id": chat_id, "usuario": user}, {"_id": 0})
    return _normalize(item) if item else None


def create_chat(user, name="Nova conversa", instructions="", model=DEFAULT_MODEL):
    name = _safe_string(name, MAX_NAME, "Nova conversa") or "Nova conversa"
    instructions = _safe_string(instructions, MAX_INSTRUCTIONS)
    model = _safe_string(model, MAX_MODEL, DEFAULT_MODEL) or DEFAULT_MODEL
    if not MODEL_PATTERN.fullmatch(model):
        raise ValueError("Modelo inválido")
    timestamp = now()
    chat = {
        "id": str(uuid.uuid4()),
        "nome": name,
        "instrucoes": instructions,
        "modelo": model,
        "memoria": [],
        "memoria_automatica": [],
        "fontes": [],
        "fontes_web": [],
        "mensagens": [],
        "usuario": user,
        "preferencias": {"temperature": 0.35, "web_search": True},
        "metadata": {"created_at": timestamp, "updated_at": timestamp},
    }
    _validate_chat_size(chat)
    _collection().insert_one(chat)
    return _normalize(chat)


def update_chat(chat_id, user, **changes):
    fields = ("nome", "instrucoes", "modelo", "memoria", "memoria_automatica", "fontes", "fontes_web", "mensagens", "preferencias")
    update = {}
    for field in fields:
        if field not in changes or changes[field] is None:
            continue
        value = changes[field]
        if field == "nome":
            value = _safe_string(value, MAX_NAME)
        elif field == "instrucoes":
            value = _safe_string(value, MAX_INSTRUCTIONS)
        elif field == "modelo":
            value = _safe_string(value, MAX_MODEL)
            if not MODEL_PATTERN.fullmatch(value):
                raise ValueError("Modelo inválido")
        elif field in {"memoria", "memoria_automatica"}:
            value = _safe_list(value, MAX_LIST_ITEMS, MAX_MEMORY_ITEM)
        elif field in {"fontes", "fontes_web"}:
            value = _safe_list(value, MAX_LIST_ITEMS, MAX_SOURCE_ITEM)
        elif field == "mensagens":
            value = _safe_messages(value)
        elif field == "preferencias":
            value = _safe_preferences(value)
        update[field] = value
    if not update:
        raise ValueError("Nenhum campo válido para atualização")

    current = get_chat(chat_id, user)
    if not current:
        return None
    candidate = dict(current)
    candidate.update(update)
    candidate["metadata"] = dict(candidate.get("metadata") or {})
    candidate["metadata"]["updated_at"] = now()
    _validate_chat_size(candidate)

    item = _collection().find_one_and_update(
        {"id": chat_id, "usuario": user},
        {"$set": {**update, "metadata.updated_at": candidate["metadata"]["updated_at"]}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    return _normalize(item) if item else None


def delete_chat(chat_id, user):
    result = _collection().delete_one({"id": chat_id, "usuario": user})
    return result.deleted_count == 1
