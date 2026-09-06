import os
import requests
from flask import Flask, jsonify, request
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

@app.post("/api/chat")
def chat():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])

    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "messages deve ser uma lista não vazia"}), 400

    clean_messages = []
    for item in messages[-20:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            clean_messages.append({"role": role, "content": content.strip()})

    if not clean_messages:
        return jsonify({"error": "Nenhuma mensagem válida"}), 400

    payload = {
        "model": MODEL,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + clean_messages,
        "stream": False,
    }

    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat",
            json=payload,
            timeout=120,
        )
        response.raise_for_status()
        result = response.json()
        answer = result.get("message", {}).get("content", "")
        return jsonify({"response": answer})
    except requests.RequestException as exc:
        return jsonify({"error": "Falha ao conectar ao servidor do modelo", "detail": str(exc)}), 502
    except (ValueError, TypeError):
        return jsonify({"error": "Resposta inválida do servidor do modelo"}), 502

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")))
