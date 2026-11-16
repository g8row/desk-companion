// Desk Studio — vanilla JS, no build step. Talks to deskd's /api with the
// token deskd injected into this page.
const TOKEN = document.querySelector('meta[name="desk-token"]').content;
const $ = (id) => document.getElementById(id);
const api = async (path, opts = {}) => {
  const r = await fetch(`/api${path}`, { ...opts, headers: { "x-desk-token": TOKEN, "content-type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok && r.headers.get("content-type")?.includes("json")) throw new Error((await r.json()).error || r.statusText);
  if (!r.ok) throw new Error(r.statusText);
  return r;
};
const TILE_HEX = { blue: "#a8c7fa", violet: "#d0bcff", emerald: "#9ee6c3", amber: "#ffd27a", rose: "#ffb4a8", zinc: "#8a8a8a" };
const VALUE = {
  shell: ["command (runs in /bin/sh)", "cmd", "say hello"],
  app: ["application name", "name", "Safari"],
  url: ["URL", "url", "https://g8row.xyz"],
  applescript: ["AppleScript source", "script", 'display notification "hi"'],
  shortcut: ["Shortcut name", "name", "Desk lights"],
};

let meta, cfg, saved, sel = -1;

const dirty = () => JSON.stringify(cfg) !== saved;
function touch() {
  $("save").disabled = !dirty();
  $("saved").textContent = dirty() ? "unsaved changes" : "";
  render();
}

// ---- panes -----------------------------------------------------------------
function renderPanes() {
  const all = [...cfg.panes, ...Object.keys(meta.panes).filter((p) => !cfg.panes.includes(p))];
  $("strip").style.gridTemplateColumns = `repeat(${cfg.panes.length},minmax(0,1fr))`;
  $("strip").innerHTML = cfg.panes.map((p) => `<span>${p}</span>`).join("");
  const ol = $("panelist");
  ol.innerHTML = "";
  all.forEach((p) => {
    const on = cfg.panes.includes(p);
    const li = document.createElement("li");
    li.className = on ? "" : "off";
    li.draggable = on;
    li.dataset.pane = p;
    li.innerHTML = `<span class="grip">⋮⋮</span><input type="checkbox" ${on ? "checked" : ""}>
      <span class="name">${p}</span><span class="desc">${meta.panes[p]}</span>
      <button class="btn sm ghost" data-a="up">↑</button><button class="btn sm ghost" data-a="down">↓</button>
      <button class="btn sm" data-a="show" ${on ? "" : "disabled"}>show</button>`;
    li.querySelector("input").onchange = (e) => {
      if (e.target.checked) cfg.panes.push(p);
      else if (cfg.panes.length > 1) cfg.panes = cfg.panes.filter((x) => x !== p);
      touch();
    };
    li.querySelectorAll("button").forEach((b) => (b.onclick = () => paneBtn(p, b.dataset.a)));
    li.ondragstart = (e) => { e.dataTransfer.setData("text/plain", p); li.classList.add("drag"); };
    li.ondragend = () => li.classList.remove("drag");
    li.ondragover = (e) => { if (on) e.preventDefault(); };
    li.ondrop = (e) => {
      e.preventDefault();
      const from = cfg.panes.indexOf(e.dataTransfer.getData("text/plain"));
      const to = cfg.panes.indexOf(p);
      if (from < 0 || to < 0) return;
      const [x] = cfg.panes.splice(from, 1);
      cfg.panes.splice(to, 0, x);
      touch();
    };
    ol.appendChild(li);
  });
}
function paneBtn(p, a) {
  const i = cfg.panes.indexOf(p);
  if (a === "show") return api("/nav", { method: "POST", body: JSON.stringify({ pane: p }) });
  if (i < 0) return;
  const j = a === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= cfg.panes.length) return;
  [cfg.panes[i], cfg.panes[j]] = [cfg.panes[j], cfg.panes[i]];
  touch();
}

// ---- deck ------------------------------------------------------------------
const describe = (a) =>
  a.type === "builtin" ? meta.builtins[a.id] || a.id : a.type === "shell" ? `$ ${a.cmd}` : a.type === "url" ? a.url : a.type === "app" ? `open ${a.name}` : a.type === "shortcut" ? `shortcut ${a.name}` : "applescript";
function renderTiles() {
  const g = $("tiles");
  g.innerHTML = "";
  cfg.tiles.forEach((t, i) => {
    const d = document.createElement("div");
    d.className = `tile card${i === sel ? " sel" : ""}`;
    d.innerHTML = `<span class="bar" style="background:${TILE_HEX[t.color]}"></span>
      <div class="lbl"></div><div class="sub"></div><span class="chip"></span>`;
    d.querySelector(".lbl").textContent = t.label.toLowerCase();
    d.querySelector(".sub").textContent = (t.sub || describe(t.action)).toLowerCase().slice(0, 40);
    d.querySelector(".chip").textContent = t.action.type;
    d.onclick = () => { sel = i; openEditor(); render(); };
    g.appendChild(d);
  });
  if (cfg.tiles.length < 12) {
    const add = document.createElement("div");
    add.className = "tile card add";
    add.textContent = "+ add tile";
    add.onclick = () => {
      cfg.tiles.push({ id: `tile-${Date.now() % 100000}`, label: "New", color: "blue", action: { type: "shell", cmd: "" } });
      sel = cfg.tiles.length - 1;
      openEditor();
      touch();
    };
    g.appendChild(add);
  }
}
function openEditor() {
  const t = cfg.tiles[sel];
  $("editor").hidden = !t;
  if (!t) return;
  $("edtitle").textContent = t.label.toLowerCase();
  $("f-label").value = t.label;
  $("f-sub").value = t.sub || "";
  $("f-type").value = t.action.type;
  $("f-colors").innerHTML = "";
  meta.colors.forEach((c) => {
    const s = document.createElement("span");
    s.className = `sw${c === t.color ? " on" : ""}`;
    s.style.background = TILE_HEX[c];
    s.title = c;
    s.onclick = () => { t.color = c; openEditor(); touch(); };
    $("f-colors").appendChild(s);
  });
  $("f-builtin").innerHTML = Object.entries(meta.builtins).map(([k, v]) => `<option value="${k}">${k} — ${v}</option>`).join("");
  syncActionFields();
  $("edresult").textContent = "";
}
function syncActionFields() {
  const t = cfg.tiles[sel];
  const a = t.action;
  $("w-builtin").hidden = a.type !== "builtin";
  $("w-value").hidden = a.type === "builtin";
  if (a.type === "builtin") $("f-builtin").value = a.id;
  else {
    const [label, key, ph] = VALUE[a.type];
    $("f-valuelabel").textContent = label;
    $("f-value").placeholder = ph;
    $("f-value").value = a[key] || "";
  }
}
$("f-label").oninput = (e) => { cfg.tiles[sel].label = e.target.value; touch(); };
$("f-sub").oninput = (e) => { const t = cfg.tiles[sel]; if (e.target.value) t.sub = e.target.value; else delete t.sub; touch(); };
$("f-type").onchange = (e) => {
  const type = e.target.value;
  cfg.tiles[sel].action = type === "builtin" ? { type, id: Object.keys(meta.builtins)[0] } : { type, [VALUE[type][1]]: "" };
  syncActionFields();
  touch();
};
$("f-builtin").onchange = (e) => { cfg.tiles[sel].action.id = e.target.value; touch(); };
$("f-value").oninput = (e) => { const a = cfg.tiles[sel].action; a[VALUE[a.type][1]] = e.target.value; touch(); };
$("edclose").onclick = () => { sel = -1; $("editor").hidden = true; render(); };
$("eddel").onclick = () => { cfg.tiles.splice(sel, 1); sel = -1; $("editor").hidden = true; touch(); };
const move = (d) => {
  const j = sel + d;
  if (j < 0 || j >= cfg.tiles.length) return;
  [cfg.tiles[sel], cfg.tiles[j]] = [cfg.tiles[j], cfg.tiles[sel]];
  sel = j;
  touch();
};
$("edleft").onclick = () => move(-1);
$("edright").onclick = () => move(1);
$("edtest").onclick = async () => {
  $("edresult").textContent = "running…";
  try {
    const r = await (await api("/tile/test", { method: "POST", body: JSON.stringify(cfg.tiles[sel]) })).json();
    $("edresult").textContent = r.ok ? "ran ✓" : `failed: ${r.error}`;
  } catch (e) {
    $("edresult").textContent = `failed: ${e.message}`;
  }
};

// ---- look + claude -----------------------------------------------------------
function renderLook() {
  document.documentElement.style.setProperty("--accent", cfg.accent);
  $("accents").innerHTML = "";
  Object.entries(meta.accents).forEach(([name, hex]) => {
    const s = document.createElement("span");
    s.className = `sw${hex === cfg.accent ? " on" : ""}`;
    s.style.background = hex;
    s.title = name;
    s.onclick = () => { cfg.accent = hex; touch(); };
    $("accents").appendChild(s);
  });
  if (document.activeElement !== $("accent")) $("accent").value = cfg.accent;
  $("c-flash").checked = cfg.claude.flash;
  $("c-sound").checked = cfg.claude.sound;
  $("c-approvals").checked = cfg.claude.approvals;
  if (document.activeElement !== $("c-timeout")) $("c-timeout").value = cfg.claude.approvalTimeoutSec;
  if (document.activeElement !== $("c-editor")) $("c-editor").value = cfg.claude.editor;
  if (document.activeElement !== $("f-minutes")) $("f-minutes").value = cfg.focus.minutes;
}
$("accent").oninput = (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { cfg.accent = e.target.value.toLowerCase(); touch(); } };
["flash", "sound", "approvals"].forEach((k) => ($(`c-${k}`).onchange = (e) => { cfg.claude[k] = e.target.checked; touch(); }));
$("c-timeout").oninput = (e) => { cfg.claude.approvalTimeoutSec = Number(e.target.value) || 10; touch(); };
$("c-editor").oninput = (e) => { cfg.claude.editor = e.target.value; touch(); };
$("f-minutes").oninput = (e) => { cfg.focus.minutes = Number(e.target.value) || 25; touch(); };

// ---- save, status, preview -----------------------------------------------------
$("save").onclick = async () => {
  try {
    const r = await (await api("/config", { method: "PUT", body: JSON.stringify(cfg) })).json();
    cfg = r.config;
    saved = JSON.stringify(cfg);
    sel = Math.min(sel, cfg.tiles.length - 1);
    touch();
    $("saved").textContent = "pushed to the tablet ✓";
    setTimeout(shot, 900);
  } catch (e) {
    $("saved").textContent = `save failed: ${e.message}`;
  }
};
let shotUrl;
async function shot() {
  try {
    const b = await (await api("/screenshot")).blob();
    if (shotUrl) URL.revokeObjectURL(shotUrl);
    shotUrl = URL.createObjectURL(b);
    $("screen").src = shotUrl;
  } catch {
    $("noshot").textContent = "tablet not reachable over adb";
  }
}
$("shot").onclick = shot;
setInterval(() => { if ($("live").checked && !document.hidden) shot(); }, 3000);
async function status() {
  try {
    const m = await (await api("/meta")).json();
    $("tabdot").className = m.tablet ? "dot on" : "dot";
    $("tabstate").textContent = m.tablet ? "tablet connected" : "tablet offline";
  } catch {
    $("tabstate").textContent = "deskd unreachable";
  }
}
setInterval(status, 4000);

function render() {
  renderPanes();
  renderTiles();
  renderLook();
}

(async () => {
  meta = await (await api("/meta")).json();
  const r = await (await api("/config")).json();
  cfg = r.config;
  saved = JSON.stringify(cfg);
  $("cfgpath").textContent = r.path.split("/").slice(-2).join("/");
  status();
  render();
  shot();
})();
