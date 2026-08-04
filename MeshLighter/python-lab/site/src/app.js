// MeshLighter Python lab: Pyodide + Monaco + xterm + a binary radio-pipe bridge.
import { WebSerialConnection, MockRadioPipe } from "./serial.js";

const PYODIDE_VERSION = "314.0.3";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const MONACO_VERSION = "0.52.2";
const MONACO_BASE_URL = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
const HOME = "/home/pyodide";

// Async Device methods used at script level (auto-await keeps scripts sync-looking).
const DEVICE_METHODS = ["connect", "disconnect", "sleep", "send_frame", "read_frames",
  "set_freq", "set_power", "sniff", "scan", "send_nodeinfo", "send_position",
  "send_text", "send_portnum", "monitor"];

const STARTER_SCRIPT = `# MeshLighter Python lab — Connect a radio-pipe Nibble, then Run.
# Passive tools (scan/monitor) work ungated. Injection needs the "I am authorized" box.
from device import dev
import mesh

dev.connect()

# Passive: sweep the 900 MHz band and show the strongest channels.
rows = dev.scan(902, 928, step_khz=500)          # assign first: await binds looser than [ ]
for freq_khz, rssi in rows[:10]:
    print(f"{freq_khz/1000:8.3f} MHz  {rssi:4d} dBm")
`;

const el = (id) => document.querySelector(`#${id}`);
const ui = {
  banner: el("compatibilityBanner"), connect: el("connectButton"), run: el("runButton"),
  stop: el("stopButton"), clear: el("clearButton"), rawSerial: el("rawSerialToggle"),
  auth: el("authToggle"), demoSelect: el("demoSelect"),
  editor: el("editor"), fallbackEditor: el("fallbackEditor"),
  filesPanel: el("generatedFilesPanel"), filesList: el("generatedFilesList"), terminal: el("consoleTerminal")
};

const demoMode = new URLSearchParams(location.search).has("demo");
const serial = demoMode || !("serial" in navigator) ? new MockRadioPipe() : new WebSerialConnection();
const term = createTerminal(ui.terminal);

let pyodide = null, editorView = null, running = false, stopRequested = false;
let interruptBuffer = null, rxBytes = [], serialVersion = 0, connected = false, showRawSerial = false;
let authorizedFlag = false;
const generatedFiles = new Map();

// -------------------------------------------------------------- binary framing
function frameBytes(payload) {
  const p = Array.from(payload); return Uint8Array.from([0x94, 0xc3, (p.length >> 8) & 0xff, p.length & 0xff, ...p]);
}
function deframe() {
  const frames = [];
  while (true) {
    while (rxBytes.length >= 2 && !(rxBytes[0] === 0x94 && rxBytes[1] === 0xc3)) rxBytes.shift();
    if (rxBytes.length < 4) break;
    const len = (rxBytes[2] << 8) | rxBytes[3];
    if (len > 512) { rxBytes.splice(0, 2); continue; }
    if (rxBytes.length < 4 + len) break;
    frames.push(rxBytes.slice(4, 4 + len)); rxBytes = rxBytes.slice(4 + len);
  }
  return frames;
}

// -------------------------------------------------------------- Python <- JS bridge
function createBridge() {
  return {
    connect: async () => { await ensureConnected(); return true; },
    disconnect: async () => { await disconnect(); },
    send_frame: async (bytes) => {
      throwIfStopped(); await ensureConnected();
      await serial.write(frameBytes(Array.from(bytes).map((b) => Number(b) & 0xff)));
    },
    read_frames: async (timeout = 300, quiet = 120) => {
      throwIfStopped(); await waitForSerial(timeout, quiet); return deframe();
    },
    sleep: async (seconds) => { await sleep(Number(seconds) * 1000); },
    authorized: () => authorizedFlag
  };
}

async function waitForSerial(timeout = 300, quiet = 120) {
  throwIfStopped();
  const timeoutMs = Math.max(0, Number(timeout) || 0), quietMs = Math.max(0, Number(quiet) || 0);
  const startVersion = serialVersion; let lastVersion = serialVersion, lastChange = performance.now();
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    throwIfStopped();
    if (rxBytes.length && (rxBytes[0] !== 0x94)) { /* keep scanning */ }
    if (serialVersion !== lastVersion) { lastVersion = serialVersion; lastChange = performance.now(); }
    if (lastVersion !== startVersion && performance.now() - lastChange >= quietMs) return true;
    await sleep(15);
  }
  return lastVersion !== startVersion;
}

