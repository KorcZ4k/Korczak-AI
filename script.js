const API_URL = "https://korczak-ai.onrender.com";

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

const state = { chats: [], activeId: null, nextId: 1, sending: false };

function saveChats() {
  localStorage.setItem("korczak_chats", JSON.stringify(state.chats));
}

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem("korczak_chats") || "[]");
    if (Array.isArray(saved)) state.chats = saved;
  } catch (_) { state.chats = []; }
  state.nextId = Math.max(1, ...state.chats.map(c => Number(c.id) || 0)) + 1;
  if (state.chats.length) state.activeId = state.chats[0].id;
}

function activeChat() { return state.chats.find(c => c.id === state.activeId); }

function renderChatList() {
  chatList.innerHTML = "";
  const query = search.value.trim().toLowerCase();
  state.chats.forEach((item) => {
    if (query && !item.title.toLowerCase().includes(query)) return;
    const button = document.createElement("button");
    button.className = `chat-item${item.id === state.activeId ? " active" : ""}`;
    button.type = "button";
    button.dataset.id = item.id;
    button.innerHTML = `<small>${String(item.id).padStart(3, "0")}</small> ${escapeHtml(item.title)}`;
    button.addEventListener("click", () => openChat(item.id));
    chatList.appendChild(button);
  });
  if (!chatList.children.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = query ? "Nenhum chat encontrado" : "Nenhum chat ainda";
    chatList.appendChild(empty);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function addMessage(role, content = "") {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function renderMessages(messages) {
  chat.innerHTML = "";
  if (!messages.length) {
    chat.appendChild(welcome);
    welcome.style.display = "block";
    return;
  }
  welcome.style.display = "none";
  messages.forEach(m => addMessage(m.role, m.content));
}

function createChat() {
  const item = { id: state.nextId++, title: "Nova conversa", messages: [] };
  state.chats.unshift(item);
  state.activeId = item.id;
  saveChats();
  renderChatList();
  renderMessages([]);
  document.getElementById("conversation-title").firstChild.textContent = "Nova conversa ";
  input.focus();
}

function openChat(id) {
  state.activeId = id;
  const item = activeChat();
  if (!item) return;
  renderChatList();
  renderMessages(item.messages);
  document.getElementById("conversation-title").firstChild.textContent = `${item.title} `;
  input.focus();
}

function ensureChat() {
  if (!activeChat()) createChat();
  return activeChat();
}

function hideWelcome() {
  if (welcome) welcome.style.display = "none";
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
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ messages })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("Streaming não suportado pelo navegador");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "", answer = "";
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
        const piece = chunk?.message?.content || "";
        if (piece) { answer += piece; target.textContent = answer; chat.scrollTop = chat.scrollHeight; }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const chunk = JSON.parse(buffer);
      answer += chunk?.message?.content || "";
    }
    target.textContent = answer;
  } finally { target.classList.remove("streaming"); reader.releaseLock(); }
  return answer;
}

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || state.sending) return;
  const item = ensureChat();
  hideWelcome();
  addMessage("user", message);
  item.messages.push({ role: "user", content: message });
  if (item.title === "Nova conversa") {
    item.title = message.length > 28 ? `${message.slice(0, 28)}…` : message;
    renderChatList();
    document.getElementById("conversation-title").firstChild.textContent = `${item.title} `;
  }
  saveChats();
  input.value = ""; input.style.height = "auto";
  state.sending = true; send.disabled = true; status.textContent = "Gerando...";
  const answerElement = addMessage("assistant", "");
  try {
    const answer = await streamResponse(item.messages, answerElement);
    if (answer) item.messages.push({ role: "assistant", content: answer });
    saveChats(); status.textContent = "Online";
  } catch (error) {
    answerElement.textContent = "Não foi possível conectar à API. Verifique o Render e o Ollama.";
    status.textContent = "API offline"; console.error(error);
  } finally { state.sending = false; send.disabled = false; input.focus(); }
});

newChat.addEventListener("click", createChat);
search.addEventListener("input", renderChatList);
modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", e => { if (e.target === modalBackdrop) closeModal(); });

document.getElementById("brand").addEventListener("click", createChat);
document.getElementById("expand").addEventListener("click", async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  else await document.exitFullscreen?.();
});
document.getElementById("conversation-title").addEventListener("click", () => {
  const item = activeChat();
  showModal("Conversa atual", `<p><strong>${escapeHtml(item?.title || "Nova conversa")}</strong></p><p>${item?.messages.length || 0} mensagens nesta conversa.</p>`);
});
document.getElementById("sources").addEventListener("click", () => showModal("Fontes", "<p>As fontes usadas pelo Korczak AI aparecerão aqui quando a pesquisa de fontes for ativada.</p>"));
document.getElementById("memory").addEventListener("click", () => showModal("Memória", "<p>A memória persistente por usuário será conectada ao MongoDB na próxima etapa.</p>"));
document.getElementById("settings").addEventListener("click", () => showModal("Configurações", "<label class='setting'><input type='checkbox' id='compact-mode'> Modo compacto</label><p class='modal-note'>As preferências ficam salvas neste navegador.</p>"));
document.getElementById("account-menu").addEventListener("click", () => showModal("Conta", "<p>Você está usando a Korczak AI sem login.</p><p>O sistema de autenticação será adicionado posteriormente.</p>"));
document.getElementById("attach").addEventListener("click", () => showModal("Adicionar", "<p>Envio de arquivos será conectado quando o sistema de fontes estiver disponível.</p>"));

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); createChat(); }
  if (event.key === "Escape") closeModal();
});

loadChats();
if (state.chats.length) openChat(state.activeId); else { renderChatList(); renderMessages([]); }
