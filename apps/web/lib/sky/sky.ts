/**
 * The entrance's sky, driven the way the public site drives it.
 *
 * §115 draws the line this file sits on: the entrance carries depth, the
 * instrument does not. So the black hole is mounted on the gate and on the
 * first-project screen, and nowhere past them.
 *
 * The two modules beside this one are the site's own, copied byte for byte.
 * What is written here is only the driver — the part `frontend/main.template.
 * html` does inline — and it is deliberately a smaller driver than the site's:
 * the entrance has no runway, so `scrollY` and the camera progress `p` are
 * pinned at 0 and the composition is the site's scroll-0 frame. Everything the
 * runway drove (beats, the flare, the disk surge, the mark reveal) is gone
 * rather than left at a resting value, because none of it has anything to
 * respond to here.
 */

import { TL_FRAG, TL_VERT } from "./shader.js";
import { TLLayers } from "./layers.js";

export type SkyVariant = "gate" | "first";

export type SkyOptions = {
  /**
   * What to show when there is no WebGL2. A real photograph of the shader at
   * rest, so the entrance still says what the product is on a machine that
   * cannot run it.
   */
  still?: string;
  /**
   * Overridable so a test can take either branch. Left unset it asks the
   * browser, which is what every caller does.
   */
  reduced?: boolean;
};

export type SkyStats = {
  /** GL draws measured since the last report. */
  frames: number;
  /** Mean wall time of one `renderGL`, in ms. */
  meanMs: number;
};

export type SkyHandle = {
  destroy(): void;
  stats(): SkyStats;
  /** False once the still is showing — no context, or a lost one. */
  readonly drawing: boolean;
};

/** #e8b76a, the site's ember tint, as the shader wants it. */
const TINT: readonly [number, number, number] = [0xe8 / 255, 0xb7 / 255, 0x6a / 255];

/**
 * The shader is ray-marched per pixel, so pixels are the frame budget. The site
 * renders at 0.66x on a wide window; the entrance asks for less because it is
 * behind a form somebody is typing into.
 */
const RENDER_SCALE = 0.6;
const MAX_DPR = 2;

/**
 * Pointer drift is capped at 12 px of movement, and `TLLayers` multiplies the
 * normalised value by 18 for its fastest layer — so the normalised value never
 * reaches 1. Without this the dust would swim under the cursor, which reads as
 * the page reacting to you rather than the sky being deep.
 */
const DRIFT = 12 / 18;
/** Per frame at 60fps, corrected below for the frame that actually happened. */
const LERP = 0.08;

/**
 * How often the measured frame cost is published for a harness to read. Three
 * windows, widening: this shader can take most of a second per frame on a
 * machine without a GPU, so a single window of 120 leaves the attribute absent
 * for two minutes and a harness that screenshots after three seconds reads
 * nothing at all. So the first draw publishes immediately — a cold draw, which
 * carries the driver's first pipeline validation and is the slowest of the run
 * — the next twenty replace it with something warm, and only then does the
 * window settle at a mean worth quoting.
 */
const STATS_FIRST = 1;
const STATS_WARM = 20;
const STATS_EVERY = 120;

type GLBundle = {
  gl: WebGL2RenderingContext;
  uRes: WebGLUniformLocation | null;
  uT: WebGLUniformLocation | null;
  uTint: WebGLUniformLocation | null;
  uBoost: WebGLUniformLocation | null;
  uFlare: WebGLUniformLocation | null;
  uCam: WebGLUniformLocation | null;
  uStarOff: WebGLUniformLocation | null;
};

/** The site's `initGL`, with its failures returning null rather than throwing. */
function initGL(canvas: HTMLCanvasElement): GLBundle | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, TL_VERT);
  const fs = compile(gl.FRAGMENT_SHADER, TL_FRAG);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // The fullscreen triangle the shader's own notes ask for.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attrib = gl.getAttribLocation(program, "aP");
  gl.enableVertexAttribArray(attrib);
  gl.vertexAttribPointer(attrib, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(program, name);
  return {
    gl,
    uRes: u("uRes"), uT: u("uT"), uTint: u("uTint"), uBoost: u("uBoost"),
    uFlare: u("uFlare"), uCam: u("uCam"), uStarOff: u("uStarOff"),
  };
}

