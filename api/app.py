import hashlib
import json
import os
import re
import secrets
from functools import wraps

import bcrypt
import requests
from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pymongo import MongoClient

from guardrail import SYSTEM_GUARDRAIL, audit, inspect_input, inspect_output
from json_db import create_chat, delete_chat, get_chat, list_chats, update_chat

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}}, allow_headers=["Content-Type", "Authorization"], methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"])
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("MODEL", "qwen2.5:0.5b")
MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
MONGODB_DATABASE = "KorczakControl"
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "Users").strip() or "Users"
SECRET_KEY = os.getenv("SECRET_KEY", "").strip() or (hashlib.sha256(MONGODB_URI.encode()).hexdigest() if MONGODB_URI else secrets.token_urlsafe(32))
TOKEN_MAX_AGE = int(os.getenv("AUTH_TOKEN_MAX_AGE", "604800"))
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", """Você é a Korczak AI, um assistente avançado, claro, preciso e amigável.
Seu objetivo é extrair o máximo útil das capacidades disponíveis do modelo sem inventar capacidades que não existem.
Raciocine cuidadosamente antes de responder, mantenha o contexto da conversa, confira consistência, diferencie fatos de hipóteses e seja transparente sobre incerteza.
Quando uma pergunta exigir dados atuais, ferramentas externas ou pesquisa que você não possui, diga isso claramente em vez de fabricar resultados.
Responda em português quando o usuário falar português, salvo pedido contrário.
""")
_serializer = URLSafeTimedSerializer(SECRET_KEY, salt="korczak-ai-auth-v1")
_mongo_client = None
_users = None


def mongo_collection():
    global _mongo_client, _users
    if not MONGODB_URI:
        return None
    if _users is None:
        _mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)
        _users = _mongo_client[MONGODB_DATABASE][MONGODB_COLLECTION]
    return _users


def make_token(email):
    return _serializer.dumps({"email": email})


def current_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        data = _serializer.loads(header[7:].strip(), max_age=TOKEN_MAX_AGE)
        return data.get("email")
    except (BadSignature, SignatureExpired):
        return None


def auth_required(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "Não autenticado"}), 401
        return handler(user, *args, **kwargs)
    return wrapped


def find_test_user(email):
    collection = mongo_collection()
    if collection is None:
        return None, "MongoDB não configurado"
    try:
        return collection.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}), None
    except Exception as exc:
        app.logger.exception("MongoDB lookup failed")
        return None, str(exc)


def password_hash_from_user(user):
    for key in ("password", "senha", "password_hash", "senha_hash", "bcrypt", "passwordHash"):
        value = user.get(key)
        if isinstance(value, str) and value.startswith("$2"):
            return value
    return None


@app.get("/")
def health():
    return jsonify({"status": "ok", "model": DEFAULT_MODEL, "database": "json", "auth": "mongodb"})


@app.get("/api/health")
def api_health():
    mongo_ok = False
    if MONGODB_URI:
        try:
            mongo_collection().database.client.admin.command("ping")
            mongo_ok = True
        except Exception:
            mongo_ok = False
    return jsonify({"status": "ok", "model": DEFAULT_MODEL, "database": "json", "mongodb": mongo_ok})


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password")
    if not email or not isinstance(password, str) or not password:
        return jsonify({"error": "Você não está na lista de testes."}), 401
    user, error = find_test_user(email)
    if error:
        return jsonify({"error": "Autenticação indisponível. Verifique a conexão com o MongoDB."}), 503
    if not user:
        audit("login_denied", user=email, allowed=False, reason="not_in_test_list")
        return jsonify({"error": "Você não está na lista de testes."}), 401
    stored_hash = password_hash_from_user(user)
    if not stored_hash:
        audit("login_denied", user=email, allowed=False, reason="missing_bcrypt_hash")
        return jsonify({"error": "Você não está na lista de testes."}), 401
    try:
        valid = bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    except (ValueError, TypeError):
        valid = False
    if not valid:
        audit("login_denied", user=email, allowed=False, reason="invalid_password")
        return jsonify({"error": "Você não está na lista de testes."}), 401
    audit("login_success", user=email)
    return jsonify({"authenticated": True, "token": make_token(email), "user": {"email": user.get("email", email), "name": user.get("name") or user.get("nome") or email.split("@")[0]}})


@app.get("/api/auth/me")
@auth_required
def me(user):
    doc, error = find_test_user(user)
    if error or not doc:
        return jsonify({"error": "Sessão inválida"}), 401
    return jsonify({"authenticated": True, "user": {"email": doc.get("email", user), "name": doc.get("name") or doc.get("nome") or user.split("@")[0]}})


@app.post("/api/auth/logout")
@auth_required
def logout(user):
    audit("logout", user=user)
    return jsonify({"authenticated": False})


@app.get("/api/chats")
@auth_required
def chats(user):
    return jsonify({"chats": list_chats(user)})


@app.post("/api/chats")
@auth_required
def new_chat(user):
    data = request.get_json(silent=True) or {}
    chat = create_chat(user, data.get("nome"), data.get("instrucoes", ""), data.get("modelo", DEFAULT_MODEL))
    audit("chat_created", user=user, chat_id=chat["id"])
    return jsonify(chat), 201


@app.get("/api/chats/<chat_id>")
@auth_required
def read_chat(user, chat_id):
    chat = get_chat(chat_id, user)
    if not chat:
        return jsonify({"error": "Chat não encontrado"}), 404
    return jsonify(chat)


@app.patch("/api/chats/<chat_id>")
@auth_required
def patch_chat(user, chat_id):
    data = request.get_json(silent=True) or {}
    allowed = {key: data[key] for key in ("nome", "instrucoes", "modelo", "memoria", "fontes", "mensagens") if key in data}
    chat = update_chat(chat_id, user, **allowed)
    if not chat:
        return jsonify({"error": "Chat não encontrado"}), 404
    audit("chat_updated", user=user, chat_id=chat_id, metadata={"fields": list(allowed)})
    return jsonify(chat)


@app.delete("/api/chats/<chat_id>")
@auth_required
def remove_chat(user, chat_id):
    if not delete_chat(chat_id, user):
        return jsonify({"error": "Chat não encontrado"}), 404
    audit("chat_deleted", user=user, chat_id=chat_id)
    return jsonify({"deleted": True})


def clean_history(messages):
    clean_messages = []
    for item in messages[-30:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            clean_messages.append({"role": role, "content": content.strip()[:12000]})
    return clean_messages


@app.post("/api/chat")
@auth_required
def chat(user):
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    chat_id = str(data.get("chat_id", "")).strip() or None
    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "messages deve ser uma lista não vazia"}), 400
    clean_messages = clean_history(messages)
    if not clean_messages:
        return jsonify({"error": "Nenhuma mensagem válida"}), 400
    for message in clean_messages:
        if message["role"] == "user":
            allowed, reason = inspect_input(message["content"])
            audit("guardrail_input", user=user, chat_id=chat_id, allowed=allowed, reason=reason, text=message["content"])
            if not allowed:
                return jsonify({"error": reason}), 400
    chat_record = get_chat(chat_id, user) if chat_id else None
    if chat_id and not chat_record:
        return jsonify({"error": "Chat não encontrado"}), 404
    selected_model = (chat_record or {}).get("modelo") or DEFAULT_MODEL
    instructions = (chat_record or {}).get("instrucoes", "").strip()
    memory = (chat_record or {}).get("memoria", [])
    sources = (chat_record or {}).get("fontes", [])
    memory_text = "\n".join(f"- {item}" for item in memory if isinstance(item, str)) or "Nenhuma memória persistente registrada."
    source_text = "\n".join(f"- {item.get('name')}: {item.get('content', '')[:6000]}" for item in sources if isinstance(item, dict)) or "Nenhuma fonte anexada."
    system_prompt = f"{SYSTEM_GUARDRAIL}\n\n{SYSTEM_PROMPT}\n\nINSTRUÇÕES DO CHAT:\n{instructions or 'Nenhuma instrução específica.'}\n\nMEMÓRIA DO CHAT:\n{memory_text}\n\nFONTES LOCAIS DO CHAT:\n{source_text}"
    payload = {"model": selected_model, "messages": [{"role": "system", "content": system_prompt}] + clean_messages, "stream": True, "options": {"temperature": 0.35, "num_ctx": 8192}}
    try:
        ollama_response = requests.post(f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat", json=payload, stream=True, timeout=(10, 600))
        ollama_response.raise_for_status()
    except requests.RequestException as exc:
        audit("model_error", user=user, chat_id=chat_id, allowed=False, reason="ollama_connection_error")
        return jsonify({"error": "Falha ao conectar ao servidor do modelo", "detail": str(exc)}), 502

    @stream_with_context
    def generate():
        answer = ""
        try:
            for line in ollama_response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except (json.JSONDecodeError, TypeError):
                    continue
                piece = chunk.get("message", {}).get("content", "")
                if piece:
                    answer += piece
                yield json.dumps(chunk, ensure_ascii=False) + "\n"
            allowed, reason = inspect_output(answer)
            audit("guardrail_output", user=user, chat_id=chat_id, allowed=allowed, reason=reason, text=answer)
            if not allowed:
                yield json.dumps({"message": {"content": "\n\n[Resposta bloqueada pelo guard rail.]"}}, ensure_ascii=False) + "\n"
                return
            if chat_id and answer:
                current = get_chat(chat_id, user)
                if current:
                    current["mensagens"] = clean_messages + [{"role": "assistant", "content": answer}]
                    update_chat(chat_id, user, mensagens=current["mensagens"])
        finally:
            ollama_response.close()
    return Response(generate(), mimetype="application/x-ndjson", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@app.get("/api/audit/recent")
@auth_required
def audit_recent(user):
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "DB", "JSON", "AUDIT", "events.jsonl")
    if not os.path.exists(path):
        return jsonify({"events": []})
    events = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle.readlines()[-100:]:
            try:
                event = json.loads(line)
                if event.get("user") == user:
                    events.append(event)
            except json.JSONDecodeError:
                pass
    return jsonify({"events": events[-50:]})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")))
