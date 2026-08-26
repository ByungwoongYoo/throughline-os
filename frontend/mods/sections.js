/* ==========================================================================
   TLSections — the real-scroll page below the pinned black-hole stage.
   Installer section (#get) + footer, with uk-parallax-style entrance offsets
   and an ember glow spilling down from the top edge (the hole is above).

   Exports (concatenated into the page's inline script — no modules):
     TL_SECTIONS_HTML   markup to inject
     TL_SECTIONS_CSS    helmet CSS additions
     class TLSections   constructor(rootEl); update(scrollY, vh)
   ========================================================================== */

const TL_SECTIONS_HTML = `
<div class="tl-below">
  <div class="tl-spill" aria-hidden="true"></div>

  <section class="tl-get" id="get">
    <div class="tl-get-inner" data-tl-group>
      <span class="tl-eyebrow" data-tl-rise="20">Get Throughline</span>
      <h2 class="tl-get-h2" data-tl-rise="36">One door per platform.</h2>

      <div class="tl-cmd" data-tl-rise="48">
        <div class="tl-cmd-scroll">
          <span class="tl-cmd-sigil">$</span><span class="tl-cmd-text">curl -fsSL https://throughline-research.pages.dev/install.sh | sh</span>
        </div>
      </div>

      <div class="tl-rows">
        <div class="tl-row" data-tl-rise="60">
          <b class="tl-row-os">macOS</b>
          <code class="tl-row-path">launchers/Throughline.command</code>
          <span class="tl-row-note">right-click, Open, once</span>
        </div>
        <div class="tl-row" data-tl-rise="72">
          <b class="tl-row-os">Windows</b>
          <code class="tl-row-path">launchers\\Throughline.bat</code>
          <span class="tl-row-note">More info, Run anyway, once</span>
        </div>
        <div class="tl-row" data-tl-rise="84">
          <b class="tl-row-os">Linux</b>
          <code class="tl-row-path">python scripts/manage.py desktop-entry</code>
          <span class="tl-row-note">no warnings</span>
        </div>
      </div>
    </div>
  </section>

  <footer class="tl-foot">
    <div class="tl-foot-inner" data-tl-group>
      <div class="tl-foot-mark" data-tl-rise="20">
        <span class="tl-mark" aria-hidden="true"><span class="tl-mark-bar"></span></span>
        <span>Throughline · a research operating system</span>
      </div>
      <!-- A "Read how it works on GitHub" link lived here, pointing at the
           private repository. This module is not wired into the page today, so
           it was a trap rather than a live defect: resurrect the section and the
           404 comes back with it. Removed for the same reason as the GitHub
           button in main.template.html. -->
    </div>
  </footer>
</div>
`;

