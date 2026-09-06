import json
import threading
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "DB" / "JSON"
CHATS_DIR = ROOT / "CHATS"
INDEX_PATH = ROOT / "CHAT" / "CHATS.json"
LOCK = threading.RLock()
DEFAULT_MODEL = "qwen2.5:0.5b"

CHATS_DIR.mkdir(parents=True, exist_ok=True)
INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)


def now():
    return datetime.now(timezone.utc).isoformat()


def _read(path, default):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary.replace(path)


def _index():
    data = _read(INDEX_PATH, {"version": 2, "next_id": 1, "chats": []})
    data.setdefault("version", 2)
    data.setdefault("next_id", 1)
    data.setdefault("chats", [])
    return data


def _chat_path(chat_id):
    try:
        normalized = f"{int(str(chat_id)):03d}"
    except (TypeError, ValueError):
        return None
    return CHATS_DIR / f"{normalized}.json"


def _normalize(chat):
    chat.setdefault("id", "001")
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
    chat["metadata"].setdefault("updated_at", now())
    return chat


def list_chats(user):
    with LOCK:
        index = _index()
        result = []
        for item in index["chats"]:
            path = _chat_path(item.get("id"))
            if not path:
                continue
            chat = _normalize(_read(path, item))
            if chat.get("usuario") == user:
                result.append({"id": chat["id"], "nome": chat["nome"], "modelo": chat["modelo"], "metadata": chat["metadata"]})
        return sorted(result, key=lambda x: x["id"], reverse=True)


def get_chat(chat_id, user):
    with LOCK:
        path = _chat_path(chat_id)
        if not path:
            return None
        chat = _normalize(_read(path, {}))
        if chat.get("id") != path.stem or chat.get("usuario") != user:
            return None
        return chat


def create_chat(user, name="Nova conversa", instructions="", model=DEFAULT_MODEL):
    with LOCK:
        index = _index()
        used = {int(item.get("id", 0)) for item in index["chats"] if str(item.get("id", "")).isdigit()}
        next_id = max(1, int(index.get("next_id", 1)))
        while next_id in used:
            next_id += 1
        chat_id = f"{next_id:03d}"
        timestamp = now()
        chat = {
            "id": chat_id,
            "nome": name or "Nova conversa",
            "instrucoes": instructions or "",
            "modelo": model or DEFAULT_MODEL,
            "memoria": [],
            "memoria_automatica": [],
            "fontes": [],
            "fontes_web": [],
            "mensagens": [],
            "usuario": user,
            "preferencias": {"temperature": 0.35, "web_search": True},
            "metadata": {"created_at": timestamp, "updated_at": timestamp},
        }
        _write(_chat_path(chat_id), chat)
        index["next_id"] = next_id + 1
        index["chats"].append({"id": chat_id, "nome": chat["nome"], "usuario": user})
        _write(INDEX_PATH, index)
        return chat


def update_chat(chat_id, user, **changes):
    with LOCK:
        chat = get_chat(chat_id, user)
        if not chat:
            return None
        fields = ("nome", "instrucoes", "modelo", "memoria", "memoria_automatica", "fontes", "fontes_web", "mensagens", "preferencias")
        for field in fields:
            if field in changes and changes[field] is not None:
                chat[field] = changes[field]
        chat["metadata"]["updated_at"] = now()
        _write(_chat_path(chat_id), chat)
        index = _index()
        for item in index["chats"]:
            if str(item.get("id")) == str(chat["id"]) and item.get("usuario") == user:
                item["nome"] = chat["nome"]
        _write(INDEX_PATH, index)
        return chat


def delete_chat(chat_id, user):
    with LOCK:
        chat = get_chat(chat_id, user)
        if not chat:
            return False
        path = _chat_path(chat_id)
        if path and path.exists():
            path.unlink()
        index = _index()
        index["chats"] = [item for item in index["chats"] if not (str(item.get("id")) == str(chat["id"]) and item.get("usuario") == user)]
        _write(INDEX_PATH, index)
        return True
