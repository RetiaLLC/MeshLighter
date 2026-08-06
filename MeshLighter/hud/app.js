/*
 * app.js — the visualizer shell (p5 global mode). Owns the canvas, routes decoded
 * packets (from window.VizSource → MeshModel) to whichever renderer is active, and
 * wires the controls. Two styles over one model: Tactical HUD and Neural Mesh.
 */
let activeStyle = "tactical";

function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.parent("canvas-container");
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  textFont('ui-monospace, "SF Mono", Menlo, Consolas, monospace');
  const s = new URLSearchParams(location.search).get("style");
  if (["neural", "tactical", "map"].includes(s)) activeStyle = s;
  wireUI();
  window.VizSource.autoStart();
}

function renderer() {
  return activeStyle === "neural" ? window.Neural : activeStyle === "map" ? window.MapView : window.Tactical;
}
function draw() { renderer().draw(window.VizSource.status()); }
function mouseWheel(e) { const r = renderer(); if (r.onWheel) r.onWheel(e.deltaY, mouseX, mouseY); return false; }
function mousePressed() { const r = renderer(); if (r.onClick) r.onClick(mouseX, mouseY); }
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
function keyPressed() {
  if (key === "m" || key === "M") document.getElementById("ui-overlay").classList.toggle("hidden");
  if (keyCode === ESCAPE && window.Tactical.onClick) window.Tactical.onClick(-1, -1);   // deselect
}

function wireUI() {
  const $ = (id) => document.getElementById(id);
  const styleBtns = document.querySelectorAll(".style-btn");
  styleBtns.forEach((b) => {
    b.classList.toggle("active", b.dataset.style === activeStyle);
    b.addEventListener("click", () => {
      activeStyle = b.dataset.style;
      styleBtns.forEach((x) => x.classList.toggle("active", x.dataset.style === activeStyle));
    });
  });
  $("btn-demo").addEventListener("click", () => window.VizSource.toggleDemo());
  $("btn-connect").addEventListener("click", () => (window.VizSource.mode() === "serial" ? window.VizSource.disconnect() : window.VizSource.connect()));
  $("btn-clear").addEventListener("click", () => window.MeshModel.clear());
  $("btn-hide").addEventListener("click", () => $("ui-overlay").classList.toggle("hidden"));

  const toast = (msg) => {
    let el = $("hud-toast");
    if (!el) { el = document.createElement("div"); el.id = "hud-toast"; el.className = "hud-toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2800);
  };

  // Settings: channel decode + receiver frequency
  const sp = $("settings-panel");
  $("btn-settings").addEventListener("click", () => { sp.hidden = !sp.hidden; });
  $("set-chan-apply").addEventListener("click", () => {
    const r = window.VizSource.setChannel($("set-chan").value.trim(), $("set-psk").value.trim() || "default");
    $("set-note").textContent = `Decoding channel "${r.name}" (hash 0x${r.hash.toString(16).padStart(2, "0")}).`;
  });
  $("set-freq-apply").addEventListener("click", async () => {
    const r = await window.VizSource.setFrequency(parseFloat($("set-freq").value));
    $("set-note").textContent = r.msg;
  });

  // Traceroute: gated the first time (it transmits). Once affirmed, the gate stays dismissed.
  const tg = $("trace-gate"), tgc = $("tg-check"), tgo = $("tg-go");
  const AUTH_KEY = "meshlighter.traceAuthorized";
  let authMem = false;
  const isAuthorized = () => { try { return localStorage.getItem(AUTH_KEY) === "1"; } catch { return authMem; } };
  const closeGate = () => { tg.hidden = true; tgc.checked = false; tgo.disabled = true; };
  const runTrace = async () => {
    const btn = $("btn-trace"); btn.disabled = true; toast("running traceroute…");
    try { const r = await window.VizSource.traceroute(); toast(r && r.msg ? r.msg : "traceroute done"); }
    catch (e) { toast("traceroute failed"); }
    finally { btn.disabled = false; }
  };
  const reflectAuth = () => { $("btn-trace").title = isAuthorized() ? "Traceroute (authorized — transmits)" : "Query nodes with a traceroute (transmits)"; };
  $("btn-trace").addEventListener("click", () => { if (isAuthorized()) runTrace(); else tg.hidden = false; });
  tgc.addEventListener("change", () => { tgo.disabled = !tgc.checked; });
  $("tg-cancel").addEventListener("click", closeGate);
  tg.addEventListener("click", (e) => { if (e.target === tg) closeGate(); });
  tgo.addEventListener("click", () => { try { localStorage.setItem(AUTH_KEY, "1"); } catch { authMem = true; } reflectAuth(); closeGate(); runTrace(); });
  reflectAuth();

  if (!("serial" in navigator)) { const cb = $("btn-connect"); cb.disabled = true; cb.title = "Web Serial needs Chrome/Edge/Opera over HTTPS"; }
}
