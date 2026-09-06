const API_URL = "https://korczak-ai.onrender.com";
const TOKEN_KEY = "korczak_auth_token";
const COMPACT_KEY = "korczak_compact";

const app = document.getElementById("app");
const loginScreen = document.getElementById("login-screen");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginSubmit = document.getElementById("login-submit");
const loginError = document.getElementById("login-error");
const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("message");
const send = document.getElementById("send");
const status = document.getElementById("status");
const welcome = document.getElementById("welcome-state");
const newChat = document.getElementById("new-chat");
const search = document.getElementById("search");
const chatList = document.getElementById("chat-list");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitle = document.getElementById("modal-title");
const modalContent = document.getElementById("modal-content");
const modalClose = document.getElementById("modal-close");
const fileInput = document.getElementById("file-input");

const state = { chats: [], activeId: null, activeChat: null, sending: false, user: null };

function token() { return localStorage.getItem(TOKEN_KEY); }
function headers(json = true) { const h = { Authorization: `Bearer ${token() || ""}` }; if (json) h["Content-Type"] = "application/json"; return h; }

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { ...headers(options.body !== undefined), ...(options.headers || {}) } });
  if (response.status === 401) { await logout(false); throw new Error("Sessão expirada"); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function escapeHtml(text) { const div = document.createElement("div"); div.textContent = text ?? ""; return div.innerHTML; }
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
  document.getElementById("profile-name").textContent = state.user?.name || state.user?.email || "Korczak AI";
  document.getElementById("profile-avatar").textContent = (state.user?.name || "K").slice(0, 1).toUpperCase();
  document.body.classList.toggle("compact-mode", localStorage.getItem(COMPACT_KEY) === "1");
}