// -------------------------------------------------------------- auto-await transform
export function addImplicitAwaits(source) {
  const isCode = (line) => { const t = line.trim(); return t && !t.startsWith("#") && !/^(?:from|import)\s+/.test(t); };
  const awaitCalls = (text, names) => {
    const pattern = new RegExp(String.raw`(^|[^.\w])((?:dev|device)\.(?:${DEVICE_METHODS.join("|")})|(?:${names.join("|")}))\s*\(`, "g");
    return text.replace(pattern, (match, before, callee, offset, full) => {
      const preceding = full.slice(Math.max(0, offset - 12), offset + before.length);
      if (/\b(?:await|def|class)\s*$/.test(preceding)) return match;
      return `${before}await ${callee}(`;
    });
  };
  let lines = source.split("\n"); const asyncNames = new Set();
  for (let pass = 0; pass < 6; pass += 1) {
    const names = Array.from(asyncNames);
    const next = lines.map((line) => (isCode(line) ? awaitCalls(line, names.length ? names : ["\\0"]) : line));
    const promoted = promoteAsyncDefs(next, asyncNames);
    const changed = promoted.join("\n") !== lines.join("\n"); lines = promoted;
    if (!changed) break;
  }
  return lines.join("\n");
}
function promoteAsyncDefs(lines, asyncNames) {
  const output = lines.slice();
  for (let index = 0; index < output.length; index += 1) {
    const match = /^(\s*)def\s+(\w+)\s*\(/.exec(output[index]);
    if (!match) continue;
    const [, indent, name] = match;
    for (let cursor = index + 1; cursor < output.length; cursor += 1) {
      const line = output[cursor]; if (!line.trim()) continue;
      if (/^\s*/.exec(line)[0].length <= indent.length) break;
      if (/\bawait\s/.test(line)) { output[index] = output[index].replace(/^(\s*)def\s/, "$1async def "); asyncNames.add(name); break; }
    }
  }
  return output;
}

// -------------------------------------------------------------- Pyodide
async function loadPython() {
  writeConsole("Loading Python...\n", "system");
  for (let a = 0; typeof window.loadPyodide !== "function" && a < 200; a += 1) await sleep(50);
  if (typeof window.loadPyodide !== "function") throw new Error("Pyodide loader never became available.");
  pyodide = await window.loadPyodide({
    indexURL: PYODIDE_INDEX_URL,
    stdout: (t) => writeConsole(`${t}\n`), stderr: (t) => writeConsole(`${t}\n`, "error")
  });
  pyodide.registerJsModule("device_js", createBridge());
  const meshSrc = await (await fetch("./mesh.py")).text();
  const shimSrc = await (await fetch("./src/device_shim.py")).text();
  pyodide.globals.set("__mesh_src", meshSrc);
  pyodide.globals.set("__shim_src", shimSrc);
  pyodide.runPython(`
import sys, types
_mesh = types.ModuleType("mesh"); exec(__mesh_src, _mesh.__dict__); sys.modules["mesh"] = _mesh
_dev = types.ModuleType("device"); exec(__shim_src, _dev.__dict__); sys.modules["device"] = _dev
`);
  writeConsole(`Python ready (Pyodide ${pyodide.version}).${demoMode ? " Mock radio-pipe active (?demo)." : ""}\n`, "system");
  updateUi();
}

async function runPython() {
  if (!pyodide || running) return;
  running = true; stopRequested = false;
  const before = snapshotFiles();
  if (window.crossOriginIsolated && typeof SharedArrayBuffer === "function") {
    interruptBuffer = new Uint8Array(new SharedArrayBuffer(1)); pyodide.setInterruptBuffer(interruptBuffer);
  }
  updateUi();
  try {
    writeConsole("\n>>> run\n", "system");
    await pyodide.runPythonAsync(addImplicitAwaits(getCode()));
    writeConsole("\n[done]\n", "system");
  } catch (error) {
    const message = String(error?.message || error);
    if (stopRequested || message.includes("script stopped") || message.includes("KeyboardInterrupt")) writeConsole("\n[stopped]\n", "system");
    else writeConsole(`\n${message}\n`, "error");
  } finally {
    pyodide.setInterruptBuffer?.(); interruptBuffer = null;
    collectGeneratedFiles(before); stopRequested = false; running = false; updateUi();
  }
}
function stopPython() { if (!running) return; stopRequested = true; if (interruptBuffer) interruptBuffer[0] = 2; writeConsole("\n[stop requested]\n", "system"); }
function throwIfStopped() { if (stopRequested) throw new Error("script stopped"); }

// -------------------------------------------------------------- generated files
function listFiles() {
  const fs = pyodide?.FS; if (!fs) return []; const files = [];
  const visit = (dir) => {
    let entries = []; try { entries = fs.readdir(dir); } catch { return; }
    for (const entry of entries) {
      if (entry === "." || entry === "..") continue;
      const path = `${dir}/${entry}`.replace(/\/+/g, "/"); let stat = null;
      try { stat = fs.stat(path); } catch { continue; }
      if (fs.isDir(stat.mode)) visit(path);
      else if (fs.isFile(stat.mode)) {
        const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime) || 0;
        files.push({ path, name: path.replace(`${HOME}/`, ""), size: Number(stat.size) || 0, signature: `${Number(stat.size) || 0}:${mtime}` });
      }
    }
  };
  visit(HOME); return files;
}
function snapshotFiles() { return new Map(listFiles().map((f) => [f.path, f.signature])); }
function collectGeneratedFiles(before) { for (const f of listFiles()) if (before.get(f.path) !== f.signature) generatedFiles.set(f.path, f); renderGeneratedFiles(); }
function renderGeneratedFiles() {
  ui.filesList.replaceChildren();
  const files = Array.from(generatedFiles.values()).sort((a, b) => a.name.localeCompare(b.name));
  ui.filesPanel.hidden = files.length === 0;
  for (const file of files) {
    const row = document.createElement("div"); row.className = "generated-file";
    const name = document.createElement("span"); name.textContent = file.name;
    const size = document.createElement("span"); size.className = "generated-file-meta"; size.textContent = formatBytes(file.size);
    const button = document.createElement("button"); button.type = "button"; button.textContent = "Download";
    button.addEventListener("click", () => downloadFile(file));
    row.append(name, size, button); ui.filesList.append(row);
  }
  fitTerminal();
}
function downloadFile(file) {
  let data = null; try { data = pyodide.FS.readFile(file.path); } catch (e) { writeConsole(`[Unable to read ${file.name}: ${e.message || e}]\n`, "error"); return; }
  saveBlob(new Blob([data], { type: "application/octet-stream" }), file.name.split("/").pop());
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function formatBytes(size) { if (size < 1024) return `${size} B`; if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`; return `${(size / 1048576).toFixed(1)} MB`; }

// -------------------------------------------------------------- connection
async function ensureConnected() { if (!connected) await connect(); }
async function connect() { if (connected) return; await serial.connect({ baudRate: 115200 }); connected = true; writeConsole("[serial connected]\n", "system"); updateUi(); }
async function disconnect() { if (!connected) return; await serial.disconnect("Disconnected"); connected = false; writeConsole("[serial disconnected]\n", "system"); updateUi(); }

serial.addEventListener("data", (event) => {
  const u8 = event.detail; if (u8 && u8.length) { for (const b of u8) rxBytes.push(b); serialVersion += 1; }
  if (showRawSerial && u8) { const t = new TextDecoder("latin1").decode(u8).replace(/[^\x20-\x7e\r\n]/g, "."); writeConsole(t); }
});
serial.addEventListener("status", (event) => { connected = event.detail.state === "connected"; updateUi(); });
serial.addEventListener("error", (event) => writeConsole(`[serial error: ${event.detail.message}]\n`, "error"));

// -------------------------------------------------------------- UI
function createTerminal(container) {
  const terminal = new window.Terminal({
    convertEol: true, cursorBlink: false, disableStdin: true, fontFamily: 'Menlo, "Courier New", monospace',
    fontSize: 13, scrollback: 6000, theme: { background: "#0c1512", foreground: "#d8ddd8", cyan: "#43e8b5", red: "#ff6b6b", yellow: "#f0b357" }
  });
  const fit = new window.FitAddon.FitAddon(); terminal.loadAddon(fit); terminal.open(container); fit.fit(); terminal.fitAddon = fit; return terminal;
}
function fitTerminal() { try { term.fitAddon.fit(); } catch { /* not laid out */ } editorView?.layout?.(); }
function writeConsole(text, tone = "normal") {
  const color = tone === "error" ? "\x1b[31m" : tone === "system" ? "\x1b[36m" : "";
  term.write(`${color}${String(text).replace(/\n/g, "\r\n")}${color ? "\x1b[0m" : ""}`);
}
function getCode() { return editorView ? editorView.getValue() : ui.fallbackEditor.value; }
function setCode(code) { if (editorView) editorView.setValue(code); ui.fallbackEditor.value = code; }
function updateUi() {
  ui.banner.hidden = "serial" in navigator || demoMode;
  ui.connect.textContent = connected ? "Disconnect" : "Connect";
  ui.run.disabled = running || !pyodide; ui.stop.disabled = !running;
}

async function loadEditor() {
  try {
    const monaco = await loadMonaco();
    editorView = monaco.editor.create(ui.editor, { value: STARTER_SCRIPT, language: "python", theme: "vs-dark",
      automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 14, tabSize: 4 });
    ui.editor.classList.add("is-ready");
  } catch (error) { ui.editor.classList.add("is-fallback"); writeConsole(`[Monaco unavailable, using textarea: ${error.message || error}]\n`, "system"); }
}
function loadMonaco() {
  if (window.monaco?.editor) return Promise.resolve(window.monaco);
  return new Promise((resolve, reject) => {
    const configure = () => {
      window.require.config({ paths: { vs: MONACO_BASE_URL } });
      window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: "${MONACO_BASE_URL}/" };
        importScripts("${MONACO_BASE_URL}/base/worker/workerMain.js");`)}` };
      window.require(["vs/editor/editor.main"], () => resolve(window.monaco), reject);
    };
    if (window.require) return configure();
    const loader = document.createElement("script"); loader.src = `${MONACO_BASE_URL}/loader.js`;
    loader.onload = configure; loader.onerror = () => reject(new Error("Monaco loader failed")); document.head.append(loader);
  });
}

// demo picker
async function loadDemoList() {
  try {
    const manifest = await (await fetch("./demos/demos.json")).json();
    for (const d of manifest) { const o = document.createElement("option"); o.value = d.file; o.textContent = d.title; ui.demoSelect.append(o); }
  } catch { /* no manifest -> starter only */ }
}
async function loadDemo(file) {
  if (!file) { setCode(STARTER_SCRIPT); return; }
  try { setCode(await (await fetch(`./demos/${file}`)).text()); } catch (e) { writeConsole(`[couldn't load ${file}: ${e.message || e}]\n`, "error"); }
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + Math.max(0, Number(ms) || 0);
    const tick = () => { if (stopRequested) return reject(new Error("script stopped"));
      const remaining = deadline - performance.now(); if (remaining <= 0) return resolve(); window.setTimeout(tick, Math.min(remaining, 40)); };
    tick();
  });
}

