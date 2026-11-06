const message = document.getElementById("message");
const passwordStep = document.getElementById("password-step");
const codeStep = document.getElementById("code-step");

async function post(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({ ok: false, message: "Erreur réseau." }));
  return { ok: response.ok && data.ok, data };
}

passwordStep.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  const form = new FormData(passwordStep);
  const button = passwordStep.querySelector("button");
  button.disabled = true;
  const { ok, data } = await post("/api/login", { username: form.get("username"), password: form.get("password") });
  button.disabled = false;
  if (!ok) {
    message.textContent = data.message || "Connexion refusée.";
    return;
  }
  passwordStep.hidden = true;
  codeStep.hidden = false;
  document.getElementById("code-hint").textContent = `Code envoyé au ${data.phone}.`;
  codeStep.querySelector("input").focus();
});

codeStep.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  const code = new FormData(codeStep).get("code");
  const { ok, data } = await post("/api/verify", { code });
  if (ok) {
    window.location.href = "/";
    return;
  }
  message.textContent = data.message || "Code refusé.";
});

document.getElementById("restart").addEventListener("click", () => {
  codeStep.hidden = true;
  passwordStep.hidden = false;
  message.textContent = "";
});
