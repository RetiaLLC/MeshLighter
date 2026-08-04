// AuthGate — authorization interstitial shown before installing transmit-capable
// firmware. Exported for app.js; the lab's ungated surface (Demo Mode + read-only
// Python scripting) never calls this. Resolves true only after the operator ticks
// the affirmation and confirms. Injects its own styles so it drops in unchanged.

const STYLE_ID = "authgate-style";
const CSS = `
.authgate-overlay{position:fixed;inset:0;z-index:9999;display:none;
  align-items:center;justify-content:center;background:rgba(4,6,12,.86);
  backdrop-filter:blur(4px);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.authgate-overlay.open{display:flex}
.authgate-card{max-width:560px;width:calc(100% - 2.5rem);background:#0d1117;
  color:#e6edf3;border:1px solid #f0503a;border-radius:12px;padding:1.6rem 1.7rem;
  box-shadow:0 0 0 1px rgba(240,80,58,.25),0 24px 60px rgba(0,0,0,.6)}
.authgate-card h2{margin:0 0 .3rem;font-size:1.15rem;color:#ff6a4d;
  display:flex;align-items:center;gap:.5rem}
.authgate-sub{margin:0 0 1rem;font-size:.82rem;color:#9aa4b2;line-height:1.5}
.authgate-card ul{margin:.2rem 0 1rem;padding-left:1.1rem;font-size:.82rem;
  color:#c9d1d9;line-height:1.55}
.authgate-card ul li{margin:.15rem 0}
.authgate-affirm{display:flex;gap:.6rem;align-items:flex-start;font-size:.82rem;
  line-height:1.45;background:#161b22;border:1px solid #30363d;border-radius:8px;
  padding:.7rem .8rem;margin-bottom:1rem;cursor:pointer}
.authgate-affirm input{margin-top:.15rem;flex:0 0 auto;width:1rem;height:1rem;accent-color:#f0503a}
.authgate-actions{display:flex;gap:.6rem;justify-content:flex-end}
.authgate-btn{font:inherit;font-size:.85rem;padding:.5rem 1.1rem;border-radius:7px;
  border:1px solid #30363d;background:#21262d;color:#e6edf3;cursor:pointer}
.authgate-btn:hover{border-color:#8b949e}
.authgate-btn.primary{background:#8b2b1f;border-color:#f0503a;color:#fff}
.authgate-btn.primary:disabled{opacity:.4;cursor:not-allowed;background:#3a2420;border-color:#5c3a33}
.authgate-legal{margin:.9rem 0 0;font-size:.72rem;color:#6e7681;line-height:1.5}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID; s.textContent = CSS;
  document.head.appendChild(s);
}

export function showAuthGate(opts = {}) {
  ensureStyle();
  const tool = opts.tool || "Install transmit-capable firmware";
  const caps = opts.capabilities || [];

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "authgate-overlay";
    overlay.innerHTML = `
      <div class="authgate-card" role="dialog" aria-modal="true">
        <h2>Heads up — transmit-capable firmware</h2>
        <p class="authgate-sub"><strong>${tool}</strong> writes the radio-pipe firmware
          to the connected board. It ships <em>inert</em> — no attack tooling, and it does
          nothing on its own — but once installed the firmware can:</p>
        <ul>${caps.map((c) => `<li>${c}</li>`).join("")}</ul>
        <label class="authgate-affirm">
          <input type="checkbox" id="authgate-check" />
          <span>I own, or am explicitly authorized to test, the hardware and the RF
            environment I will use this on. I understand that transmitting on the 900&nbsp;MHz
            band or injecting into a Meshtastic network I do not own may be illegal.</span>
        </label>
        <div class="authgate-actions">
          <button class="authgate-btn" id="authgate-cancel">Cancel</button>
          <button class="authgate-btn primary" id="authgate-go" disabled>I understand — continue</button>
        </div>
        <p class="authgate-legal">Demo Mode and read-only Python scripting need none of this
          and are always available without the gate.</p>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));

    const check = overlay.querySelector("#authgate-check");
    const go = overlay.querySelector("#authgate-go");
    const cancel = overlay.querySelector("#authgate-cancel");
    const close = (result) => { overlay.remove(); resolve(result); };

    check.addEventListener("change", () => { go.disabled = !check.checked; });
    go.addEventListener("click", () => { if (check.checked) close(true); });
    cancel.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}
