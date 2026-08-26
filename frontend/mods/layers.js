/* TLLayers — parallax depth layers for the Throughline hero stage.
   ONE transparent 2D canvas that sits ABOVE the WebGL canvas.
   Owns: near stars (0.12), dust motes (0.25), vignette, film grain.
   The shader owns the far star field (0.05) behind everything.

   API
     var layers = new TLLayers(canvasEl);
     layers.resize();                        // on stage resize / dpr change
     layers.draw(t, scrollY, p, mx, my);     // every frame
       t       seconds (milliseconds also accepted)
       scrollY window.scrollY in CSS px
       p       0..1 runway progress
       mx, my  pointer drift, ALREADY lerped, normalised roughly -1..1
*/

class TLLayers {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });

    this.reduced = false;
    try {
      this.reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { this.reduced = false; }

    this.w = 0; this.h = 0; this.dpr = 1;
    this._staticDone = false;

    // soft-light degrades to source-over over transparent pixels, so it is
    // always safe; where we HAVE drawn (stars, motes) it blends more kindly.
    var probe = this.ctx.globalCompositeOperation;
    this.ctx.globalCompositeOperation = 'soft-light';
    this._softLight = (this.ctx.globalCompositeOperation === 'soft-light');
    this.ctx.globalCompositeOperation = probe;

    // deterministic field — same sky on every load
    var rnd = TLLayers._rng(0x7ea51ce);

    // ---- near stars -------------------------------------------------------
    // 140 in a field taller than the stage so the 0.12 parallax never runs dry
    this.STAR_PARALLAX = 0.12;
    this.STAR_MARGIN = 420;
    this.stars = [];
    for (var i = 0; i < 140; i++) {
      var g = rnd();
      // heavy tail: mostly faint pinpricks, a handful of real anchors
      var r = 0.5 + Math.pow(g, 1.9) * 1.1;
      var a = 0.34 + Math.pow(g, 1.15) * 0.46;
      this.stars.push({
        nx: rnd(),
        ny: rnd(),
        r: r,
        a: a,
        bucket: Math.min(5, (Math.pow(g, 1.9) * 6) | 0),
        tint: (rnd() < 0.62) ? 0 : (rnd() < 0.62 ? 1 : 2),
        ph: rnd() * Math.PI * 2,
        tw: 0.28 + rnd() * 0.62,      // twinkle rate, rad/s
        twd: 0.16 + rnd() * 0.26      // twinkle depth
      });
    }

    // ---- dust motes -------------------------------------------------------
    // nearest, fastest layer. 85 in field ≈ 60 on screen at any scroll.
    this.MOTE_PARALLAX = 0.25;
    this.MOTE_MARGIN = 760;
    this.motes = [];
    for (var j = 0; j < 85; j++) {
      var h = rnd();
      this.motes.push({
        nx: rnd(),
        ny: rnd(),
        d: 3 + h * 5,                          // 3–8px out-of-focus disc
        // the sprite's own falloff means only a small core reaches this value;
        // integrated coverage lands in the 4–8% the grade asks for.
        a: 0.16 + rnd() * 0.18,
        bucket: Math.min(3, (h * 4) | 0),
        dx: (rnd() - 0.5) * 5.5,               // slow constant drift, px/s
        dy: -(2 + rnd() * 4.5),
        ph: rnd() * Math.PI * 2,
        br: 0.35 + rnd() * 0.5                 // breathe rate
      });
    }

    // ---- prerendered sprites ---------------------------------------------
    this.starSprites = null;   // built in resize() (depends on dpr)
    this.moteSprites = null;
    this.vignette = null;
    this.grain = null;         // 3 tiles + patterns

    this.resize();
  }

  // small deterministic PRNG (mulberry32)
  static _rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  static _canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }

  // ---------------------------------------------------------------- sprites
  _buildStarSprites() {
    var radii = [0.5, 0.68, 0.88, 1.10, 1.34, 1.60];
    // warm-neutral core per the contract, with two faint chromatic strays
    var tints = [[235, 235, 240], [244, 236, 222], [224, 231, 243]];
    var dpr = this.dpr, out = [];
    for (var ti = 0; ti < tints.length; ti++) {
      var row = [];
      for (var ri = 0; ri < radii.length; ri++) {
        var r = radii[ri];
        var ext = r * 4.2;                       // sprite half-extent, CSS px
        var size = Math.max(4, Math.ceil(ext * 2 * dpr));
        var c = TLLayers._canvas(size, size);
        var x = c.getContext('2d');
        var mid = size / 2;
        var col = tints[ti];
        var g = x.createRadialGradient(mid, mid, 0, mid, mid, mid);
        var core = r / ext;                      // where the solid disc ends
        g.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',1)');
        g.addColorStop(core * 0.75, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.92)');
        g.addColorStop(core, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.42)');
        g.addColorStop(core + (1 - core) * 0.30, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.10)');
        g.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
        x.fillStyle = g;
        x.fillRect(0, 0, size, size);
        row.push({ c: c, ext: ext });
      }
      out.push(row);
    }
    this.starSprites = out;
  }

  _buildMoteSprites() {
    var dias = [3.2, 4.6, 6.2, 8.0];
    var dpr = this.dpr, out = [];
    for (var i = 0; i < dias.length; i++) {
      var d = dias[i];
      var ext = d * 2.0;                         // generous soft falloff
      var size = Math.max(8, Math.ceil(ext * 2 * dpr));
      var c = TLLayers._canvas(size, size);
      var x = c.getContext('2d');
      var mid = size / 2;
      var g = x.createRadialGradient(mid, mid, 0, mid, mid, mid);
      // ember family, out-of-focus: no hard core, all falloff
      g.addColorStop(0.00, 'rgba(246,214,166,0.95)');
      g.addColorStop(0.18, 'rgba(238,196,126,0.78)');
      g.addColorStop(0.38, 'rgba(226,172,98,0.40)');
      g.addColorStop(0.60, 'rgba(206,150,84,0.15)');
      g.addColorStop(0.82, 'rgba(186,134,78,0.04)');
      g.addColorStop(1.00, 'rgba(180,130,76,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, size, size);
      out.push({ c: c, ext: ext });
    }
    this.moteSprites = out;
  }

  _buildVignette() {
    var W = this.w, H = this.h;               // device px
    var c = TLLayers._canvas(W, H);
    var x = c.getContext('2d');
    var cx = W * 0.5, cy = H * 0.42;
    var far = Math.sqrt(Math.max(cx, W - cx) * Math.max(cx, W - cx) +
                        Math.max(cy, H - cy) * Math.max(cy, H - cy));
    var g = x.createRadialGradient(cx, cy, far * 0.30, cx, cy, far * 1.0);
    g.addColorStop(0.00, 'rgba(6,7,10,0)');
    g.addColorStop(0.45, 'rgba(6,7,10,0.05)');
    g.addColorStop(0.72, 'rgba(6,7,10,0.17)');
    g.addColorStop(0.90, 'rgba(6,7,10,0.29)');
    g.addColorStop(1.00, 'rgba(6,7,10,0.35)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    this.vignette = c;
  }

  _buildGrain() {
    if (this.grain) return;                    // dpr-independent, build once
    var size = 192, tiles = [], rnd = TLLayers._rng(0x9e3779b1);
    for (var k = 0; k < 3; k++) {
      var c = TLLayers._canvas(size, size);
      var x = c.getContext('2d');
      var img = x.createImageData(size, size);
      var d = img.data;
      for (var i = 0, n = size * size; i < n; i++) {
        // sum of three uniforms -> gaussian-ish, signed
        var v = (rnd() + rnd() + rnd() - 1.5) / 1.5;
        var av = v < 0 ? -v : v;
        var a = av * av * av;                  // sparse, peaky — film, not TV static
        var o = i << 2;
        if (v > 0) { d[o] = 250; d[o + 1] = 246; d[o + 2] = 238; }
        else       { d[o] = 6;   d[o + 1] = 7;   d[o + 2] = 10;  }
        d[o + 3] = (Math.min(1, a * 3.0) * 255) | 0;
      }
      x.putImageData(img, 0, 0);
      tiles.push(c);
    }
    this.grain = { tiles: tiles, pat: [null, null, null] };
  }

  // ----------------------------------------------------------------- resize
  resize() {
    var cv = this.canvas;
    var dpr = Math.min(2, (window.devicePixelRatio || 1));
    var cw = cv.clientWidth || cv.parentNode && cv.parentNode.clientWidth || window.innerWidth;
    var ch = cv.clientHeight || cv.parentNode && cv.parentNode.clientHeight || window.innerHeight;
    var w = Math.max(1, Math.round(cw * dpr));
    var h = Math.max(1, Math.round(ch * dpr));

    var dprChanged = (dpr !== this.dpr);
    this.dpr = dpr;
    this.cw = cw; this.ch = ch;

    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    this.w = w; this.h = h;

    if (!this.starSprites || dprChanged) this._buildStarSprites();
    if (!this.moteSprites || dprChanged) this._buildMoteSprites();
    this._buildVignette();
    this._buildGrain();
    this.grain.pat = [null, null, null];       // patterns are ctx-bound; rebuild lazily

    this._staticDone = false;                  // reduced-motion: repaint once
  }

  // ------------------------------------------------------------------- draw
  draw(t, scrollY, p, mx, my) {
    if (this.reduced) {
      if (this._staticDone) return;
      this._staticDone = true;
      this._paint(0, 0, 0, 0, 0, true);
      return;
    }
    var T = (t > 600) ? t * 0.001 : t;         // accept seconds or ms
    this._paint(T || 0, scrollY || 0, p || 0, mx || 0, my || 0, false);
  }

  _paint(T, scrollY, p, mx, my, still) {
    var ctx = this.ctx;
    var W = this.cw, H = this.ch;              // CSS px
    var dpr = this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    // clamp defensively — the contract says these arrive lerped and normalised
    if (mx > 1) mx = 1; else if (mx < -1) mx = -1;
    if (my > 1) my = 1; else if (my < -1) my = -1;

    // the hole's screen anchor
    var ax = W * 0.5, ay = H * 0.34;
    var minDim = Math.min(W, H);

    // ---------------------------------------------------------- near stars
    var sFieldH = H + this.STAR_MARGIN;
    var sOff = scrollY * this.STAR_PARALLAX;
    var sdx = mx * 12, sdy = my * 7;
    // glare from the disc washes faint stars out; it widens as we fall in
    var washR = minDim * (0.19 + p * 0.13);
    var washR2 = washR * washR;

    var sp = this.starSprites, st = this.stars;
    for (var i = 0; i < st.length; i++) {
      var s = st[i];
      var y = s.ny * sFieldH - sOff;
      y = y % sFieldH; if (y < 0) y += sFieldH;
      y += sdy;
      if (y < -8 || y > H + 8) continue;
      var x = s.nx * W + sdx;

      var a = s.a;
      if (!still) a *= 1 - s.twd + s.twd * Math.sin(T * s.tw + s.ph);

      var ddx = x - ax, ddy = y - ay;
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 < washR2) {
        var k = Math.sqrt(d2) / washR;
        a *= 0.16 + 0.84 * (k * k * (3 - 2 * k));   // smoothstep back up
      }
      if (a <= 0.012) continue;

      var spr = sp[s.tint][s.bucket];
      var e = spr.ext;
      ctx.globalAlpha = a;
      ctx.drawImage(spr.c, x - e, y - e, e * 2, e * 2);
    }

    // ---------------------------------------------------------- dust motes
    var mFieldH = H + this.MOTE_MARGIN;
    var mFieldW = W + 160;
    var mOff = scrollY * this.MOTE_PARALLAX;
    var mdx = mx * 18, mdy = my * 10;
    var pull = p * p * 26;                     // late in the runway, dust is taken

    var mp = this.moteSprites, mt = this.motes;
    for (var j = 0; j < mt.length; j++) {
      var m = mt[j];
      var my2 = m.ny * mFieldH - mOff + (still ? 0 : m.dy * T);
      my2 = my2 % mFieldH; if (my2 < 0) my2 += mFieldH;
      my2 += mdy;
      if (my2 < -12 || my2 > H + 12) continue;

      var mx2 = m.nx * mFieldW + (still ? 0 : m.dx * T);
      mx2 = mx2 % mFieldW; if (mx2 < 0) mx2 += mFieldW;
      mx2 = mx2 - 80 + mdx;

      if (pull > 0.01) {
        var vx = ax - mx2, vy = ay - my2;
        var len = Math.sqrt(vx * vx + vy * vy) || 1;
        mx2 += (vx / len) * pull;
        my2 += (vy / len) * pull;
      }

      // dust is only visible where the disc lights it — this, more than the
      // parallax rate, is what makes the layer read as *near*
      var lx = mx2 - ax, ly = my2 - ay;
      var ld = Math.sqrt(lx * lx + ly * ly) / (minDim * 0.62);
      var ma = m.a * (0.10 + 0.90 * Math.exp(-ld * ld));
      if (!still) ma *= 0.72 + 0.28 * Math.sin(T * m.br + m.ph);
      if (ma <= 0.004) continue;

      var ms = mp[m.bucket];
      var me = ms.ext;
      ctx.globalAlpha = ma;
      ctx.drawImage(ms.c, mx2 - me, my2 - me, me * 2, me * 2);
    }

    ctx.globalAlpha = 1;

    // ------------------------------------------------------------ vignette
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);

    // --------------------------------------------------------------- grain
    // 1:1 with device pixels, held for ~1/22s so it reads as film, not buzz
    var gi = still ? 0 : (Math.floor(T * 22) % 3 + 3) % 3;
    var g = this.grain;
    if (!g.pat[gi]) g.pat[gi] = ctx.createPattern(g.tiles[gi], 'repeat');
    if (g.pat[gi]) {
      if (this._softLight) ctx.globalCompositeOperation = 'soft-light';
      // one grain = one device pixel, so at dpr 1 each grain covers 4x the
      // screen area — pull the alpha back so the grade matches across displays
      ctx.globalAlpha = (dpr >= 2) ? 0.155 : 0.105;
      ctx.fillStyle = g.pat[gi];
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
}