ui.connect.addEventListener("click", () => void (connected ? disconnect() : connect()).catch((e) => writeConsole(`[connect failed: ${e.message || e}]\n`, "error")));
ui.run.addEventListener("click", () => void runPython());
ui.stop.addEventListener("click", stopPython);
ui.clear.addEventListener("click", () => { term.clear(); rxBytes = []; generatedFiles.clear(); renderGeneratedFiles(); });
ui.rawSerial.addEventListener("change", () => { showRawSerial = ui.rawSerial.checked; });
ui.auth.addEventListener("change", () => { authorizedFlag = ui.auth.checked; if (authorizedFlag) writeConsole("[authorized to transmit — injection demos enabled]\n", "system"); });
ui.demoSelect.addEventListener("change", () => void loadDemo(ui.demoSelect.value));
window.addEventListener("resize", fitTerminal);
window.addEventListener("beforeunload", () => { if (connected) void serial.disconnect("Page closed"); });

ui.fallbackEditor.value = STARTER_SCRIPT; setCode(STARTER_SCRIPT); updateUi();
void loadDemoList();
void loadEditor();
void loadPython().catch((error) => { writeConsole(`[Pyodide failed: ${error.message || error}]\n`, "error"); updateUi(); });

// Demo-mode convenience: ?demo=1&autorun connects the mock and runs the starter once.
if (demoMode && new URLSearchParams(location.search).has("autorun")) {
  (async () => {
    for (let i = 0; i < 200 && !pyodide; i += 1) await sleep(100);
    await sleep(400);
    try { await connect(); } catch { /* mock */ }
    await sleep(300);
    await runPython();
  })();
}