const TL_SECTIONS_CSS = `
.tl-below {
  position: relative;
  background: #06070a;
  isolation: isolate;
}

/* --- ember spill from the top edge: the hole is just above ------------- */
.tl-spill {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translate(-50%, -24%);
  width: min(1160px, 132vw);
  height: min(540px, 56vh);
  pointer-events: none;
  z-index: 0;
  opacity: 0;
  will-change: opacity, transform;
  background:
    radial-gradient(50% 50% at 50% 46%,
      rgba(240,190,112,0.26) 0%,
      rgba(236,178,100,0.175) 16%,
      rgba(226,163,84,0.105) 30%,
      rgba(206,140,68,0.058) 43%,
      rgba(180,116,52,0.028) 56%,
      rgba(150,94,40,0.011) 68%,
      rgba(120,74,32,0.004) 80%,
      rgba(6,7,10,0) 92%),
    radial-gradient(20% 26% at 50% 44%,
      rgba(255,241,216,0.17) 0%,
      rgba(255,238,209,0.075) 34%,
      rgba(255,236,205,0.024) 58%,
      rgba(255,236,205,0) 84%);
}

/* --- installer -------------------------------------------------------- */
.tl-get {
  position: relative;
  z-index: 1;
  padding: clamp(96px, 17vh, 190px) clamp(20px, 5vw, 40px) clamp(70px, 11vh, 130px);
}
.tl-get-inner,
.tl-foot-inner {
  max-width: 720px;
  margin: 0 auto;
  text-align: center;
}
.tl-get-inner > *,
.tl-foot-inner > * { will-change: transform, opacity; }

.tl-eyebrow {
  display: block;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
  font-size: 10.5px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  font-weight: 600;
  color: rgba(244,242,238,0.45);
  margin: 0 0 14px;
}
.tl-get-h2 {
  font-family: 'Source Serif 4', 'Iowan Old Style', Georgia, serif;
  font-weight: 400;
  font-style: italic;
  letter-spacing: -0.022em;
  line-height: 1.12;
  font-size: clamp(1.6rem, 3.2vw, 2.5rem);
  color: #f4f2ee;
  margin: 0;
  text-shadow: 0 2px 24px rgba(6,7,10,0.9);
}

/* --- the one command -------------------------------------------------- */
.tl-cmd {
  position: relative;
  max-width: 640px;
  margin: clamp(22px, 3.4vw, 30px) auto 0;
  border: 1px solid rgba(244,242,238,0.18);
  border-radius: 6px;
  background: rgba(10,12,17,0.8);
  box-shadow: 0 1px 0 rgba(244,242,238,0.05) inset, 0 18px 44px -30px rgba(0,0,0,0.9);
  text-align: left;
}
.tl-cmd-scroll {
  display: flex;
  align-items: baseline;
  gap: 11px;
  padding: 14px 18px;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
  font-size: 12px;
  line-height: 1.62;
  overflow-wrap: anywhere;
  min-width: 0;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: rgba(244,242,238,0.16) transparent;
}
.tl-cmd-scroll::-webkit-scrollbar { height: 5px; }
.tl-cmd-scroll::-webkit-scrollbar-track { background: transparent; }
.tl-cmd-scroll::-webkit-scrollbar-thumb {
  background: rgba(244,242,238,0.16);
  border-radius: 3px;
}
.tl-cmd-sigil { color: rgba(244,242,238,0.34); user-select: none; flex: 0 0 auto; }
.tl-cmd-text { color: #f4f2ee; }

/* --- three platform rows ---------------------------------------------- */
.tl-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 640px;
  margin: clamp(16px, 2.4vw, 22px) auto 0;
  text-align: left;
}
.tl-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  min-width: 0;
  padding: 11px 16px;
  border: 1px solid rgba(244,242,238,0.12);
  border-radius: 6px;
  background: rgba(10,12,17,0.72);
  box-shadow: 0 1px 0 rgba(244,242,238,0.035) inset;
  font-size: 13px;
  color: #f4f2ee;
}
.tl-row-os { font-weight: 520; min-width: 72px; flex: 0 0 auto; }
.tl-row-path {
  font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
  font-size: 12px;
  color: #7fa8d4;
  min-width: 0;
  overflow-wrap: anywhere;
}
.tl-row-note {
  color: rgba(244,242,238,0.5);
  margin-left: auto;
  font-weight: 350;
  min-width: 0;
  overflow-wrap: anywhere;
}

/* --- footer ----------------------------------------------------------- */
.tl-foot {
  position: relative;
  z-index: 1;
  padding: clamp(46px, 8vh, 86px) clamp(20px, 5vw, 40px) clamp(56px, 10vh, 104px);
  border-top: 1px solid rgba(244,242,238,0.12);
}
.tl-foot-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 13px;
  font-weight: 350;
  color: rgba(244,242,238,0.6);
}
.tl-mark {
  position: relative;
  width: 16px;
  height: 16px;
  border: 1px solid rgba(244,242,238,0.6);
  border-radius: 50%;
  flex: 0 0 auto;
  display: inline-block;
}
.tl-mark-bar {
  position: absolute;
  left: -5px;
  right: -5px;
  top: 50%;
  border-top: 1px solid rgba(244,242,238,0.6);
  transform: translateY(-50%) rotate(-28deg);
  display: block;
}
.tl-foot-link {
  margin: 16px 0 0;
  font-size: 13.5px;
  font-weight: 350;
  color: rgba(244,242,238,0.55);
}
.tl-foot-link a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgba(244,242,238,0.3);
  transition: color 240ms ease, text-decoration-color 240ms ease;
}
.tl-foot-link a:hover {
  color: #e8b76a;
  text-decoration-color: rgba(232,183,106,0.5);
}

/* --- narrow: single column -------------------------------------------- */
@media (max-width: 900px) {
  .tl-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }
  .tl-row-os {
    min-width: 0;
    font-size: 12.5px;
    letter-spacing: 0.02em;
  }
  .tl-row-note { margin-left: 0; }

  /* Phones: one uninterrupted line you can swipe, with a fade at the edge
     so it is obvious there is more command past the frame. */
  .tl-cmd {
    -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 34px), rgba(0,0,0,0) 100%);
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 34px), rgba(0,0,0,0) 100%);
  }
  .tl-cmd-scroll {
    padding: 13px 15px 11px;
    font-size: 12px;
    white-space: nowrap;
    overflow-wrap: normal;
    overflow-x: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tl-get-inner > *,
  .tl-foot-inner > * { will-change: auto; }
}
`;

