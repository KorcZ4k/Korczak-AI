import json
import os

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


@app.get("/")
def health():
    return jsonify({"status": "ok", "model": MODEL})


@app.get("/api/health")
def api_health():
    return jsonify({"status": "ok", "model": MODEL})


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

    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "messages deve ser uma lista não vazia"}), 400

    clean_messages = clean_history(messages)
    if not clean_messages:
        return jsonify({"error": "Nenhuma mensagem válida"}), 400

    payload = {
        "model": MODEL,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + clean_messages,
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
        try:
            for line in ollama_response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                # Ollama returns one JSON object per line while streaming.
                try:
                    chunk = json.loads(line)
                    yield json.dumps(chunk, ensure_ascii=False) + "\n"
                except (json.JSONDecodeError, TypeError):
                    continue
        finally:
            ollama_response.close()

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
