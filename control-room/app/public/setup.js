const form = document.getElementById("setup-form");
const message = document.getElementById("message");
const token = new URLSearchParams(window.location.search).get("token") || "";
// Remove the one-time token from the address bar and history right away.
window.history.replaceState(null, "", "/setup");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  if (data.get("password") !== data.get("confirm")) {
    message.textContent = "Les deux mots de passe ne sont pas pareils.";
    return;
  }
  const response = await fetch("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password: data.get("password") }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok && body.ok) {
    form.hidden = true;
    message.textContent = "Mot de passe enregistré. Vous pouvez vous connecter.";
    setTimeout(() => (window.location.href = "/login"), 1500);
  } else {
    message.textContent = body.message || "Impossible d'enregistrer.";
  }
});
