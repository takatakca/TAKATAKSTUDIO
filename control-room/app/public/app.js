// TAKATAK Control Room — the screens wall (same views as the Food Hub wall:
// grid 1/2/3/4/6, tabs, custom 12 × 12 board), plus locks, camera and journal.
// Tiles are created once and never moved in the page (a moved frame would
// reload its screen): views only change their CSS position and visibility.
import {
  addTile,
  BOARD,
  changeTile,
  clampTile,
  defaultCustom,
  DEFAULT_WALL,
  gridShape,
  moveId,
  orderIds,
  parseWall,
  removeTile,
  screenId,
  screenNumber,
} from "./wall-layout.js";

const state = { me: null, screens: [], wall: { ...DEFAULT_WALL }, arrange: false, camera: false, tiles: new Map(), drag: null };
const wallEl = document.getElementById("wall");
const tabbar = document.getElementById("tabbar");
const banner = document.getElementById("banner");
const recState = document.getElementById("rec-state");

// ---------- helpers ----------
function saveWall() {
  try {
    localStorage.setItem("takatak-cr-wall", JSON.stringify(state.wall));
  } catch {}
}
function loadWall() {
  try {
    const raw = localStorage.getItem("takatak-cr-wall");
    return raw ? parseWall(raw) : null;
  } catch {
    return null;
  }
}
async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("logged_out");
  }
  const data = await response.json().catch(() => ({ ok: false }));
  return { ok: response.ok && data.ok, status: response.status, data };
}
const showBanner = (text) => {
  banner.textContent = text || "";
  banner.hidden = !text;
};
const timeOf = (ms) => new Date(ms).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" });
const ids = () => state.screens.map((s) => screenId(s.screen));
const infoOf = (id) => state.screens.find((s) => screenId(s.screen) === id);

// ---------- camera: required, every session is recorded ----------
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 10 }, audio: false });
    document.getElementById("camera-preview").srcObject = stream;
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 300_000 });
    recorder.ondataavailable = async (event) => {
      if (!event.data.size) return;
      const response = await fetch("/api/camera", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: event.data }).catch(() => null);
      state.camera = Boolean(response?.ok);
      recState.textContent = state.camera ? "● Enregistrement" : "Caméra : envoi en échec";
      recState.classList.toggle("on", state.camera);
    };
    recorder.start(5000);
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      state.camera = false;
      recState.textContent = "Caméra arrêtée";
      recState.classList.remove("on");
      showBanner("La caméra est arrêtée. Rechargez la page pour la rallumer : sans caméra, les écrans se libèrent.");
    });
    recState.textContent = "Caméra prête…";
  } catch {
    recState.textContent = "Caméra refusée";
    if (state.me?.cameraRequired) showBanner("Autorisez la caméra pour travailler : chaque session est enregistrée (écran et caméra).");
  }
}

