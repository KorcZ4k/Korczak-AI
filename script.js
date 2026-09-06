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
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
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
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
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
  for (const item of state.chats) {
    if (query && !(item.nome || "").toLowerCase().includes(query)) continue;
    const button = document.createElement("button");
    button.className = `chat-item${String(item.id) === String(state.activeId) ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<small>${escapeHtml(item.id)}</small> ${escapeHtml(item.nome || "Nova conversa")}`;
    button.onclick = () => openChat(item.id);
    chatList.appendChild(button);
  }
  if (!chatList.children.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = query ? "Nenhum chat encontrado" : "Nenhum chat ainda";
    chatList.appendChild(empty);
  }
}

function renderMessages(messages = []) {
  chat.innerHTML = "";
  if (!messages.length) {
    chat.appendChild(welcome);
    welcome.style.display = "block";
    return;
  }
  welcome.style.display = "none";
  messages.forEach(message => addMessage(message.role, message.content));
}

function addMessage(role, content = "") {
  const element = document.createElement("div");
  element.className = `message ${role}`;
  element.textContent = content;
  chat.appendChild(element);
  chat.scrollTop = chat.scrollHeight;
  return element;
}

async function createChat(focus = true) {
  try {
    const item = await api("/api/chats", { method: "POST", body: JSON.stringify({ nome: "Nova conversa" }) });
    state.chats = [item, ...state.chats.filter(c => String(c.id) !== String(item.id))];
    state.activeId = item.id;
    state.activeChat = item;
    state.webSources = [];
    renderChatList();
    renderMessages([]);
    setConversationTitle(item.nome);
    if (focus) input.focus();
  } catch (error) { status.textContent = error.message; }
}

async function openChat(id) {
  try {
    const item = await api(`/api/chats/${encodeURIComponent(id)}`);
    state.activeId = item.id;
    state.activeChat = item;
    state.webSources = item.fontes_web || [];
    renderChatList();
    renderMessages(item.mensagens || []);
    setConversationTitle(item.nome);
    input.focus();
  } catch (error) { status.textContent = error.message; }
}

function setConversationTitle(title) {
  $("conversation-title").firstChild.textContent = `${title || "Nova conversa"} `;
}

async function patchActive(changes) {
  if (!state.activeId) return null;
  const item = await api(`/api/chats/${encodeURIComponent(state.activeId)}`, { method: "PATCH", body: JSON.stringify(changes) });
  state.activeChat = item;
  const index = state.chats.findIndex(c => String(c.id) === String(item.id));
  if (index >= 0) state.chats[index] = item;
  else state.chats.unshift(item);
  renderChatList();
  setConversationTitle(item.nome);
  return item;
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
}

function showModal(title, html) {
  modalTitle.textContent = title;
  modalContent.innerHTML = html;
  modalBackdrop.hidden = false;
}
function closeModal() { modalBackdrop.hidden = true; }

async function streamResponse(messages, target) {
  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { ...authHeaders(true), Accept: "application/x-ndjson" },
    body: JSON.stringify({ chat_id: state.activeId, messages })
  });
  if (response.status === 401) { await logout(false); throw new Error("Sessão expirada"); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("Streaming não suportado pelo navegador");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let answer = "";
  target.classList.add("streaming");

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.korczak?.sources) {
          state.webSources = chunk.korczak.sources;
          continue;
        }
        const piece = chunk?.message?.content || "";
        if (piece) {
          answer += piece;
          target.textContent = answer;
          chat.scrollTop = chat.scrollHeight;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const chunk = JSON.parse(buffer);
      if (chunk.korczak?.sources) state.webSources = chunk.korczak.sources;
      answer += chunk?.message?.content || "";
    }
    target.textContent = answer;
  } finally {
    target.classList.remove("streaming");
    reader.releaseLock();
  }
  return answer;
}

