import os
import sys

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("FRONTEND_ORIGIN", "http://localhost:3000")
os.environ.setdefault("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
os.environ.setdefault("MONGODB_URI", "")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from app import app, clean_history, make_token, should_search, current_user  # noqa: E402


def test_health_does_not_expose_internal_configuration():
    client = app.test_client()
    response = client.get("/")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ok"
    assert "MONGODB_URI" not in response.get_data(as_text=True)
    assert "OLLAMA_BASE_URL" not in response.get_data(as_text=True)


def test_history_is_bounded_and_roles_are_whitelisted():
    messages = [{"role": "user", "content": str(i)} for i in range(50)]
    cleaned = clean_history(messages)
    assert len(cleaned) == 30
    assert all(item["role"] in {"user", "assistant"} for item in cleaned)
    messages.append({"role": "system", "content": "must not pass"})
    assert all(item["role"] != "system" for item in clean_history(messages))


def test_search_intent_respects_toggle():
    assert should_search("qual é o preço atual?", True)
    assert not should_search("qual é o preço atual?", False)


def test_signed_token_round_trip():
    token = make_token("test@example.com")
    with app.test_request_context(headers={"Authorization": f"Bearer {token}"}):
        assert current_user() == "test@example.com"


def test_cors_allows_configured_origin():
    client = app.test_client()
    response = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert response.headers.get("Access-Control-Allow-Origin") == "http://localhost:3000"