async function login(email, password) {
  loginSubmit.disabled = true; loginSubmit.textContent = "Entrando..."; loginError.textContent = "";
  try {
    const response = await fetch(`${API_URL}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Falha no login");
    localStorage.setItem(TOKEN_KEY, data.token);
    state.user = data.user;
    showApp();
    await loadChats();
  } catch (error) { loginError.textContent = error.message; }
  finally { loginSubmit.disabled = false; loginSubmit.textContent = "Entrar"; }
}

async function logout(callApi = true) {
  try { if (callApi && token()) await fetch(`${API_URL}/api/auth/logout`, { method: "POST", headers: headers(false) }); } catch (_) {}
  localStorage.removeItem(TOKEN_KEY); state.user = null; state.chats = []; state.activeId = null; state.activeChat = null; showLogin();
}

async function bootstrap() {
  if (!token()) return showLogin();
  try { const data = await api("/api/auth/me"); state.user = data.user; showApp(); await loadChats(); }
  catch (_) { showLogin(); }
}

async function loadChats() {
  status.textContent = "Sincronizando...";
  const data = await api("/api/chats");
  state.chats = data.chats || [];
  renderChatList();
  if (state.chats.length) await openChat(state.activeId || state.chats[0].id);
  else await createChat(false);
  status.textContent = "Online";
}

function renderChatList() {
  chatList.innerHTML = "";
  const query = search.value.trim().toLowerCase();
  state.chats.forEach(item => {
    if (query && !(item.nome || "").toLowerCase().includes(query)) return;
    const button = document.createElement("button");
    button.className = `chat-item${String(item.id) === String(state.activeId) ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<small>${item.id}</small> ${escapeHtml(item.nome || "Nova conversa")}`;
    button.onclick = () => openChat(item.id);
    chatList.appendChild(button);
  });
  if (!chatList.children.length) { const empty = document.createElement("div"); empty.className = "chat-empty"; empty.textContent = query ? "Nenhum chat encontrado" : "Nenhum chat ainda"; chatList.appendChild(empty); }
}

function renderMessages(messages = []) {
  chat.innerHTML = "";
  if (!messages.length) { chat.appendChild(welcome); welcome.style.display = "block"; return; }
  welcome.style.display = "none";
  messages.forEach(m => addMessage(m.role, m.content));
}

function addMessage(role, content = "") { const el = document.createElement("div"); el.className = `message ${role}`; el.textContent = content; chat.appendChild(el); chat.scrollTop = chat.scrollHeight; return el; }

async function createChat(focus = true) {
  try {
    const item = await api("/api/chats", { method: "POST", body: JSON.stringify({ nome: "Nova conversa", modelo: "qwen2.5:0.5b" }) });
    state.chats.unshift(item); state.activeId = item.id; state.activeChat = item; renderChatList(); renderMessages([]); setConversationTitle(item.nome); if (focus) input.focus();
  } catch (error) { status.textContent = error.message; }
}

async function openChat(id) {
  try {
    const item = await api(`/api/chats/${encodeURIComponent(id)}`);
    state.activeId = item.id; state.activeChat = item; renderChatList(); renderMessages(item.mensagens || []); setConversationTitle(item.nome); input.focus();
  } catch (error) { status.textContent = error.message; }
}

function setConversationTitle(title) { document.getElementById("conversation-title").firstChild.textContent = `${title || "Nova conversa"} `; }

async function patchActive(changes) {
  if (!state.activeId) return;
  const item = await api(`/api/chats/${encodeURIComponent(state.activeId)}`, { method: "PATCH", body: JSON.stringify(changes) });
  state.activeChat = item;
  const index = state.chats.findIndex(c => String(c.id) === String(item.id));
  if (index >= 0) state.chats[index] = item;
  else state.chats.unshift(item);
  renderChatList(); setConversationTitle(item.nome); return item;
}

function resizeInput() { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; }
function showModal(title, html) { modalTitle.textContent = title; modalContent.innerHTML = html; modalBackdrop.hidden = false; }
function closeModal() { modalBackdrop.hidden = true; }

async function streamResponse(messages, target) {
  const response = await fetch(`${API_URL}/api/chat`, { method: "POST", headers: { ...headers(), Accept: "application/x-ndjson" }, body: JSON.stringify({ chat_id: state.activeId, messages }) });
  if (response.status === 401) { await logout(false); throw new Error("Sessão expirada"); }
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `HTTP ${response.status}`); }
  if (!response.body) throw new Error("Streaming não suportado pelo navegador");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8"); let buffer = "", answer = ""; target.classList.add("streaming");
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const line of lines) { if (!line.trim()) continue; const chunk = JSON.parse(line); const piece = chunk?.message?.content || ""; if (piece) { answer += piece; target.textContent = answer; chat.scrollTop = chat.scrollHeight; } }
    }
    buffer += decoder.decode(); if (buffer.trim()) answer += JSON.parse(buffer)?.message?.content || ""; target.textContent = answer;
  } finally { target.classList.remove("streaming"); reader.releaseLock(); }
  return answer;
}

async function conversationModal() {
  const item = activeChat(); if (!item) return;
  showModal("Conversa atual", `<p><strong>${escapeHtml(item.nome)}</strong></p><p>ID: ${escapeHtml(item.id)}</p><p>Modelo: ${escapeHtml(item.modelo || "qwen2.5:0.5b")}</p><p>${item.mensagens?.length || 0} mensagens · ${item.memoria?.length || 0} memórias · ${item.fontes?.length || 0} fontes.</p><div class="modal-actions"><button class="danger" id="delete-chat" type="button">Excluir chat</button><button class="primary" id="rename-chat" type="button">Editar</button></div>`);
  document.getElementById("rename-chat").onclick = settingsModal;
  document.getElementById("delete-chat").onclick = async () => { if (!confirm("Excluir esta conversa?")) return; await api(`/api/chats/${state.activeId}`, { method: "DELETE" }); state.chats = state.chats.filter(c => String(c.id) !== String(state.activeId)); state.activeId = null; state.activeChat = null; closeModal(); if (state.chats.length) await openChat(state.chats[0].id); else await createChat(false); };
}

async function settingsModal() {
  const item = activeChat(); if (!item) return;
  showModal("Configurações", `<label class="field">Nome<input id="chat-name" value="${escapeHtml(item.nome)}"></label><label class="field">Instruções<textarea id="chat-instructions" rows="6" placeholder="Instruções específicas para este chat">${escapeHtml(item.instrucoes || "")}</textarea></label><label class="field">Modelo<select id="chat-model"><option>qwen2.5:0.5b</option></select></label><label class="setting"><input type="checkbox" id="compact-mode"> Modo compacto</label><button class="primary wide" id="save-settings">Salvar</button><button class="secondary wide" id="audit-button">Auditoria de segurança</button>`);
  document.getElementById("chat-model").value = item.modelo || "qwen2.5:0.5b";
  const compact = document.getElementById("compact-mode"); compact.checked = localStorage.getItem(COMPACT_KEY) === "1";
  compact.onchange = () => { localStorage.setItem(COMPACT_KEY, compact.checked ? "1" : "0"); document.body.classList.toggle("compact-mode", compact.checked); };
  document.getElementById("save-settings").onclick = async () => { const button = document.getElementById("save-settings"); button.disabled = true; try { await patchActive({ nome: document.getElementById("chat-name").value, instrucoes: document.getElementById("chat-instructions").value, modelo: document.getElementById("chat-model").value }); closeModal(); } catch (e) { alert(e.message); button.disabled = false; } };
  document.getElementById("audit-button").onclick = auditModal;
}

async function memoryModal() {
  const item = activeChat(); if (!item) return; const memory = item.memoria || [];
  showModal("Memória", `<p class="modal-note">Memórias persistentes entram no contexto do modelo em todas as mensagens deste chat.</p><div id="memory-list">${memory.map((m, i) => `<div class="memory-row"><span>${escapeHtml(m)}</span><button data-memory="${i}" type="button">×</button></div>`).join("") || "<p>Nenhuma memória.</p>"}</div><div class="inline-add"><input id="memory-input" placeholder="Adicionar memória"><button class="primary" id="memory-add">Adicionar</button></div>`);
  document.querySelectorAll("[data-memory]").forEach(b => b.onclick = async () => { const next = [...memory]; next.splice(Number(b.dataset.memory), 1); await patchActive({ memoria: next }); memoryModal(); });
  document.getElementById("memory-add").onclick = async () => { const value = document.getElementById("memory-input").value.trim(); if (!value) return; await patchActive({ memoria: [...memory, value].slice(-100) }); memoryModal(); };
}

function sourcesModal() {
  const item = activeChat(); if (!item) return; const sources = item.fontes || [];
  showModal("Fontes", `<p class="modal-note">Fontes de texto são armazenadas no JSON do chat e incluídas como contexto da IA.</p><div>${sources.map((s, i) => `<div class="memory-row"><span>${escapeHtml(s.name)}</span><button data-source="${i}" type="button">×</button></div>`).join("") || "<p>Nenhuma fonte.</p>"}</div><button class="primary wide" id="choose-source">＋ Adicionar arquivo</button>`);
  document.querySelectorAll("[data-source]").forEach(b => b.onclick = async () => { const next = [...sources]; next.splice(Number(b.dataset.source), 1); await patchActive({ fontes: next }); sourcesModal(); });
  document.getElementById("choose-source").onclick = () => { closeModal(); fileInput.click(); };
}

async function handleFile(file) {
  if (!file || !state.activeId) return;
  if (file.size > 120000) throw new Error("O arquivo excede 120 KB.");
  if (!/\.(txt|md|json|csv|log)$/i.test(file.name)) throw new Error("Use TXT, MD, JSON, CSV ou LOG.");
  const content = await file.text();
  await patchActive({ fontes: [...(state.activeChat.fontes || []), { name: file.name, content }].slice(-10) });
  sourcesModal();
}

async function auditModal() {
  const data = await api("/api/audit/recent"); const events = data.events || [];
  showModal("Auditoria", events.length ? events.slice().reverse().map(e => `<div class="audit-row"><b>${escapeHtml(e.event)}</b><span>${new Date(e.timestamp).toLocaleString("pt-BR")}</span><em>${e.allowed === false ? "bloqueado" : "ok"}</em></div>`).join("") : "<p>Nenhum evento registrado.</p>");
}

loginForm.addEventListener("submit", e => { e.preventDefault(); login(loginEmail.value.trim(), loginPassword.value); });
input.addEventListener("input", resizeInput);
input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
form.addEventListener("submit", async e => {
  e.preventDefault(); const message = input.value.trim(); if (!message || state.sending || !state.activeId) return;
  const item = activeChat(); const messages = [...(item.mensagens || []), { role: "user", content: message }];
  state.sending = true; send.disabled = true; status.textContent = "Gerando..."; hideWelcome(); addMessage("user", message);
  try {
    if (item.nome === "Nova conversa") item.nome = message.length > 28 ? `${message.slice(0, 28)}…` : message;
    await patchActive({ nome: item.nome, mensagens: messages });
    input.value = ""; input.style.height = "auto";
    const answerElement = addMessage("assistant", ""); const answer = await streamResponse(messages, answerElement);
    if (answer) item.mensagens = [...messages, { role: "assistant", content: answer }];
    status.textContent = "Online";
  } catch (error) {
    const text = error.message || "Erro"; const answerElement = chat.lastElementChild; if (answerElement?.classList.contains("assistant")) answerElement.textContent = text; status.textContent = text.includes("guard") ? "Guard rail" : "Erro";
  } finally { state.sending = false; send.disabled = false; input.focus(); }
});

newChat.addEventListener("click", () => createChat());
search.addEventListener("input", renderChatList);
modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", e => { if (e.target === modalBackdrop) closeModal(); });
document.getElementById("brand").addEventListener("click", () => createChat());
document.getElementById("expand").addEventListener("click", async () => { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else await document.exitFullscreen?.(); });
document.getElementById("conversation-title").addEventListener("click", conversationModal);
document.getElementById("sources").addEventListener("click", sourcesModal);
document.getElementById("memory").addEventListener("click", memoryModal);
document.getElementById("settings").addEventListener("click", settingsModal);
document.getElementById("account-menu").addEventListener("click", () => showModal("Conta", `<p><strong>${escapeHtml(state.user?.name || "Korczak AI")}</strong></p><p>${escapeHtml(state.user?.email || "")}</p><div class="modal-actions"><button class="danger" id="logout-button">Sair</button></div>`));
document.getElementById("attach").addEventListener("click", sourcesModal);
fileInput.addEventListener("change", async () => { try { await handleFile(fileInput.files?.[0]); } catch (e) { alert(e.message); } finally { fileInput.value = ""; } });
document.addEventListener("click", e => { if (e.target.id === "logout-button") { closeModal(); logout(true); } });
document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); createChat(); } if (e.key === "Escape") closeModal(); });

function hideWelcome() { if (welcome) welcome.style.display = "none"; }
bootstrap();