// ---------- tiles ----------
function createTile(id) {
  const n = screenNumber(id);
  const tile = document.getElementById("tile-template").content.firstElementChild.cloneNode(true);
  tile.dataset.id = id;
  tile.querySelector(".title").textContent = `Écran ${n}`;
  tile.querySelector(".arrange-name").textContent = `Écran ${n}`;
  const bar = tile.querySelector(".tile-bar");

  tile.querySelector(".take").addEventListener("click", async () => {
    const { ok, data } = await api("POST", `/api/screens/${n}/take`, {});
    showBanner(ok ? "" : data.message);
    await refresh();
  });
  tile.querySelector(".release").addEventListener("click", async () => {
    await api("POST", `/api/screens/${n}/release`, {});
    await refresh();
  });
  tile.querySelector(".force").addEventListener("click", async () => {
    if (!confirm(`Libérer l'écran ${n} de force ?`)) return;
    await api("POST", `/api/screens/${n}/release`, { force: true });
    await refresh();
  });
  tile.querySelector(".admin-lock").addEventListener("click", async () => {
    await api("POST", `/api/screens/${n}/admin-lock`, { locked: !infoOf(id)?.adminLocked });
    await refresh();
  });
  tile.querySelector(".expand").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else tile.requestFullscreen?.();
  });
  // Double-click the title bar: this screen big (tabs view), as on the Food Hub wall.
  bar.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    setWall({ view: "tabs", tab: id });
  });
  // Drag a title bar onto another screen to swap their places (grid and tabs).
  bar.draggable = true;
  bar.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", id));
  tile.addEventListener("dragover", (event) => event.preventDefault());
  tile.addEventListener("drop", (event) => {
    event.preventDefault();
    const from = event.dataTransfer.getData("text/plain");
    if (from && from !== id) setWall({ order: moveId(state.wall.order, from, id) });
  });

  // Custom board: move by the layer, resize by the corner, arrows / Shift+arrows from the keyboard.
  const layer = tile.querySelector(".arrange-layer");
  layer.addEventListener("pointerdown", (event) => startDrag(event, id, "move"));
  tile.querySelector(".arrange-resize").addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    startDrag(event, id, "resize");
  });
  tile.querySelector(".arrange-remove").addEventListener("pointerdown", (event) => event.stopPropagation());
  tile.querySelector(".arrange-remove").addEventListener("click", () => setWall({ custom: removeTile(state.wall.custom, id) }));
  layer.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step || !state.arrange) return;
    event.preventDefault();
    setWall({ custom: changeTile(state.wall.custom, id, event.shiftKey ? { dw: step[0], dh: step[1] } : { dx: step[0], dy: step[1] }) });
  });

  wallEl.appendChild(tile);
  state.tiles.set(id, tile);
  return tile;
}