export function createSky(container: HTMLElement, options: SkyOptions = {}): SkyHandle {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const still = options.still ?? "/sky-still.jpg";

  const stage = doc.createElement("div");
  stage.className = "sky-stage";

  // Both canvases are decoration. The sentence under the hole is the content,
  // and it is real text in the markup.
  const glCanvas = doc.createElement("canvas");
  glCanvas.className = "tl-gl";
  glCanvas.setAttribute("aria-hidden", "true");
  const fxCanvas = doc.createElement("canvas");
  fxCanvas.className = "tl-fx";
  fxCanvas.setAttribute("aria-hidden", "true");
  stage.append(glCanvas, fxCanvas);
  container.append(stage);

  let bundle = initGL(glCanvas);

  /**
   * `TLLayers` asks for a 2D context in its constructor and uses it
   * immediately, so a context that is refused would throw out of the mount.
   * A browser that will not give one is rare; a test DOM that will not is
   * ordinary, and neither should take the entrance down.
   */
  let layers: InstanceType<typeof TLLayers> | null = null;
  if (fxCanvas.getContext("2d")) {
    layers = new TLLayers(fxCanvas);
    /*
     * Sizing is `TLLayers`' own: it backs the canvas at min(devicePixelRatio,
     * 2) and builds its star and mote sprites at that scale, so a backing store
     * chosen from out here would be drawn into with the wrong transform and
     * the wrong sprites. The near layers therefore cost up to 2x device pixels
     * — more than the GL canvas, which is capped at 0.6x2 — and that is the
     * price of running the site's code rather than a copy of it.
     */
    layers.resize();
  }

  /** The still stands in for the hole; the near layers keep drawing on top. */
  function showStill() {
    stage.dataset.skyGl = "still";
    stage.style.backgroundImage = `url("${still}")`;
    glCanvas.style.display = "none";
  }
  if (bundle) stage.dataset.skyGl = "on";
  else showStill();

  const reduced = options.reduced ?? (typeof win.matchMedia === "function"
    ? win.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false);

  let clock = 0;
  let last = 0;
  // Where the pointer is asking the sky to lean, and where it has got to.
  let targetX = 0, targetY = 0, driftX = 0, driftY = 0;
  let rect = { left: 0, top: 0, width: 0, height: 0 };
  let frames = 0, totalMs = 0, reportedFrames = 0, reportedMs = 0;

  function measure() {
    const box = stage.getBoundingClientRect();
    rect = { left: box.left, top: box.top, width: box.width, height: box.height };
  }

  function sizeGL() {
    if (!bundle) return;
    const dpr = Math.min(win.devicePixelRatio || 1, MAX_DPR);
    const scale = RENDER_SCALE * dpr;
    const w = Math.max(2, Math.round(glCanvas.clientWidth * scale));
    const h = Math.max(2, Math.round(glCanvas.clientHeight * scale));
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
      bundle.gl.viewport(0, 0, w, h);
    }
  }

  /**
   * One GL frame. `cam` is 0 and stays 0: the entrance is the site's scroll-0
   * composition, and `uCam` is the only thing that moves the camera.
   */
  function renderGL(t: number, starOffX: number, starOffY: number) {
    if (!bundle) return;
    const t0 = win.performance ? win.performance.now() : Date.now();
    sizeGL();
    const { gl } = bundle;
    gl.uniform2f(bundle.uRes, glCanvas.width, glCanvas.height);
    gl.uniform1f(bundle.uT, t);
    gl.uniform3f(bundle.uTint, TINT[0], TINT[1], TINT[2]);
    gl.uniform1f(bundle.uBoost, 0);
    gl.uniform1f(bundle.uFlare, 0);
    gl.uniform1f(bundle.uCam, 0);
    gl.uniform2f(bundle.uStarOff, starOffX, starOffY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const t1 = win.performance ? win.performance.now() : Date.now();

    frames += 1;
    totalMs += t1 - t0;
    // The window that has to fill before the next report, from the width of
    // the one just published.
    const window = !reportedFrames ? STATS_FIRST
      : reportedFrames < STATS_WARM ? STATS_WARM
      : STATS_EVERY;
    if (frames >= window) {
      reportedFrames = frames;
      reportedMs = totalMs / frames;
      // Published rather than logged: the frame budget of the entrance is a
      // number somebody checks from a screenshot harness, and a console line
      // cannot be read from one.
      stage.dataset.skyFrameMs = reportedMs.toFixed(2);
      frames = 0;
      totalMs = 0;
    }
  }

  /** The whole composition at rest: `t = 0`, camera at the start of its path. */
  function renderOnce() {
    renderGL(0, 0, 0);
    if (layers) layers.draw(0, 0, 0, 0, 0);
  }

  let raf = 0;
  let running = false;
  let onScreen = true;
  let visible = !doc.hidden;

  function frame() {
    // A frame that outlived `stop()` must not re-arm the loop. Cancelling is
    // supposed to make that impossible, and a resurrected ray marcher behind a
    // signed-in workspace would look like nothing at all from the page.
    if (!running) return;
    const now = win.performance ? win.performance.now() : Date.now();
    // Clamped for the same reason the site clamps it: a tab that comes back
    // from the background hands you one enormous delta.
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    clock += dt;

    // A fixed fraction per frame is a different curve at every frame rate.
    const k = 1 - Math.pow(1 - LERP, dt * 60);
    driftX += (targetX - driftX) * k;
    driftY += (targetY - driftY) * k;

    // `uStarOff` takes page pixels; the site passes the pointer through at 8
    // and 4, and the scroll term is 0 here because there is no scroll.
    renderGL(clock, driftX * 8, driftY * 4);
    // Seconds, straight through. `TLLayers.draw` used to read the unit off the
    // magnitude, and this handed it milliseconds past 0.6s to stay on the right
    // side of that guess; the guess is gone (D215), so the compensation goes
    // with it. Two halves of one workaround, and leaving either behind would be
    // worse than having neither.
    if (layers) layers.draw(clock, 0, 0, driftX, driftY);

    raf = win.requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    last = 0;
    raf = win.requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
  }

  /** Off screen or in a hidden tab, a ray marcher is pure heat. */
  function sync() {
    if (visible && onScreen) start();
    else stop();
  }

  function onPointer(event: PointerEvent) {
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    targetX = Math.max(-1, Math.min(1, x)) * DRIFT;
    targetY = Math.max(-1, Math.min(1, y)) * DRIFT;
  }

  function onVisibility() {
    visible = !doc.hidden;
    sync();
  }

  function onResize() {
    measure();
    if (layers) layers.resize();
    if (reduced) renderOnce();
  }

  /**
   * Scrolling moves the stage without resizing it, and the pointer offset is
   * measured against where the stage is. Only the rectangle is re-read here —
   * `onResize` rebuilds every sprite, which is not what a scroll should cost.
   */
  function onScroll() { measure(); }

  /**
   * A lost context is the same situation as never having had one, and it
   * happens on machines that suspend the GPU. Preventing the default is what
   * would allow a restore; the still is what the reader sees meanwhile.
   */
  function onContextLost(event: Event) {
    event.preventDefault();
    bundle = null;
    showStill();
  }
  glCanvas.addEventListener("webglcontextlost", onContextLost, { passive: false });

  const observers: { disconnect(): void }[] = [];
  const ResizeObs = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (typeof ResizeObs === "function") {
    const ro = new ResizeObs(onResize);
    ro.observe(stage);
    observers.push(ro);
  } else {
    win.addEventListener("resize", onResize, { passive: true });
  }

  measure();

  if (reduced) {
    // Exactly one frame, and nothing that could schedule another.
    renderOnce();
  } else if (bundle || layers) {
    win.addEventListener("pointermove", onPointer, { passive: true });
    win.addEventListener("scroll", onScroll, { passive: true });
    doc.addEventListener("visibilitychange", onVisibility, { passive: true });

    const IntersectionObs = (win as unknown as {
      IntersectionObserver?: typeof IntersectionObserver;
    }).IntersectionObserver;
    if (typeof IntersectionObs === "function") {
      const io = new IntersectionObs((entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        sync();
      });
      io.observe(stage);
      observers.push(io);
    }
    sync();
  }

  return {
    get drawing() { return bundle !== null; },
    stats() {
      return frames
        ? { frames, meanMs: totalMs / frames }
        : { frames: reportedFrames, meanMs: reportedMs };
    },
    destroy() {
      stop();
      win.removeEventListener("pointermove", onPointer);
      win.removeEventListener("scroll", onScroll);
      win.removeEventListener("resize", onResize);
      doc.removeEventListener("visibilitychange", onVisibility);
      glCanvas.removeEventListener("webglcontextlost", onContextLost);
      for (const observer of observers) observer.disconnect();
      observers.length = 0;
      // Free the GPU memory rather than waiting for the canvas to be collected:
      // the gate is mounted and unmounted on every sign-in.
      if (bundle) {
        const lose = bundle.gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
      bundle = null;
      stage.remove();
    },
  };
}
