// TAKATAK Control Room — screens wall layouts, ported from the Food Hub screens
// wall (takatakca/foodhubca lib/ui/screens-layout.ts): a grid of 1, 2, 3, 4 or 6
// screens, tabs (one big screen, the others as tabs), or a custom board where
// each screen is dragged and resized on a 12 × 12 grid. Pure, so it is tested;
// the same file runs in the browser and on the server.

export const GRID_VIEWS = [1, 2, 3, 4, 6];
export const WALL_VIEWS = ["1", "2", "3", "4", "6", "tabs", "custom"];
export const BOARD = 12;
export const MIN_TILE = 2;
export const DEFAULT_WALL = { view: "6", order: [], tab: null, custom: [] };

/** Columns × rows of each grid view. */
export function gridShape(view) {
  switch (Number(view)) {
    case 1: return { cols: 1, rows: 1 };
    case 2: return { cols: 2, rows: 1 };
    case 3: return { cols: 3, rows: 1 };
    case 4: return { cols: 2, rows: 2 };
    default: return { cols: 3, rows: 2 };
  }
}

/** Saved order first (only ids that still exist), then the screens not in it yet. */
export function orderIds(ids, saved) {
  const known = new Set(ids);
  const kept = saved.filter((id, i) => known.has(id) && saved.indexOf(id) === i);
  const seen = new Set(kept);
  return [...kept, ...ids.filter((id) => !seen.has(id))];
}

/** Drag `from` onto `to`: `from` takes `to`'s place, the others shift. */
export function moveId(order, from, to) {
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 || j < 0 || i === j) return order;
  const next = order.slice();
  next.splice(i, 1);
  next.splice(j, 0, from);
  return next;
}

/** Keep a tile inside the board, at least MIN_TILE × MIN_TILE. */
export function clampTile(t) {
  const w = Math.min(BOARD, Math.max(MIN_TILE, Math.round(t.w)));
  const h = Math.min(BOARD, Math.max(MIN_TILE, Math.round(t.h)));
  return { id: t.id, w, h, x: Math.min(BOARD - w, Math.max(0, Math.round(t.x))), y: Math.min(BOARD - h, Math.max(0, Math.round(t.y))) };
}

/** A first custom board: every screen in an even grid. */
export function defaultCustom(ids) {
  const n = Math.min(ids.length, 36);
  if (!n) return [];
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const w = BOARD / cols;
  const h = Math.max(MIN_TILE, Math.floor(BOARD / Math.min(rows, 6)));
  return ids.slice(0, n).map((id, i) => clampTile({ id, x: (i % cols) * w, y: (Math.floor(i / cols) % 6) * h, w, h }));
}

/** Move or resize a tile by whole cells; it comes to the front. */
export function changeTile(tiles, id, d) {
  const t = tiles.find((x) => x.id === id);
  if (!t) return tiles;
  const next = clampTile({ id, x: t.x + (d.dx ?? 0), y: t.y + (d.dy ?? 0), w: t.w + (d.dw ?? 0), h: t.h + (d.dh ?? 0) });
  return [...tiles.filter((x) => x.id !== id), next];
}

/** Put a screen on the custom board (centre, 4 × 4), or take it off. */
export function addTile(tiles, id) {
  if (tiles.some((t) => t.id === id)) return tiles;
  return [...tiles, clampTile({ id, x: 4, y: 4, w: 4, h: 4 })];
}
export const removeTile = (tiles, id) => tiles.filter((t) => t.id !== id);

/** Read a saved layout; anything odd falls back to the defaults. */
export function parseWall(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!v || typeof v !== "object") return { ...DEFAULT_WALL };
    const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && /^s\d{2}$/.test(x)).slice(0, 24) : []);
    const custom = Array.isArray(v.custom)
      ? v.custom
          .filter((t) => t && typeof t === "object" && typeof t.id === "string" && /^s\d{2}$/.test(t.id) && ["x", "y", "w", "h"].every((k) => Number.isFinite(t[k])))
          .slice(0, 24)
          .map(clampTile)
      : [];
    return {
      view: WALL_VIEWS.includes(v.view) ? v.view : DEFAULT_WALL.view,
      order: ids(v.order),
      tab: typeof v.tab === "string" && /^s\d{2}$/.test(v.tab) ? v.tab : null,
      custom,
    };
  } catch {
    return { ...DEFAULT_WALL };
  }
}

/** "s03" ↔ 3. */
export const screenId = (n) => `s${String(n).padStart(2, "0")}`;
export const screenNumber = (id) => Number(String(id).slice(1));
