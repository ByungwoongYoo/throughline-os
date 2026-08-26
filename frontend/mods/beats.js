/* ======================================================================
   TLBeats — text choreography for the pinned stage.

   Three story beats ENTER as staggered line rises, HOLD dead still, and
   EXIT by GRAINING AWAY: the real text fades and blurs while a particle
   field sampled from its own line boxes accelerates into the black hole
   on a slight spiral. Nothing translates as a block. Nothing rotates.

     const beats = new TLBeats(beatEls, particleCanvas, holeXY);
     beats.update(p, t);   // every frame; p = stage progress 0..1

   Concatenation-safe: no imports, no exports, top-level const/class only.
   ====================================================================== */

/* Windows on p for the canonical three beats.
   inside each: first 25% ENTER, middle 45% HOLD, last 30% EXIT. */
const TL_BEAT_WINDOWS = [[0.04, 0.30], [0.36, 0.60], [0.66, 0.90]];

const TL_BEAT_ENTER_END = 0.25;
const TL_BEAT_EXIT_START = 0.70;

/* Nominal timings, used only as a RATIO so "~70ms stagger" is exact in
   p-space no matter how fast the reader scrolls. */
const TL_BEAT_LINE_MS = 780;
const TL_BEAT_STAGGER_MS = 70;

const TL_BEAT_RISE_PX = 28;
const TL_BEAT_MAX_PARTICLES = 700;
const TL_BEAT_SPAWN_BUDGET = 620;   /* per dissolve, leaves pool headroom */
const TL_BEAT_SAMPLE_STEP = 12;     /* ~1 spawn point per 12px of width  */
const TL_BEAT_EXIT_LINE_STAGGER = 0.06; /* per line, in exit-local units */

/* cubic-bezier(0.16, 1, 0.3, 1) solved in JS. */
const TL_BEAT_EASE = (function () {
  const x1 = 0.16, y1 = 1.0, x2 = 0.3, y2 = 1.0;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = function (t) { return ((ax * t + bx) * t + cx) * t; };
  const dfx = function (t) { return (3 * ax * t + 2 * bx) * t + cx; };
  return function (x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 5; i++) {
      const e = fx(t) - x;
      if (e > -1e-5 && e < 1e-5) break;
      const d = dfx(t);
      if (d < 1e-6) break;
      t -= e / d;
    }
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return ((ay * t + by) * t + cy) * t;
  };
})();

const TL_BEAT_CLAMP01 = function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); };

/* ember tint #e8b76a, paper white #f4f2ee */
const TL_BEAT_TINTS = [
  [244, 242, 238], [244, 242, 238], [244, 242, 238], [244, 242, 238],
  [244, 242, 238], [244, 242, 238], [255, 253, 248],
  [232, 183, 106], [240, 205, 150]
];

class TLBeats {

  constructor(beatEls, particleCanvas, holeXY, windows) {
    this.els = Array.prototype.slice.call(beatEls || []);
    this.canvas = particleCanvas || null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.holeXY = typeof holeXY === 'function'
      ? holeXY
      : function () { return [0, 0]; };

    this.reduced = false;
    try {
      this.mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = !!this.mq.matches;
      const self = this;
      const onChange = function (e) { self.reduced = !!e.matches; self._reset(); };
      if (this.mq.addEventListener) this.mq.addEventListener('change', onChange);
      else if (this.mq.addListener) this.mq.addListener(onChange);
    } catch (err) { this.reduced = false; }

    const wins = windows || TLBeats.windowsFor(this.els.length);
    const self2 = this;
    this.beats = this.els.map(function (el, i) {
      const lines = Array.prototype.filter.call(el.children, function (c) {
        return c.nodeType === 1;
      });
      lines.forEach(function (ln) {
        ln.style.willChange = 'transform, opacity, filter';
        ln.style.backfaceVisibility = 'hidden';
      });
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      return {
        el: el,
        lines: lines,
        w0: wins[i][0],
        w1: wins[i][1],
        plan: null,
        released: [],
        visible: false,
        n: lines.length
      };
    });
    void self2;

    /* pooled particles */
    this.pool = new Array(TL_BEAT_MAX_PARTICLES);
    for (let i = 0; i < TL_BEAT_MAX_PARTICLES; i++) {
      this.pool[i] = {
        on: false, x: 0, y: 0, px: 0, py: 0,
        r0: 0, a0: 0, curl: 0, wob: 0, wf: 0,
        life: 0, max: 1, size: 1, r: 244, g: 242, b: 238, a: 1
      };
    }
    this.cursor = 0;
    this.live = 0;

    this.dpr = 1;
    this.cw = 0;
    this.ch = 0;
    this.lastT = null;
    this.lastP = 0;
    this._syncCanvas();
  }

