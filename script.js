const API_URL = "https://korczak-ai.onrender.com";
const TOKEN_KEY = "korczak_auth_token";
const COMPACT_KEY = "korczak_compact";

const $ = id => document.getElementById(id);
const app = $("app");
const loginScreen = $("login-screen");
const loginForm = $("login-form");
const loginEmail = $("login-email");
const loginPassword = $("login-password");
const loginSubmit = $("login-submit");
const loginError = $("login-error");
const chat = $("chat");
const form = $("composer");
const input = $("message");
const send = $("send");
const status = $("status");
const welcome = $("welcome-state");
const newChat = $("new-chat");
const search = $("search");
const chatList = $("chat-list");
const modalBackdrop = $("modal-backdrop");
const modalTitle = $("modal-title");
const modalContent = $("modal-content");
const modalClose = $("modal-close");
const fileInput = $("file-input");

const state = { chats: [], activeId: null, activeChat: null, sending: false, user: null, webSources: [] };

function token() { return localStorage.getItem(TOKEN_KEY); }
function authHeaders(json = false) {
  const headers = { Authorization: `Bearer ${token() || ""}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function api(path, options = {}) {
  const headers = { ...authHeaders(options.body !== undefined), ...(options.headers || {}) };
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (error) {
    status.textContent = "API indisponível";
    throw new Error("Não foi possível acessar a API. Verifique se o serviço do Render está online e se o deploy terminou.");
  }
  if (response.status === 401) {
    await logout(false);
    throw new Error("Sessão expirada");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function activeChat() { return state.activeChat; }

function showLogin(error = "") {
  app.hidden = true;
  loginScreen.classList.remove("hidden");
  loginError.textContent = error;
  setTimeout(() => loginEmail.focus(), 30);
}

function showApp() {
  loginScreen.classList.add("hidden");
  app.hidden = false;
  const name = state.user?.name || state.user?.email || "Korczak AI";
  $("profile-name").textContent = name;
  $("profile-avatar").textContent = name.slice(0, 1).toUpperCase();
  document.body.classList.toggle("compact-mode", localStorage.getItem(COMPACT_KEY) === "1");
}

async function login(email, password) {
  loginSubmit.disabled = true;
  loginSubmit.textContent = "Entrando...";
  loginError.textContent = "";
  try {
    let response;
    try {
      response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
    } catch (_) {
      throw new Error("Não foi possível acessar a API. Verifique se o Render está online e se o último deploy terminou.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Falha no login");
    localStorage.setItem(TOKEN_KEY, data.token);
    state.user = data.user;
    loginPassword.value = "";
    showApp();
    await loadChats();
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Entrar";
  }
}

async function logout(callApi = true) {
  try {
    if (callApi && token()) await fetch(`${API_URL}/api/auth/logout`, { method: "POST", headers: authHeaders() });
  } catch (_) {}
  localStorage.removeItem(TOKEN_KEY);
  state.user = null;
  state.chats = [];
  state.activeId = null;
  state.activeChat = null;
  state.webSources = [];
  showLogin();
}

async function bootstrap() {
  if (!token()) return showLogin();
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
    showApp();
    await loadChats();
  } catch (_) { showLogin(); }
}
