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
  if (s === "neural" || s === "tactical") activeStyle = s;
  wireUI();
  window.VizSource.autoStart();
}

function draw() {
  const status = window.VizSource.status();
  (activeStyle === "neural" ? window.Neural : window.Tactical).draw(status);
}

function mouseWheel(e) {
  const r = activeStyle === "neural" ? window.Neural : window.Tactical;
  if (r.onWheel) r.onWheel(e.deltaY, mouseX, mouseY);
  return false;
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
function keyPressed() { if (key === "m" || key === "M") document.getElementById("ui-overlay").classList.toggle("hidden"); }

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
  if (!("serial" in navigator)) { const cb = $("btn-connect"); cb.disabled = true; cb.title = "Web Serial needs Chrome/Edge/Opera over HTTPS"; }
}
