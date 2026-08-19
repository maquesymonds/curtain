// ============================================================================
//  CONTROLS — a live panel over CONFIG, on Theatre.js Studio.
//
//  WHY THIS EXISTS. Every number in these pieces interacts with every other one in
//  ways nobody guesses right (the whole of REGLA 3 is about that). Editing config.js
//  and reloading costs a few seconds AND the mental thread: by the time the page is
//  back you have forgotten what the previous value looked like. This makes the whole
//  parameter set draggable while the piece runs, so a comparison is a wrist movement.
//
//  IT IS A TOOL, NOT PART OF THE PIECE.
//   - Only loads behind ?controls. Nothing here is fetched, parsed or executed for a
//     visitor: each piece dynamic-imports this module inside an `if`, so the 2.6MB
//     studio bundle is not even a network request unless the flag is on.
//   - It writes into CONFIG, never into a file. Nothing is persisted to the project.
//     When a value is worth keeping, "copiar cambios" prints exactly the paths you
//     moved and their new values, ready to paste into the piece's config.js — which
//     is where a decision belongs, next to the comment explaining it.
//
//  THE PART THAT MATTERS: WHAT A CHANGE COSTS.
//  CONFIG is read at three different moments, and a panel that ignores that is a
//  panel that lies — you drag `curveBias` and nothing happens, because the resting
//  pose it shapes was built once at startup. So every parameter in a spec declares
//  when it takes effect:
//
//    "live"     read every frame by the solver or the renderer. Nothing to do.
//               gravity, wind, cohesion, bendReturn, tipFade, the system toggles.
//    "atlas"    baked into the glyph bitmaps. Needs _buildAtlas() — about 6ms.
//               colour, fontSize, outline, bloom, core, the depth ramp.
//    "rebuild"  read while the strands are being CONSTRUCTED. Needs the piece's own
//               rebuild, because only the piece knows where its roots come from.
//               lengths, segment spacing, fray, root volume, launch angles.
//
//  The piece passes one `onApply(kinds)` and decides what those words mean for it.
// ============================================================================

import { getPath, setPath } from "./utils.js";

const BUNDLE = "../../shared/vendor/theatre-core-and-studio.js";

// Load the studio bundle once. It is a classic script that assigns window.Theatre,
// not an ES module, so it goes in as a <script> rather than an import — and the
// version check inside studio.initialize() reads process.env, which does not exist in
// a browser and throws right through the initialize call. One shim, before the load.
let loading = null;
function loadTheatre(url) {
  if (window.Theatre) return Promise.resolve(window.Theatre);
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    if (!window.process) window.process = { env: { NODE_ENV: "development" } };
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => (window.Theatre ? res(window.Theatre) : rej(new Error("no window.Theatre")));
    s.onerror = () => rej(new Error(`no pude cargar ${url}`));
    document.head.appendChild(s);
  });
  return loading;
}

// ---- CONFIG paths ---------------------------------------------------------
// getPath/setPath live in utils.js: the visitor panel (tune.js) addresses CONFIG
// the same way, and one notation for both is the point.

// ---- colours -------------------------------------------------------------
// Theatre's rgba prop is four 0..1 floats; the configs hold "#rrggbb" or
// "rgba(r, g, b, a)". Whichever form a value arrived in is the form it goes back in,
// so a dumped change can be pasted into config.js unedited.
const HEX = /^#([0-9a-f]{6})$/i;
const RGBA = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

function parseColor(str) {
  const hex = HEX.exec(str);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { kind: "hex", rgba: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 } };
  }
  const m = RGBA.exec(str);
  if (!m) return null;
  return {
    kind: "rgba",
    rgba: { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] === undefined ? 1 : +m[4] },
  };
}

function formatColor(kind, c) {
  const to255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  if (kind === "hex") {
    return "#" + [c.r, c.g, c.b].map((v) => to255(v).toString(16).padStart(2, "0")).join("");
  }
  return `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${Math.round(c.a * 100) / 100})`;
}

// A Theatre prop matching whatever the config already holds, so the panel opens
// showing the file's values rather than a set of invented defaults.
function propFor(types, value, opts) {
  if (typeof value === "boolean") return { prop: types.boolean(value), kind: "boolean" };
  if (typeof value === "number") {
    const range = opts.range ?? [Math.min(0, value * 2), Math.max(1, value * 2)];
    const span = range[1] - range[0];
    return {
      prop: types.number(value, {
        range,
        // Theatre nudges by this per pixel of drag. Scaled to the range so a 0..1
        // parameter and a 0..400 one both feel like the same control.
        nudgeMultiplier: opts.step ?? (span <= 2 ? 0.005 : span <= 50 ? 0.05 : 0.5),
      }),
      kind: "number",
    };
  }
  if (typeof value === "string") {
    const col = parseColor(value);
    if (col) return { prop: types.rgba(col.rgba), kind: "color", colorKind: col.kind };
    return { prop: types.string(value), kind: "string" };
  }
  return null;
}