async function conversationModal() {
  const item = activeChat();
  if (!item) return;
  showModal("Conversa atual", `<p><strong>${escapeHtml(item.nome)}</strong></p><p>ID: ${escapeHtml(item.id)}</p><p>Modelo: ${escapeHtml(item.modelo || "qwen2.5:0.5b")}</p><p>${item.mensagens?.length || 0} mensagens · ${(item.memoria || []).length + (item.memoria_automatica || []).length} memórias · ${(item.fontes || []).length} arquivos.</p><div class="modal-actions"><button class="danger" id="delete-chat" type="button">Excluir chat</button><button class="primary" id="rename-chat" type="button">Editar</button></div>`);
  $("rename-chat").onclick = settingsModal;
  $("delete-chat").onclick = async () => {
    if (!confirm("Excluir esta conversa?")) return;
    try {
      await api(`/api/chats/${encodeURIComponent(state.activeId)}`, { method: "DELETE" });
      state.chats = state.chats.filter(c => String(c.id) !== String(state.activeId));
      state.activeId = null;
      state.activeChat = null;
      closeModal();
      if (state.chats.length) await openChat(state.chats[0].id);
      else await createChat(false);
    } catch (error) { alert(error.message); }
  };
}

async function settingsModal() {
  const item = activeChat();
  if (!item) return;
  showModal("Configurações do chat", `<label class="field">Nome<input id="chat-name" value="${escapeHtml(item.nome)}"></label><label class="field">Instruções<textarea id="chat-instructions" rows="6" placeholder="Instruções específicas para este chat">${escapeHtml(item.instrucoes || "")}</textarea></label><label class="field">Modelo<select id="chat-model"><option>qwen2.5:0.5b</option></select></label><label class="setting"><input type="checkbox" id="compact-mode"> Modo compacto</label><button class="primary wide" id="save-settings">Salvar</button><button class="secondary wide" id="audit-button">Auditoria</button>`);
  $("chat-model").value = item.modelo || "qwen2.5:0.5b";
  const compact = $("compact-mode");
  compact.checked = localStorage.getItem(COMPACT_KEY) === "1";
  compact.onchange = () => {
    localStorage.setItem(COMPACT_KEY, compact.checked ? "1" : "0");
    document.body.classList.toggle("compact-mode", compact.checked);
  };
  $("save-settings").onclick = async () => {
    const button = $("save-settings");
    button.disabled = true;
    try {
      await patchActive({ nome: $("chat-name").value.trim() || "Nova conversa", instrucoes: $("chat-instructions").value, modelo: $("chat-model").value });
      closeModal();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  };
  $("audit-button").onclick = auditModal;
}

async function memoryModal() {
  const item = activeChat();
  if (!item) return;
  const manual = Array.isArray(item.memoria) ? item.memoria : [];
  const automatic = Array.isArray(item.memoria_automatica) ? item.memoria_automatica : [];
  const all = [...manual.map(text => ({ text, automatic: false })), ...automatic.map(text => ({ text, automatic: true }))];
  showModal("Memória", `<p class="modal-note">A memória entra no contexto da IA. Memória automática só é criada quando você pede para lembrar.</p><div id="memory-list">${all.length ? all.map((m, i) => `<div class="memory-row"><span>${m.automatic ? "⚡ " : ""}${escapeHtml(m.text)}</span><button data-memory="${i}" type="button">×</button></div>`).join("") : "<p>Nenhuma memória.</p>"}</div><div class="inline-add"><input id="memory-input" placeholder="Adicionar memória"><button class="primary" id="memory-add">Adicionar</button></div>`);

  document.querySelectorAll("[data-memory]").forEach(button => {
    button.onclick = async () => {
      const index = Number(button.dataset.memory);
      if (index < manual.length) {
        const nextManual = [...manual];
        nextManual.splice(index, 1);
        await patchActive({ memoria: nextManual });
      } else {
        const nextAutomatic = [...automatic];
        nextAutomatic.splice(index - manual.length, 1);
        await patchActive({ memoria_automatica: nextAutomatic });
      }
      memoryModal();
    };
  });

  $("memory-add").onclick = async () => {
    const value = $("memory-input").value.trim();
    if (!value) return;
    await patchActive({ memoria: [...manual, value].slice(-100) });
    memoryModal();
  };
}

function sourcesModal() {
  const item = activeChat();
  if (!item) return;
  const local = Array.isArray(item.fontes) ? item.fontes : [];
  const web = state.webSources.length ? state.webSources : (item.fontes_web || []);
  showModal("Fontes", `<p class="modal-note">Arquivos locais e resultados web usados pelo chat.</p><h3>Arquivos</h3><div>${local.length ? local.map((source, i) => `<div class="memory-row"><span>▤ ${escapeHtml(source.name)}</span><button data-source="${i}" type="button">×</button></div>`).join("") : "<p>Nenhum arquivo.</p>"}</div><h3>Web</h3><div class="source-list">${web.length ? web.slice(-10).reverse().map(source => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.snippet || source.url)}</small></a>`).join("") : "<p>Nenhuma pesquisa web recente.</p>"}</div><button class="primary wide" id="choose-source">＋ Adicionar arquivo</button>`);
  document.querySelectorAll("[data-source]").forEach(button => {
    button.onclick = async () => {
      const next = [...local];
      next.splice(Number(button.dataset.source), 1);
      await patchActive({ fontes: next });
      sourcesModal();
    };
  });
  $("choose-source").onclick = () => { closeModal(); fileInput.click(); };
}

async function handleFile(file) {
  if (!file || !state.activeId) return;
  if (file.size > 120000) throw new Error("O arquivo excede 120 KB.");
  if (!/\.(txt|md|json|csv|log)$/i.test(file.name)) throw new Error("Use TXT, MD, JSON, CSV ou LOG.");
  const content = await file.text();
  if (!content.trim()) throw new Error("O arquivo está vazio.");
  const sources = [...(state.activeChat.fontes || []), { name: file.name, content }].slice(-10);
  await patchActive({ fontes: sources });
  sourcesModal();
}

async function auditModal() {
  try {
    const data = await api("/api/audit/recent");
    const events = data.events || [];
    showModal("Auditoria de segurança", events.length ? events.slice().reverse().map(event => `<div class="audit-row"><b>${escapeHtml(event.event)}</b><span>${new Date(event.timestamp).toLocaleString("pt-BR")}</span><em>${event.allowed === false ? "bloqueado" : "ok"}</em></div>`).join("") : "<p>Nenhum evento registrado.</p>");
  } catch (error) { showModal("Auditoria", `<p>${escapeHtml(error.message)}</p>`); }
}

loginForm.addEventListener("submit", event => { event.preventDefault(); login(loginEmail.value.trim(), loginPassword.value); });
input.addEventListener("input", resizeInput);
input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });

form.addEventListener("submit", async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || state.sending || !state.activeId) return;
  const item = activeChat();
  const messages = [...(item.mensagens || []), { role: "user", content: message }];
  state.sending = true;
  send.disabled = true;
  status.textContent = "Gerando...";
  welcome.style.display = "none";
  addMessage("user", message);
  try {
    if (item.nome === "Nova conversa") item.nome = message.length > 28 ? `${message.slice(0, 28)}…` : message;
    await patchActive({ nome: item.nome, mensagens: messages });
    input.value = "";
    input.style.height = "auto";
    const answerElement = addMessage("assistant", "");
    const answer = await streamResponse(messages, answerElement);
    if (answer) await patchActive({ mensagens: [...messages, { role: "assistant", content: answer }], fontes_web: state.webSources });
    status.textContent = "Online";
  } catch (error) {
    const last = chat.lastElementChild;
    if (last?.classList.contains("assistant")) last.textContent = error.message || "Não foi possível gerar a resposta.";
    status.textContent = "Erro";
    console.error(error);
  } finally {
    state.sending = false;
    send.disabled = false;
    input.focus();
  }
});

newChat.addEventListener("click", () => createChat());
search.addEventListener("input", renderChatList);
modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", event => { if (event.target === modalBackdrop) closeModal(); });
$("brand").addEventListener("click", () => createChat());
$("expand").addEventListener("click", async () => { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else await document.exitFullscreen?.(); } catch (_) {} });
$("conversation-title").addEventListener("click", conversationModal);
$("sources").addEventListener("click", sourcesModal);
$("memory").addEventListener("click", memoryModal);
$("settings").addEventListener("click", settingsModal);
$("account-menu").addEventListener("click", () => {
  const name = state.user?.name || "Usuário";
  const email = state.user?.email || "";
  showModal("Conta", `<p><strong>${escapeHtml(name)}</strong></p><p>${escapeHtml(email)}</p><button class="danger wide" id="logout-button">Sair da conta</button>`);
  $("logout-button").onclick = () => logout(true);
});
$("attach").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  try { await handleFile(fileInput.files[0]); }
  catch (error) { alert(error.message); }
  finally { fileInput.value = ""; }
});

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); createChat(); }
  if (event.key === "Escape") closeModal();
});

bootstrap();
