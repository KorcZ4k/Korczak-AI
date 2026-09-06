import json
import os
import threading
from datetime import datetime, timezone

import requests
from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
MODEL = os.getenv("MODEL", "qwen2.5:0.5b")
SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "Você é a Korczak AI, um assistente útil, claro e amigável. Responda em português quando o usuário falar português."
)

# JSON database. The directory is kept outside the Python package so the data
# can also be inspected manually in the repository.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(BASE_DIR, "DB", "JSON")
CHAT_DIR = os.path.join(DB_DIR, "CHATS")
INDEX_FILE = os.path.join(DB_DIR, "CHAT", "CHATS.json")
DB_LOCK = threading.RLock()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def ensure_db():
    os.makedirs(CHAT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(INDEX_FILE), exist_ok=True)
    if not os.path.exists(INDEX_FILE):
        write_json(INDEX_FILE, {"version": 1, "next_id": 1, "chats": []})


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")
    os.replace(temp_path, path)


def normalize_id(value):
    try:
        return f"{int(value):03d}"
    except (TypeError, ValueError):
        return None


def chat_path(chat_id):
    return os.path.join(CHAT_DIR, f"{chat_id}.json")


def default_chat(chat_id):
    timestamp = now_iso()
    return {
        "id": chat_id,
        "nome": "Nova conversa",
        "instrucoes": "",
        "modelo": MODEL,
        "memoria": [],
        "mensagens": [],
        "metadata": {"created_at": timestamp, "updated_at": timestamp},
    }


def get_chat(chat_id):
    return read_json(chat_path(chat_id))


def save_chat(chat):
    chat["metadata"]["updated_at"] = now_iso()
    write_json(chat_path(chat["id"]), chat)


def sync_index():
    index = read_json(INDEX_FILE, {"version": 1, "next_id": 1, "chats": []})
    entries = []
    max_id = 0
    for filename in os.listdir(CHAT_DIR):
        if not filename.endswith(".json"):
            continue
        chat = read_json(os.path.join(CHAT_DIR, filename))
        if not isinstance(chat, dict) or not chat.get("id"):
            continue
        chat_id = normalize_id(chat["id"])
        if not chat_id:
            continue
        max_id = max(max_id, int(chat_id))
        entries.append({
            "id": chat_id,
            "nome": chat.get("nome", "Nova conversa"),
            "modelo": chat.get("modelo", MODEL),
            "updated_at": chat.get("metadata", {}).get("updated_at"),
        })
    entries.sort(key=lambda item: int(item["id"]))
    index = {"version": 1, "next_id": max_id + 1, "chats": entries}
    write_json(INDEX_FILE, index)
    return index


ensure_db()


@app.get("/")
def health():
    return jsonify({"status": "ok", "model": MODEL, "database": "json"})


@app.get("/api/health")
def api_health():
    return jsonify({"status": "ok", "model": MODEL, "database": "json"})


@app.get("/api/chats")
def list_chats():
    with DB_LOCK:
        index = sync_index()
        return jsonify(index)


@app.post("/api/chats")
def create_chat():
    data = request.get_json(silent=True) or {}
    with DB_LOCK:
        index = sync_index()
        chat_id = f"{int(index.get('next_id', 1)):03d}"
        chat = default_chat(chat_id)
        chat["nome"] = str(data.get("nome") or "Nova conversa").strip()[:120]
        chat["instrucoes"] = str(data.get("instrucoes") or "")[:4000]
        chat["modelo"] = str(data.get("modelo") or MODEL)[:100]
        save_chat(chat)
        sync_index()
        return jsonify(chat), 201


@app.get("/api/chats/<chat_id>")
def read_chat(chat_id):
    chat_id = normalize_id(chat_id)
    if not chat_id:
        return jsonify({"error": "ID de chat inválido"}), 400
    with DB_LOCK:
        chat = get_chat(chat_id)
        if not chat:
            return jsonify({"error": "Chat não encontrado"}), 404
        return jsonify(chat)


