// Firmware installer — writes a full-flash ESP32-S3 image over Web Serial via
// esptool-js. Used by app.js after the authorization gate. Accepts a bundled URL
// (the radio-pipe image) or a user-provided File (bring-your-own .bin, e.g. an
// official Meshtastic image to restore a node). Writes at 0x0 by default.
//
// window.esptooljs = { ESPLoader, Transport } is set by the module <script> in
// index.html. One process owns a serial port at a time, so the caller must close
// the lab's serial link (dev.disconnect) before flashing.

export async function flashFirmware({ url, file, name, address = 0x0, onLog, onProgress } = {}) {
  const log = (m) => { try { onLog?.(String(m)); } catch { /* no sink */ } };

  if (!window.esptooljs) { log("esptool-js failed to load (needs network access at page load)."); return false; }
  if (!("serial" in navigator)) { log("Web Serial unavailable — use Chrome/Edge/Brave/Opera over HTTPS or localhost."); return false; }

  const { ESPLoader, Transport } = window.esptooljs;
  let transport;
  try {
    // 1. Get the image bytes (uploaded file wins over the bundled URL).
    let buf;
    if (file) {
      buf = new Uint8Array(await file.arrayBuffer());
      log(`Image: ${file.name} (${buf.length.toLocaleString()} bytes)`);
    } else {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`firmware not found at ${url} (${resp.status})`);
      buf = new Uint8Array(await resp.arrayBuffer());
      log(`Image: ${name || url} (${buf.length.toLocaleString()} bytes)`);
    }
    if (buf.length && buf[0] !== 0xe9) {
      log("⚠ warning: image does not start with 0xE9 (ESP image magic). Flashing at 0x0 anyway.");
    }
    // esptool-js 0.4.x writeFlash wants a binary *string*, not a typed array.
    let binStr = "";
    for (let i = 0; i < buf.length; i++) binStr += String.fromCharCode(buf[i]);

    // 2. Pick the port + open the loader (a user gesture already happened on the click).
    log("Select the board's serial port in the browser dialog…");
    const port = await navigator.serial.requestPort();
    transport = new Transport(port, true);
    const loader = new ESPLoader({
      transport,
      baudrate: 460800,
      terminal: { clean() {}, writeLine: (d) => log(d), write: (d) => log(d) },
    });

    log("Connecting to the bootloader…");
    const chip = await loader.main();
    log(`Detected: ${chip}`);

    // 3. Write the whole image at 0x0.
    log(`Writing ${buf.length.toLocaleString()} bytes @ 0x${address.toString(16)} …`);
    let lastPct = -1;
    await loader.writeFlash({
      fileArray: [{ data: binStr, address }],
      flashSize: "keep", flashMode: "keep", flashFreq: "keep",
      eraseAll: false, compress: true,
      reportProgress: (_i, written, total) => {
        const pct = Math.round((written / total) * 100);
        onProgress?.(pct);
        if (pct !== lastPct && pct % 10 === 0) { log(`  ${pct}%`); lastPct = pct; }
      },
    });

    // 4. Reset into the app. esptool-js 0.4.x has no after(); hardReset(), guarded.
    try {
      if (typeof loader.hardReset === "function") await loader.hardReset();
      else if (transport && typeof transport.setRTS === "function") {
        await transport.setRTS(true); await new Promise((r) => setTimeout(r, 100)); await transport.setRTS(false);
      }
    } catch (_) { log("  (auto-reset skipped — unplug/replug the board to boot it)"); }

    log("✅ Install complete. Reconnect the node in the lab (Connect) to drive it.");
    return true;
  } catch (err) {
    log("❌ " + (err && err.message ? err.message : err));
    return false;
  } finally {
    try { if (transport) await transport.disconnect(); } catch (_) { /* already gone */ }
  }
}