  /* Canonical three-beat table; anything else is spread evenly with the
     same enter/hold/exit proportions inside each window. */
  static windowsFor(n) {
    if (n === 3) return TL_BEAT_WINDOWS.slice();
    if (n <= 0) return [];
    if (n === 1) return [[0.06, 0.94]];
    const gap = 0.06;
    const span = (0.94 - gap * (n - 1)) / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = 0.03 + i * (span + gap);
      out.push([a, a + span]);
    }
    return out;
  }

  /* ---------------------------------------------------------------- */

  update(p, t) {
    p = TL_BEAT_CLAMP01(typeof p === 'number' ? p : 0);

    /* dt in seconds, tolerant of ms or s clocks */
    let dt = 0;
    if (typeof t === 'number' && isFinite(t)) {
      if (this.lastT !== null) {
        let d = t - this.lastT;
        if (d > 1 || d < -1) d = d / 1000;
        dt = d;
      }
      this.lastT = t;
    } else {
      dt = 1 / 60;
    }
    if (!(dt > 0)) dt = 0;
    if (dt > 1 / 20) dt = 1 / 20;

    const rewound = p < this.lastP - 0.004;
    this.lastP = p;

    if (this.reduced) { this._updateReduced(p); return; }

    this._syncCanvas();
    const co = this.canvas ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };

    for (let i = 0; i < this.beats.length; i++) {
      this._updateBeat(this.beats[i], p, co, rewound);
    }

    this._step(dt);
    this._draw();
  }

  /* ---------------------------------------------------------------- */

  _updateBeat(b, p, co, rewound) {
    const span = b.w1 - b.w0;
    const w = span > 0 ? (p - b.w0) / span : 0;

    if (w <= -0.001 || w >= 1.001) {
      if (b.visible) {
        b.visible = false;
        b.el.style.visibility = 'hidden';
        b.el.style.opacity = '0';
      }
      b.plan = null;
      b.released.length = 0;
      return;
    }

    if (!b.visible) {
      b.visible = true;
      b.el.style.visibility = 'visible';
      b.el.style.opacity = '1';
    }

    const e = TL_BEAT_CLAMP01(w / TL_BEAT_ENTER_END);
    const x = TL_BEAT_CLAMP01((w - TL_BEAT_EXIT_START) / (1 - TL_BEAT_EXIT_START));

    if (x <= 0) {
      /* scrubbed back out of the exit — forget the dissolve */
      b.plan = null;
      b.released.length = 0;
      if (rewound) this._killAll();
    }

    /* --- ENTER: staggered line rises ------------------------------- */
    const n = b.n || 1;
    const total = TL_BEAT_LINE_MS + (n - 1) * TL_BEAT_STAGGER_MS;
    const tau = e * total;

    for (let i = 0; i < b.lines.length; i++) {
      const ln = b.lines[i];
      const lp = TL_BEAT_CLAMP01((tau - i * TL_BEAT_STAGGER_MS) / TL_BEAT_LINE_MS);
      const k = TL_BEAT_EASE(lp);

      let op = k;
      let ty = TL_BEAT_RISE_PX * (1 - k);
      let blur = 3 * (1 - TL_BEAT_CLAMP01(lp / 0.55));

      /* --- EXIT: fast fade + 1px -> 3px blur, per-line stagger ----- */
      if (x > 0) {
        const lx = TL_BEAT_CLAMP01(x - i * TL_BEAT_EXIT_LINE_STAGGER);
        const f = TL_BEAT_CLAMP01(lx / 0.30);
        op *= 1 - f * f * (3 - 2 * f);   /* smoothstep out across the 30% */
        blur = Math.max(
          blur,
          f < 0.12 ? (f / 0.12) : 1 + 2 * ((f - 0.12) / 0.88)
        );
      }

      ln.style.opacity = op.toFixed(3);
      ln.style.transform = ty > 0.05 ? 'translate3d(0,' + ty.toFixed(2) + 'px,0)' : '';
      ln.style.filter = blur > 0.02 ? 'blur(' + blur.toFixed(2) + 'px)' : '';
    }

    /* --- EXIT: release the particle stream, line by line ------------ */
    if (x > 0 && this.ctx) {
      if (!b.plan) {
        b.plan = this._planDissolve(b, co);
        b.released.length = 0;
      }
      for (let i = 0; i < b.plan.length; i++) {
        if (b.released[i]) continue;
        if (x >= i * TL_BEAT_EXIT_LINE_STAGGER) {
          b.released[i] = true;
          this._emit(b.plan[i]);
        }
      }
    }
  }

  _updateReduced(p) {
    for (let i = 0; i < this.beats.length; i++) {
      const b = this.beats[i];
      const span = b.w1 - b.w0;
      const w = span > 0 ? (p - b.w0) / span : 0;
      const on = w > -0.001 && w < 1.001;
      if (on === b.visible) continue;
      b.visible = on;
      b.el.style.visibility = on ? 'visible' : 'hidden';
      b.el.style.opacity = on ? '1' : '0';
      for (let j = 0; j < b.lines.length; j++) {
        const ln = b.lines[j];
        ln.style.opacity = '';
        ln.style.transform = '';
        ln.style.filter = '';
      }
    }
    if (this.ctx && this.live > 0) { this._killAll(); this._draw(); }
  }

  /* ---------------------------------------------------------------- */
  /* Spawn points: the visible line boxes of each block child. Range
     rects hug the actual glyph runs (a centred headline is far narrower
     than its 680px block), with the element rect as the fallback.       */

  _planDissolve(b, co) {
    const groups = [];
    let grand = 0;
    for (let i = 0; i < b.lines.length; i++) {
      const rects = this._lineRects(b.lines[i]);
      const pts = [];
      for (let r = 0; r < rects.length; r++) {
        const rc = rects[r];
        const w = rc.width, h = rc.height;
        if (w < 3 || h < 3 || w > 4000 || h > 3000) continue;
        const cols = Math.max(1, Math.round(w / TL_BEAT_SAMPLE_STEP));
        const rows = Math.max(1, Math.round(h / 13));
        const left = rc.left - co.left, top = rc.top - co.top;
        for (let ry = 0; ry < rows; ry++) {
          const py = top + (ry + 0.5) * (h / rows);
          for (let cx = 0; cx < cols; cx++) {
            const px = left + (cx + 0.5) * (w / cols);
            pts.push([
              px + (Math.random() - 0.5) * 9,
              py + (Math.random() - 0.5) * (h / rows) * 0.9
            ]);
          }
        }
      }
      grand += pts.length;
      groups.push(pts);
    }
    if (grand > TL_BEAT_SPAWN_BUDGET && grand > 0) {
      const keep = TL_BEAT_SPAWN_BUDGET / grand;
      for (let i = 0; i < groups.length; i++) {
        const src = groups[i];
        const out = [];
        const want = Math.max(6, Math.round(src.length * keep));
        const stride = src.length / want;
        for (let k = 0; k < want; k++) {
          const idx = Math.min(src.length - 1, Math.floor(k * stride + Math.random() * stride));
          out.push(src[idx]);
        }
        groups[i] = out;
      }
    }
    return groups;
  }

  _lineRects(el) {
    let rects = null;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const list = range.getClientRects();
      range.detach && range.detach();
      if (list && list.length) {
        rects = [];
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          if (r.width > 2 && r.height > 2) rects.push(r);
        }
      }
    } catch (err) { rects = null; }
    if (!rects || !rects.length) {
      const r = el.getBoundingClientRect();
      rects = (r.width > 2 && r.height > 2) ? [r] : [];
    }
    return rects;
  }

  /* Each grain falls on a spiral that is parameterised in polar
     coordinates around the hole, so it is CAPTURED — it can never
     slingshot past and spray out the far side. r shrinks on an ease-in
     (gravity-ish acceleration), the angle winds by a small curl. */
  _emit(points) {
    if (!points || !points.length) return;
    const hxy = this.holeXY() || [0, 0];
    const hx = hxy[0], hy = hxy[1];

    /* erosion order: grains nearest the hole let go first */
    let dmin = Infinity, dmax = 0;
    const ds = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const dx = points[i][0] - hx, dy = points[i][1] - hy;
      const d = Math.sqrt(dx * dx + dy * dy);
      ds[i] = d;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
    }
    const spread = Math.max(1, dmax - dmin);

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const q = this._take();
      const tint = TL_BEAT_TINTS[(Math.random() * TL_BEAT_TINTS.length) | 0];
      const dx = pt[0] - hx, dy = pt[1] - hy;
      const norm = (ds[i] - dmin) / spread;

      q.on = true;
      q.x = q.px = pt[0];
      q.y = q.py = pt[1];
      q.r0 = Math.max(8, ds[i]);
      q.a0 = Math.atan2(dy, dx);
      q.curl = (Math.random() < 0.88 ? 1 : -1) * (0.42 + Math.random() * 0.85);
      q.wob = 1.6 + Math.random() * 3.4;
      q.wf = 5 + Math.random() * 7;
      q.life = -(0.30 * norm + Math.random() * 0.13);
      q.max = 0.78 + Math.random() * 0.52;
      q.size = 0.6 + Math.random() * 1.35;
      q.r = tint[0]; q.g = tint[1]; q.b = tint[2];
      q.a = 0.42 + Math.random() * 0.5;
    }
  }

  _take() {
    for (let i = 0; i < TL_BEAT_MAX_PARTICLES; i++) {
      const idx = (this.cursor + i) % TL_BEAT_MAX_PARTICLES;
      if (!this.pool[idx].on) {
        this.cursor = (idx + 1) % TL_BEAT_MAX_PARTICLES;
        this.live++;
        return this.pool[idx];
      }
    }
    const q = this.pool[this.cursor];              /* recycle the oldest */
    this.cursor = (this.cursor + 1) % TL_BEAT_MAX_PARTICLES;
    return q;
  }

  _killAll() {
    for (let i = 0; i < TL_BEAT_MAX_PARTICLES; i++) this.pool[i].on = false;
    this.live = 0;
  }

  /* ---------------------------------------------------------------- */

  _step(dt) {
    if (!this.ctx || dt <= 0) return;
    const hxy = this.holeXY() || [0, 0];
    const hx = hxy[0], hy = hxy[1];

    for (let i = 0; i < TL_BEAT_MAX_PARTICLES; i++) {
      const q = this.pool[i];
      if (!q.on) continue;
      q.life += dt;
      if (q.life < 0) { q.px = q.x; q.py = q.y; continue; }
      if (q.life >= q.max) { q.on = false; this.live--; continue; }

      const lt = q.life / q.max;
      const u = Math.pow(lt, 1.7);              /* ease-in == acceleration */
      const r = q.r0 * (1 - u);
      const ang = q.a0 + q.curl * Math.pow(u, 1.15);
      const w = q.wob * (1 - u);

      q.px = q.x; q.py = q.y;
      q.x = hx + Math.cos(ang) * r + Math.cos(q.life * q.wf) * w;
      q.y = hy + Math.sin(ang) * r + Math.sin(q.life * q.wf * 0.83) * w;
    }
  }

  _draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (this.live <= 0) return;

    const hxy = this.holeXY() || [0, 0];
    const hx = hxy[0], hy = hxy[1];

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let i = 0; i < TL_BEAT_MAX_PARTICLES; i++) {
      const q = this.pool[i];
      if (!q.on || q.life < 0) continue;
      const lt = q.life / q.max;

      let alpha = q.a;
      alpha *= lt < 0.12 ? lt / 0.12 : Math.pow(1 - (lt - 0.12) / 0.88, 0.72);

      const dx = hx - q.x, dy = hy - q.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 64) alpha *= d / 64;              /* swallowed by the shadow */
      if (alpha <= 0.004) continue;

      const s = q.size * (1 - 0.7 * lt);
      const col = q.r + ',' + q.g + ',' + q.b;

      /* a short motion smear along the fall — grain, not sparks */
      let mx = q.x - q.px, my = q.y - q.py;
      const mlen = Math.sqrt(mx * mx + my * my);
      if (mlen > 1.0) {
        const cap = Math.min(mlen * 1.35, 8.5) / mlen;
        mx *= cap; my *= cap;
        ctx.strokeStyle = 'rgba(' + col + ',' + (alpha * 0.38).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.5, s * 0.8);
        ctx.beginPath();
        ctx.moveTo(q.x - mx, q.y - my);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(' + col + ',' + alpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(q.x, q.y, s * 0.5, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- */

  _syncCanvas() {
    const c = this.canvas;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) {
      w = window.innerWidth;
      h = window.innerHeight;
    }
    if (w === this.cw && h === this.ch && dpr === this.dpr) return;
    this.cw = w; this.ch = h; this.dpr = dpr;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _reset() {
    this._killAll();
    for (let i = 0; i < this.beats.length; i++) {
      const b = this.beats[i];
      b.plan = null;
      b.released.length = 0;
      b.visible = false;
      b.el.style.visibility = 'hidden';
      b.el.style.opacity = '0';
      for (let j = 0; j < b.lines.length; j++) {
        b.lines[j].style.opacity = '';
        b.lines[j].style.transform = '';
        b.lines[j].style.filter = '';
      }
    }
    if (this.ctx) this.ctx.clearRect(0, 0, this.cw, this.ch);
  }
}