function startDrag(event, id, mode) {
  if (!state.arrange || event.button !== 0) return;
  const base = state.wall.custom.find((t) => t.id === id);
  if (!base) return;
  event.preventDefault();
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  state.drag = { id, mode, x: event.clientX, y: event.clientY, base, live: base };
  const move = (e) => {
    const d = state.drag;
    if (!d) return;
    const dx = Math.round((e.clientX - d.x) / (wallEl.clientWidth / BOARD));
    const dy = Math.round((e.clientY - d.y) / (wallEl.clientHeight / BOARD));
    d.live = clampTile(d.mode === "move" ? { ...d.base, x: d.base.x + dx, y: d.base.y + dy } : { ...d.base, w: d.base.w + dx, h: d.base.h + dy });
    place(state.tiles.get(id), d.live);
  };
  const end = () => {
    const d = state.drag;
    state.drag = null;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    if (d) setWall({ custom: changeTile(state.wall.custom, d.id, { dx: d.live.x - d.base.x, dy: d.live.y - d.base.y, dw: d.live.w - d.base.w, dh: d.live.h - d.base.h }) });
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

function place(tile, t) {
  tile.style.left = `${(t.x / BOARD) * 100}%`;
  tile.style.top = `${(t.y / BOARD) * 100}%`;
  tile.style.width = `${(t.w / BOARD) * 100}%`;
  tile.style.height = `${(t.h / BOARD) * 100}%`;
}

function updateTileContent(id, tile) {
  const info = infoOf(id);
  if (!info) return;
  const label = info.adminLocked ? "Bloqué" : info.mine ? "À vous" : info.holder ? `Occupé : ${info.holder}` : "Libre";
  tile.querySelector(".state").textContent = label;
  tile.classList.toggle("mine", info.mine);
  tile.classList.toggle("busy", Boolean(info.holder) && !info.mine);
  tile.querySelector(".take").hidden = info.mine || Boolean(info.holder) || info.adminLocked;
  tile.querySelector(".release").hidden = !info.mine;
  tile.querySelector(".force").hidden = !(state.me?.supervisor && info.holder && !info.mine);
  const lockButton = tile.querySelector(".admin-lock");
  lockButton.hidden = !state.me?.supervisor;
  lockButton.textContent = info.adminLocked ? "Débloquer" : "Bloquer";

  const body = tile.querySelector(".body");
  const frame = body.querySelector("iframe");
  if (info.mine) {
    if (!frame) {
      body.textContent = "";
      const iframe = document.createElement("iframe");
      iframe.title = `Écran ${info.screen}`;
      iframe.src = `/${id}/`;
      iframe.allow = "clipboard-read; clipboard-write; fullscreen";
      body.appendChild(iframe);
    }
  } else {
    if (frame || !body.querySelector(".placeholder")) body.innerHTML = '<p class="placeholder"></p>';
    body.querySelector(".placeholder").textContent = info.adminLocked
      ? "Écran bloqué par l'administrateur."
      : info.holder
        ? `${info.holder} travaille sur cet écran depuis ${timeOf(info.since)}.`
        : "Écran libre. Cliquez « Prendre » pour l'ouvrir.";
  }
}

// ---------- views ----------
function setWall(patch) {
  state.wall = { ...state.wall, ...patch };
  if (state.wall.view !== "custom") state.arrange = false;
  saveWall();
  render();
}

function render() {
  const all = ids();
  for (const id of all) if (!state.tiles.has(id)) createTile(id);
  state.wall.order = orderIds(all, state.wall.order);
  const { view } = state.wall;
  wallEl.dataset.view = view;
  wallEl.classList.toggle("arranging", state.arrange);
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.getElementById("arrange").hidden = view !== "custom";
  document.getElementById("arrange").textContent = state.arrange ? "Terminer" : "Arranger";
  document.getElementById("even-grid").hidden = !state.arrange;

  // Screens not on the custom board, offered while arranging.
  const unplaced = document.getElementById("unplaced");
  unplaced.textContent = "";
  unplaced.hidden = !(view === "custom" && state.arrange);
  if (!unplaced.hidden) {
    for (const id of state.wall.order.filter((x) => !state.wall.custom.some((t) => t.id === x))) {
      const b = document.createElement("button");
      b.className = "ghost";
      b.textContent = `+ Écran ${screenNumber(id)}`;
      b.addEventListener("click", () => setWall({ custom: addTile(state.wall.custom, id) }));
      unplaced.appendChild(b);
    }
  }

  tabbar.hidden = view !== "tabs";
  const active = state.wall.order.includes(state.wall.tab) ? state.wall.tab : state.wall.order[0];
  if (view === "tabs") {
    tabbar.textContent = "";
    for (const id of state.wall.order) {
      const info = infoOf(id);
      const b = document.createElement("button");
      b.role = "tab";
      b.className = id === active ? "on" : "";
      b.setAttribute("aria-selected", String(id === active));
      b.textContent = `Écran ${screenNumber(id)}${info?.mine ? " · à vous" : info?.holder ? ` · ${info.holder}` : ""}`;
      b.addEventListener("click", () => setWall({ tab: id }));
      tabbar.appendChild(b);
    }
  }

  const per = view === "tabs" || view === "custom" ? 0 : Number(view);
  if (per) {
    const shape = gridShape(per);
    wallEl.style.gridTemplateColumns = `repeat(${shape.cols}, 1fr)`;
    wallEl.style.gridTemplateRows = `repeat(${shape.rows}, 1fr)`;
  } else {
    wallEl.style.gridTemplateColumns = "";
    wallEl.style.gridTemplateRows = "";
  }

  for (const [id, tile] of state.tiles) {
    const index = state.wall.order.indexOf(id);
    const onBoard = state.wall.custom.find((t) => t.id === id);
    let visible;
    if (view === "custom") visible = Boolean(onBoard);
    else if (view === "tabs") visible = id === active;
    else visible = index >= 0 && index < per;
    tile.hidden = !visible;
    tile.style.order = String(index);
    if (view === "custom" && onBoard && !(state.drag && state.drag.id === id)) place(tile, onBoard);
    tile.style.zIndex = view === "custom" && onBoard ? String(state.wall.custom.indexOf(onBoard) + 1) : "";
    if (view !== "custom") tile.style.left = tile.style.top = tile.style.width = tile.style.height = "";
    tile.querySelector(".arrange-layer").hidden = !(view === "custom" && state.arrange);
    updateTileContent(id, tile);
  }
}

// ---------- data ----------
async function refresh() {
  const { ok, data } = await api("GET", "/api/screens");
  if (!ok) return;
  state.screens = data.screens;
  render();
}

async function heartbeat() {
  for (const info of state.screens.filter((s) => s.mine)) {
    const { ok, data } = await api("POST", `/api/screens/${info.screen}/heartbeat`, {});
    if (!ok) showBanner(data.message);
  }
}

async function loadSide() {
  const notes = await api("GET", "/api/notes");
  const list = document.getElementById("notes");
  list.textContent = "";
  for (const note of notes.data.notes ?? []) {
    const li = document.createElement("li");
    li.textContent = `${timeOf(note.at)} · ${note.username}${note.screen ? ` · écran ${note.screen}` : ""} — ${note.text}`;
    list.appendChild(li);
  }
  if (!state.me.supervisor) return;
  const events = await api("GET", "/api/events");
  const eventList = document.getElementById("events");
  eventList.textContent = "";
  for (const e of events.data.events ?? []) {
    const li = document.createElement("li");
    li.textContent = `${timeOf(e.at)} · ${e.username ?? "—"}${e.screen ? ` · écran ${e.screen}` : ""} · ${e.type}${e.detail ? ` (${e.detail})` : ""}`;
    eventList.appendChild(li);
  }
  const recordings = await api("GET", "/api/recordings");
  const recList = document.getElementById("recordings");
  recList.textContent = "";
  for (const r of recordings.data.recordings ?? []) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `/recordings/${r.path}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = `${r.path} (${(r.bytes / 1_048_576).toFixed(1)} Mo)`;
    li.appendChild(a);
    recList.appendChild(li);
  }
}

// ---------- start ----------
async function main() {
  const me = await api("GET", "/api/me");
  state.me = me.data;
  document.getElementById("who").textContent = state.me.username;
  document.getElementById("supervisor").hidden = !state.me.supervisor;
  document.getElementById("share-layout").hidden = !state.me.supervisor;
  const select = document.querySelector("#note-form select");
  for (let n = 1; n <= state.me.screenCount; n += 1) select.add(new Option(`Écran ${n}`, String(n)));

  // This device's layout; a device without one starts from the shared layout.
  const own = loadWall();
  if (own) state.wall = own;
  else {
    const shared = await api("GET", "/api/layout");
    if (shared.data.wall) state.wall = parseWall(shared.data.wall);
  }

  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => setWall({ view: b.dataset.view })));
  document.getElementById("arrange").addEventListener("click", () => {
    state.arrange = !state.arrange;
    if (state.arrange && !state.wall.custom.length) state.wall.custom = defaultCustom(state.wall.order);
    saveWall();
    render();
  });
  document.getElementById("even-grid").addEventListener("click", () => setWall({ custom: defaultCustom(state.wall.order) }));
  document.getElementById("share-layout").addEventListener("click", async () => {
    const { ok, data } = await api("PUT", "/api/layout", { wall: state.wall });
    showBanner(ok ? "Disposition partagée : les appareils sans disposition à eux partent de celle-ci." : data.message);
  });
  document.getElementById("use-shared").addEventListener("click", async () => {
    const { data } = await api("GET", "/api/layout");
    if (data.wall) {
      setWall(parseWall(data.wall));
      showBanner("Disposition partagée reprise.");
    } else showBanner("Aucune disposition partagée pour l'instant.");
  });
  document.getElementById("wall-full").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.getElementById("wall-area").requestFullscreen?.();
  });

  await refresh();
  startCamera();

  document.getElementById("toggle-side").addEventListener("click", () => {
    const side = document.getElementById("side");
    side.hidden = !side.hidden;
    if (!side.hidden) loadSide();
  });
  document.getElementById("note-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const screen = form.get("screen") ? Number(form.get("screen")) : null;
    const { ok, data } = await api("POST", "/api/notes", { text: form.get("text"), screen });
    if (ok) {
      event.target.reset();
      loadSide();
    } else showBanner(data.message);
  });
  document.getElementById("logout").addEventListener("click", async () => {
    await api("POST", "/api/logout", {});
    window.location.href = "/login";
  });

  setInterval(refresh, 10_000);
  setInterval(heartbeat, 30_000);
}

main();
