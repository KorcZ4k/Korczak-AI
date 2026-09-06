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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function activeChat() {
  return state.chats.find(c => String(c.id) === String(state.activeId));
}

function renderChatList() {
  chatList.innerHTML = "";
  const query = search.value.trim().toLowerCase();
  state.chats.forEach(item => {
    const name = item.nome || item.title || "Nova conversa";
    if (query && !name.toLowerCase().includes(query)) return;
    const button = document.createElement("button");
    button.className = `chat-item${String(item.id) === String(state.activeId) ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<small>${String(item.id).padStart(3, "0")}</small> ${escapeHtml(name)}`;
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

async function apiJson(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function createChat() {
  try {
    const item = await apiJson("/api/chats", { method: "POST", body: JSON.stringify({}) });
    state.chats.unshift(item);
    state.activeId = item.id;
    renderChatList();
    renderMessages([]);
    setConversationTitle(item.nome);
    input.focus();
  } catch (error) {
    status.textContent = "Banco offline";
    console.error(error);
  }
}

async function loadChats() {
  try {
    const data = await apiJson("/api/chats");
    state.chats = data.chats || [];
    state.nextId = Number(data.next_id || 1);
    if (state.chats.length) await openChat(state.chats[0].id);
    else await createChat();
    status.textContent = "Online · JSON DB";
  } catch (error) {
    status.textContent = "API offline";
    renderChatList();
    renderMessages([]);
    console.error(error);
  }
}

async function openChat(id) {
  try {
    const item = await apiJson(`/api/chats/${encodeURIComponent(id)}`);
    const index = state.chats.findIndex(c => String(c.id) === String(id));
    if (index >= 0) state.chats[index] = item;
    else state.chats.push(item);
    state.activeId = item.id;
    renderChatList();
    renderMessages(item.mensagens || []);
    setConversationTitle(item.nome);
    input.focus();
  } catch (error) {
    status.textContent = "Não foi possível abrir o chat";
    console.error(error);
  }
}

function setConversationTitle(title) {
  document.getElementById("conversation-title").firstChild.textContent = `${title || "Nova conversa"} `;
}

async function updateChat(item, patch) {
  const updated = await apiJson(`/api/chats/${encodeURIComponent(item.id)}`, {
    method: "PUT",
    body: JSON.stringify(patch)
  });
  Object.assign(item, updated);
  renderChatList();
  setConversationTitle(item.nome);
  return item;
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

async function streamResponse(messages, target, chatId) {
  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ chat_id: chatId, messages })
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
      answer += chunk?.message?.content || "";
    }
    target.textContent = answer;
  } finally {
    target.classList.remove("streaming");
    reader.releaseLock();
  }
  return answer;
}

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || state.sending) return;
  const item = activeChat();
  if (!item) return;

  hideWelcome();
  addMessage("user", message);
  item.mensagens = item.mensagens || [];
  item.mensagens.push({ role: "user", content: message });

  if ((item.nome || "Nova conversa") === "Nova conversa") {
    item.nome = message.length > 28 ? `${message.slice(0, 28)}…` : message;
  }

  try {
    await updateChat(item, { nome: item.nome, mensagens: item.mensagens });
  } catch (error) {
    status.textContent = "Erro ao salvar no banco";
    console.error(error);
  }

  input.value = "";
  input.style.height = "auto";
  state.sending = true;
  send.disabled = true;
  status.textContent = "Gerando...";
  const answerElement = addMessage("assistant", "");

  try {
    const answer = await streamResponse(item.mensagens, answerElement, item.id);
    if (answer) item.mensagens.push({ role: "assistant", content: answer });
    status.textContent = "Online · JSON DB";
  } catch (error) {
    answerElement.textContent = "Não foi possível conectar à API. Verifique o Render e o Ollama.";
    status.textContent = "API offline";
    console.error(error);
  } finally {
    state.sending = false;
    send.disabled = false;
    input.focus();
  }
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
  showModal("Conversa atual", `<p><strong>${escapeHtml(item?.nome || "Nova conversa")}</strong></p><p>${item?.mensagens?.length || 0} mensagens.</p><p>ID: ${escapeHtml(String(item?.id || "---"))}</p><p>Modelo: ${escapeHtml(item?.modelo || "qwen2.5:0.5b")}</p>`);
});
document.getElementById("sources").addEventListener("click", () => showModal("Fontes", "<p>A estrutura JSON está preparada para fontes por chat.</p>"));
document.getElementById("memory").addEventListener("click", () => {
  const item = activeChat();
  const memory = item?.memoria || [];
  showModal("Memória do chat", `<p>${memory.length} memória(s) salva(s).</p><pre>${escapeHtml(JSON.stringify(memory, null, 2))}</pre>`);
});
document.getElementById("settings").addEventListener("click", () => {
  const item = activeChat();
  showModal("Configurações do chat", `<label class="setting"><span>Nome</span><input id="chat-name" value="${escapeHtml(item?.nome || "Nova conversa")}"></label><label class="setting"><span>Instruções</span><textarea id="chat-instructions" rows="5">${escapeHtml(item?.instrucoes || "")}</textarea></label><button class="modal-save" id="save-chat-settings" type="button">Salvar</button>`);
  document.getElementById("save-chat-settings").addEventListener("click", async () => {
    if (!item) return;
    await updateChat(item, {
      nome: document.getElementById("chat-name").value,
      instrucoes: document.getElementById("chat-instructions").value
    });
    closeModal();
  });
});
document.getElementById("account-menu").addEventListener("click", () => showModal("Conta", "<p>Conta local. Autenticação será adicionada posteriormente.</p>"));
document.getElementById("attach").addEventListener("click", () => showModal("Adicionar", "<p>A estrutura do banco está preparada para adicionar fontes e arquivos por chat.</p>"));

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); createChat(); }
  if (event.key === "Escape") closeModal();
});

loadChats();
