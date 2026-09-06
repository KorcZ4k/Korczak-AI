// Configure the Render API URL here when the backend is deployed.
const API_URL = "https://SEU-SERVICO.onrender.com";

const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("message");
const send = document.getElementById("send");
const status = document.getElementById("status");

const history = [];

function addMessage(role, content) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || send.disabled) return;

  addMessage("user", message);
  history.push({ role: "user", content: message });
  input.value = "";
  input.style.height = "auto";
  send.disabled = true;
  status.textContent = "Pensando...";

  const thinking = addMessage("assistant", "...");

  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const answer = data.response || "Não recebi uma resposta válida da API.";
    thinking.textContent = answer;
    history.push({ role: "assistant", content: answer });
    status.textContent = "Online";
  } catch (error) {
    thinking.textContent = "Não foi possível conectar à API. Verifique se o servidor Render está ativo.";
    status.textContent = "API offline";
    console.error(error);
  } finally {
    send.disabled = false;
    input.focus();
  }
});