@app.put("/api/chats/<chat_id>")
def update_chat(chat_id):
    chat_id = normalize_id(chat_id)
    if not chat_id:
        return jsonify({"error": "ID de chat inválido"}), 400
    data = request.get_json(silent=True) or {}
    with DB_LOCK:
        chat = get_chat(chat_id)
        if not chat:
            return jsonify({"error": "Chat não encontrado"}), 404
        if "nome" in data:
            chat["nome"] = str(data["nome"]).strip()[:120] or "Nova conversa"
        if "instrucoes" in data:
            chat["instrucoes"] = str(data["instrucoes"])[:4000]
        if "modelo" in data:
            chat["modelo"] = str(data["modelo"])[:100]
        if "memoria" in data and isinstance(data["memoria"], list):
            chat["memoria"] = data["memoria"][-100:]
        if "mensagens" in data and isinstance(data["mensagens"], list):
            chat["mensagens"] = clean_history(data["mensagens"])[-100:]
        save_chat(chat)
        sync_index()
        return jsonify(chat)


@app.delete("/api/chats/<chat_id>")
def delete_chat(chat_id):
    chat_id = normalize_id(chat_id)
    if not chat_id:
        return jsonify({"error": "ID de chat inválido"}), 400
    with DB_LOCK:
        path = chat_path(chat_id)
        if not os.path.exists(path):
            return jsonify({"error": "Chat não encontrado"}), 404
        os.remove(path)
        sync_index()
        return jsonify({"ok": True, "id": chat_id})


def clean_history(messages):
    clean_messages = []
    for item in messages[-20:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            clean_messages.append({"role": role, "content": content.strip()})
    return clean_messages


@app.post("/api/chat")
def chat():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    chat_id = normalize_id(data.get("chat_id")) if data.get("chat_id") is not None else None

    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "messages deve ser uma lista não vazia"}), 400

    clean_messages = clean_history(messages)
    if not clean_messages:
        return jsonify({"error": "Nenhuma mensagem válida"}), 400

    chat_record = None
    if chat_id:
        with DB_LOCK:
            chat_record = get_chat(chat_id)
        if not chat_record:
            return jsonify({"error": "Chat não encontrado"}), 404

    selected_model = (chat_record or {}).get("modelo") or MODEL
    instructions = (chat_record or {}).get("instrucoes", "").strip()
    memory = (chat_record or {}).get("memoria", [])
    system_prompt = SYSTEM_PROMPT
    if instructions:
        system_prompt += f"\n\nInstruções deste chat:\n{instructions}"
    if memory:
        memory_text = "\n".join(f"- {item}" for item in memory if isinstance(item, str))
        if memory_text:
            system_prompt += f"\n\nMemória deste chat:\n{memory_text}"

    payload = {
        "model": selected_model,
        "messages": [{"role": "system", "content": system_prompt}] + clean_messages,
        "stream": True,
    }

    try:
        ollama_response = requests.post(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat",
            json=payload,
            stream=True,
            timeout=(10, 600),
        )
        ollama_response.raise_for_status()
    except requests.RequestException as exc:
        return jsonify({"error": "Falha ao conectar ao servidor do modelo", "detail": str(exc)}), 502

    @stream_with_context
    def generate():
        answer_parts = []
        try:
            for line in ollama_response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    piece = chunk.get("message", {}).get("content", "")
                    if piece:
                        answer_parts.append(piece)
                    yield json.dumps(chunk, ensure_ascii=False) + "\n"
                except (json.JSONDecodeError, TypeError):
                    continue
        finally:
            ollama_response.close()
            if chat_record and answer_parts:
                with DB_LOCK:
                    current = get_chat(chat_id) or chat_record
                    current["mensagens"] = clean_history(messages) + [{"role": "assistant", "content": "".join(answer_parts)}]
                    save_chat(current)
                    sync_index()

    return Response(
        generate(),
        mimetype="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")))