// ---------------------------------------------------------------------------
//  initControls({ CONFIG, name, spec, onApply })
//
//  spec: { "Group name": { "label": { path, range?, step?, apply } } }
//  onApply(kinds): a Set of the "live" | "atlas" | "rebuild" words touched by this
//  change. Called at most once per change, after CONFIG has been written.
// ---------------------------------------------------------------------------
export async function initControls({ CONFIG, name, spec, onApply, bundleUrl = BUNDLE }) {
  const { core, studio } = await loadTheatre(new URL(bundleUrl, import.meta.url).href);
  const { types } = core;

  // One project per piece, so their panel layouts and studio state never collide in
  // localStorage — three pieces, three saved arrangements.
  const sheet = core.getProject(`curtain · ${name}`).sheet("params");

  // What the file said, captured before anything is dragged. This is what "changed"
  // is measured against, and it is why the dump can stay short.
  const initial = new Map();
  const meta = new Map(); // theatre prop key -> { path, kind, colorKind, apply }
  const objects = [];

  for (const [group, params] of Object.entries(spec)) {
    const props = {};
    const groupMeta = {};
    for (const [label, opts] of Object.entries(params)) {
      const value = getPath(CONFIG, opts.path);
      if (value === undefined) {
        console.warn(`controls: CONFIG.${opts.path} no existe — omito "${group} / ${label}"`);
        continue;
      }
      const made = propFor(types, value, opts);
      if (!made) {
        console.warn(`controls: no sé representar CONFIG.${opts.path} (${typeof value})`);
        continue;
      }
      // Theatre uses the prop name as its UI label and as its key in the saved state,
      // so the label IS the identity of the control. Keep labels stable across edits
      // of a spec or the studio will drop the stored value for the renamed one.
      props[label] = made.prop;
      groupMeta[label] = { ...made, ...opts, group, label };
      initial.set(opts.path, value);
      meta.set(`${group}/${label}`, groupMeta[label]);
    }
    if (!Object.keys(props).length) continue;

    const obj = sheet.object(group, props);
    objects.push(obj);
    obj.onValuesChange((values) => {
      const kinds = new Set();
      for (const [label, v] of Object.entries(values)) {
        const m = groupMeta[label];
        if (!m) continue;
        const next = m.kind === "color" ? formatColor(m.colorKind, v) : v;
        if (getPath(CONFIG, m.path) === next) continue;
        setPath(CONFIG, m.path, next);
        kinds.add(m.apply || "live");
      }
      if (kinds.size) onApply?.(kinds);
    });
  }

  // ---- what changed, ready to paste ---------------------------------------
  // The one thing Theatre's own save file cannot give: the diff against config.js.
  // Only the values actually moved, in config.js's own notation.
  const changes = () => {
    const out = [];
    for (const [path, was] of initial) {
      const now = getPath(CONFIG, path);
      if (now !== was) out.push({ path, was, now });
    }
    return out;
  };

  const dump = () => {
    const list = changes();
    if (!list.length) {
      console.info("controls: nada cambiado todavía.");
      return "";
    }
    const text = list.map(({ path, now }) => `${path}: ${JSON.stringify(now)},`).join("\n");
    console.info(
      `%ccontrols · ${list.length} cambio(s) — pegar en config.js`,
      "color:#0f8;font-weight:bold"
    );
    console.table(list);
    console.log(text);
    navigator.clipboard?.writeText(text).catch(() => {});
    return text;
  };

  // A plain DOM button, bottom left, clear of the studio's own chrome. Theatre has no
  // way to put a command in its panel, and the alternative is remembering a console
  // incantation while both hands are busy dragging.
  const btn = document.createElement("button");
  btn.textContent = "copiar cambios";
  btn.title = "Imprime en consola y copia al portapapeles solo los valores que moviste";
  btn.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px ui-monospace,Menlo," +
    "monospace;padding:7px 10px;border-radius:6px;border:1px solid #0f8;background:#04120b;" +
    "color:#0f8;cursor:pointer";
  btn.onclick = () => {
    const n = changes().length;
    dump();
    btn.textContent = n ? `copiado (${n})` : "sin cambios";
    setTimeout(() => (btn.textContent = "copiar cambios"), 1400);
  };
  document.body.appendChild(btn);

  // Ask the studio what it is doing rather than keeping a boolean of our own. Theatre
  // has its own shortcut for hiding the UI and it restores whatever state it last
  // saved, so a local flag drifts out of sync — and then the key appears to be dead,
  // because it hides an already hidden panel.
  const toggle = () => {
    const hidden = studio.ui.isHidden;
    hidden ? studio.ui.restore() : studio.ui.hide();
    btn.style.display = hidden ? "" : "none";
  };

  studio.initialize();
  // And it always comes up VISIBLE. Theatre persists its UI state, so a session that
  // ended with the panel hidden would open the next one on an apparently ordinary page
  // with no hint that anything is loaded.
  studio.ui.restore();
  // Select the first group so the panel opens on something instead of on "please
  // select an object".
  if (objects[0]) studio.setSelection([objects[0]]);

  // CONFIG rides along on the api on purpose: from the console `__controls.CONFIG.gravity`
  // reads exactly what the panel is writing, with no need to know which piece this is or
  // what it called its own debug hook.
  const api = {
    core, studio, sheet, objects, CONFIG, changes, dump, toggle,
    get visible() {
      return !studio.ui.isHidden;
    },
  };
  window.__controls = api;
  console.info(
    `%ccontrols · ${objects.length} grupos, ${meta.size} parámetros. ` +
      `Tecla "t" oculta/muestra el panel. window.__controls.dump() imprime los cambios.`,
    "color:#0f8"
  );
  return api;
}
