const API_URL = "https://korczak-ai.onrender.com";

const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("message");
const send = document.getElementById("send");
const status = document.getElementById("status");
const welcome = document.getElementById("welcome-state");
const newChat = document.getElementById("new-chat");
const search = document.getElementById("search");
const history = [];

function addMessage(role, content = "") {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function hideWelcome() {
  if (welcome) welcome.style.display = "none";
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
}

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

async function streamResponse(messages, target) {
  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ messages })
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      detail = error.error || detail;
    } catch (_) {}
    throw new Error(detail);
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
      const piece = chunk?.message?.content || "";
      if (piece) answer += piece;
    }
    target.textContent = answer;
  } finally {
    target.classList.remove("streaming");
    reader.releaseLock();
  }

  return answer;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || send.disabled) return;

  hideWelcome();
  addMessage("user", message);
  history.push({ role: "user", content: message });
  input.value = "";
  input.style.height = "auto";
  send.disabled = true;
  status.textContent = "Gerando...";

  const answerElement = addMessage("assistant", "");

  try {
    const answer = await streamResponse(history, answerElement);
    if (!answer) answerElement.textContent = "Não recebi uma resposta do modelo.";
    else history.push({ role: "assistant", content: answer });
    status.textContent = "Online";
  } catch (error) {
    answerElement.classList.remove("streaming");
    answerElement.textContent = "Não foi possível conectar à API. Verifique o Render e o Ollama.";
    status.textContent = "API offline";
    console.error(error);
  } finally {
    send.disabled = false;
    input.focus();
  }
});

newChat.addEventListener("click", () => {
  history.length = 0;
  chat.innerHTML = "";
  chat.appendChild(welcome);
  welcome.style.display = "block";
  input.value = "";
  input.style.height = "auto";
  status.textContent = "Online";
  input.focus();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    input.focus();
  }
});

search.addEventListener("input", () => {
  const query = search.value.trim().toLowerCase();
  document.querySelectorAll(".chat-item").forEach((item) => {
    item.hidden = Boolean(query && !item.textContent.toLowerCase().includes(query));
  });
});