class TLSections {
  constructor(rootEl) {
    this.root = rootEl;
    this.spill = rootEl.querySelector(".tl-spill");
    this.reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Each [data-tl-group] is one entrance cluster with its own cached top.
    this.groups = Array.prototype.map.call(
      rootEl.querySelectorAll("[data-tl-group]"),
      (host) => ({
        host: host,
        top: 0,
        items: Array.prototype.map.call(
          host.querySelectorAll("[data-tl-rise]"),
          (el, i) => ({
            el: el,
            rise: parseFloat(el.getAttribute("data-tl-rise")) || 0,
            delay: i * 0.055,
            y: NaN,
            o: NaN,
          })
        ),
      })
    );

    this.spillTop = 0;
    this.settled = false;

    this.measure();
    this._onResize = () => {
      this.measure();
      this.settled = false;
    };
    addEventListener("resize", this._onResize);
    addEventListener("orientationchange", this._onResize);

    // Paint the pre-entrance state immediately so nothing flashes in place.
    if (this.reduced) this.settle();
    else this.update(window.scrollY || window.pageYOffset || 0, innerHeight);
  }

  /* Read layout once (construction + resize), never per frame. */
  measure() {
    const sy = window.scrollY || window.pageYOffset || 0;
    for (let g = 0; g < this.groups.length; g++) {
      const grp = this.groups[g];
      grp.top = grp.host.getBoundingClientRect().top + sy;
    }
    if (this.spill) this.spillTop = this.spill.getBoundingClientRect().top + sy;
  }

  /* Final resting state, applied once (reduced motion). */
  settle() {
    for (let g = 0; g < this.groups.length; g++) {
      const items = this.groups[g].items;
      for (let i = 0; i < items.length; i++) {
        items[i].el.style.transform = "none";
        items[i].el.style.opacity = "1";
        items[i].y = 0;
        items[i].o = 1;
      }
    }
    if (this.spill) this.spill.style.opacity = "0.55";
    this.settled = true;
  }

  update(scrollY, vh) {
    if (this.reduced) {
      if (!this.settled) this.settle();
      return;
    }
    const H = vh || innerHeight || 800;

    for (let g = 0; g < this.groups.length; g++) {
      const grp = this.groups[g];
      // 0 when the cluster's top touches the viewport bottom,
      // 1 once it has travelled ~0.82 viewport heights further up.
      const entered = scrollY + H - grp.top;
      const p = entered / (H * 0.82);
      const pc = p < 0 ? 0 : p > 1 ? 1 : p;
      const items = grp.items;
      const span = 1 - (items.length - 1) * 0.055;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        let t = (pc - it.delay) / span;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        // cubic-bezier(0.16, 1, 0.3, 1) ≈ expo-out
        const e = t >= 1 ? 1 : 1 - Math.pow(2, -9 * t);
        const y = Math.round((it.rise - it.rise * e) * 100) / 100;
        const o = Math.round(Math.min(1, e * 1.25) * 1000) / 1000;
        if (y !== it.y) {
          it.el.style.transform = y === 0 ? "none" : "translate3d(0," + y + "px,0)";
          it.y = y;
        }
        if (o !== it.o) {
          it.el.style.opacity = o === 1 ? "1" : String(o);
          it.o = o;
        }
      }
    }

    if (this.spill) {
      // Blooms as the section rises into frame, then thins out as the hole
      // is left behind above.
      const d = scrollY + H - this.spillTop;
      const rise = d / (H * 0.55);
      const inn = rise < 0 ? 0 : rise > 1 ? 1 : rise;
      const away = (d - H * 0.75) / (H * 1.25);
      const out = away < 0 ? 0 : away > 1 ? 1 : away;
      const a = Math.round(inn * (1 - 0.86 * out) * 1000) / 1000;
      if (a !== this._spillA) {
        this.spill.style.opacity = String(a);
        this.spill.style.transform =
          "translate(-50%," + (-24 + 6 * out).toFixed(2) + "%)";
        this._spillA = a;
      }
    }
  }
}
