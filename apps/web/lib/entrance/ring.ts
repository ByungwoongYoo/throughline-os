/**
 * The entrance ring: the scroll-driven scene behind the local homepage.
 *
 * Why this is not `lib/sky`. The gate wears the site's black hole, copied byte
 * for byte, and `tests/sky-is-the-sites-own-code.test.ts` holds it there. The
 * homepage needs the same object seen from somewhere else entirely: the four
 * approved frames all look ALONG the disk with the hole off-frame, and none of
 * them shows a photon ring. Bending the site's shader to that would mean
 * editing `frontend/mods/shader.js`, which is the public page's own module and
 * another session's task. So this is a second renderer of the same object,
 * sharing its tint, its Doppler treatment and its grade, and importing the
 * site's `TLLayers` unchanged for motes and grain.
 *
 * Why it draws geometry instead of marching rays. The site's shader integrates
 * ninety bending steps to put the hole's shadow and photon ring on screen. With
 * the hole out of frame that integral renders nothing anybody can see, and the
 * filaments it does render are sampled per-pixel along jittered rays, which
 * granulates exactly where the reference is cleanest — the fine trails on the
 * far side. Here each strand is real instanced ribbon geometry, widened in
 * screen space and blended additively, so the rasteriser anti-aliases it: a
 * distant strand is a clean hairline rather than sub-pixel noise. Measured in
 * the headless rig it also draws several times faster than the march, and that
 * headroom is what pays for rendering above the reference's own resolution.
 *
 * One rAF, one progress owner. `setProgress` is the only way the camera moves;
 * the page's scroll controller owns that number and nothing here reads scroll.
 */

import { TLLayers } from "../sky/layers.js";

export type RingOptions = {
  /** Shown when there is no WebGL2, or when the context is lost. */
  still?: string;
  /** Overridable so a test can take either branch; unset asks the browser. */
  reduced?: boolean;
};

export type RingStats = {
  frames: number;
  meanMs: number;
  strands: number;
};

export type RingHandle = {
  /** The page's scroll controller calls this and nothing else. 0..1. */
  setProgress(p: number): void;
  /** Ambient flow and pointer drift, without touching the camera. */
  setPaused(paused: boolean): void;
  destroy(): void;
  stats(): RingStats;
  readonly drawing: boolean;
};

/** #e8b76a, the site's ember tint. Shared deliberately. */
const TINT: readonly [number, number, number] = [0xe8 / 255, 0xb7 / 255, 0x6a / 255];

const MAX_DPR = 2;
/** Ribbons are cheap, so the ring renders at full device resolution. */
const RENDER_SCALE = 1;

const STRANDS = 2600;
const SEGMENTS = 384;

/*
 * A NARROW lit annulus, not a full disk.
 *
 * This is the number that decides whether the page works. A wide ring fills the
 * frame at any camera distance and the chapters end up set over their own
 * artwork; a narrow one reads as a band with real void either side, which is
 * what every reference frame shows and what the text needs. Pulling the camera
 * back does not substitute: it shrinks the ring into a planet's rings instead
 * of a river running off both edges.
 */
const R_IN = 11;
const R_OUT = 14;
/** Half-thickness per unit radius. Real disks flare; a flat sheet reads as paper. */
const FLARE = 0.05;

/**
 * A camera keyframe, written in the ring's own terms rather than world
 * coordinates, so moving one chapter does not require re-deriving the others.
 * The camera sits on a circle of radius `radius` at azimuth `az`, and looks at
 * a point reached by travelling `ahead` along the ring's tangent, `inward`
 * toward the axis and `down` below the plane.
 */
export type Key = {
  az: number;
  radius: number;
  height: number;
  ahead: number;
  inward: number;
  down: number;
  roll: number;
  focal: number;
};

/**
 * The four approved compositions, 1A to 1D. Azimuth advances throughout, so
 * scrolling travels along the ring rather than cutting between viewpoints —
 * which is the whole of "Along the ring".
 */
export const KEYS: readonly Key[] = [
  // A · the band enters low-left and arcs away to the upper right, leaving the
  //     whole upper-left void for the title and the right flank quiet for the
  //     three editorial words.
  { az: 0.0, radius: 16.0, height: 1.5, ahead: 15, inward: 10, down: 1.75, roll: -0.3, focal: 1.7 },
  // B · flattened and dropped, so the heading sits on black above it and the
  //     working question reads under the bend.
  { az: 0.58, radius: 21.0, height: 1.1, ahead: 15, inward: 13, down: 0.55, roll: 0.05, focal: 1.55 },
  // C · wrapped around the right boundary, clearing the broad left interior
  //     the three method stations need.
  { az: 1.2, radius: 19.0, height: 2.2, ahead: 14, inward: 11, down: 2.2, roll: -0.44, focal: 1.62 },
  // D · looks BACK along the ring, which throws the band onto the far left
  //     and lower perimeter and leaves the right of the frame for the marks.
  { az: 1.86, radius: 22.0, height: 1.4, ahead: -16, inward: 15, down: 1.15, roll: -0.1, focal: 1.45 },
];

/*
 * The precise form. `a + (b - a) * t` does not return `b` exactly at t = 1 in
 * floating point, which left the camera a hair off the approved keyframe at
 * the end of the runway — invisible on screen, but it means the composition a
 * screenshot compares against is not quite the one the reference approved.
 */
const lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Camera for a global progress `p`. The three spans between the four keys are
 * equal, and each is eased, so the viewpoint arrives at a chapter at rest
 * rather than still drifting under the text.
 */
export function keyAt(p: number): Key {
  const t = clamp01(p) * (KEYS.length - 1);
  const i = Math.min(Math.floor(t), KEYS.length - 2);
  const f = ease(t - i);
  const a = KEYS[i];
  const b = KEYS[i + 1];
  return {
    az: lerp(a.az, b.az, f),
    radius: lerp(a.radius, b.radius, f),
    height: lerp(a.height, b.height, f),
    ahead: lerp(a.ahead, b.ahead, f),
    inward: lerp(a.inward, b.inward, f),
    down: lerp(a.down, b.down, f),
    roll: lerp(a.roll, b.roll, f),
    focal: lerp(a.focal, b.focal, f),
  };
}

const VERT = `#version 300 es
precision highp float;

uniform mat4  uViewProj;
uniform vec3  uRo;
uniform vec2  uRes;
uniform float uT;
uniform float uWidth;

in vec4 aStrand;   // radius, height, brightness, phase
in vec2 aTone;     // hue mix, width multiplier

out float vAcross;
out float vBright;
out float vHue;
out float vFade;

vec3 orbit(float r, float y, float a){ return vec3(r * cos(a), y, r * sin(a)); }

void main(){
  int seg = gl_VertexID >> 1;
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;

  float r = aStrand.x, y = aStrand.y;
  float segs = float(SEGMENTS);
  float step = 6.28318530718 / segs;
  float a0 = float(seg) * step;

  // Keplerian shear: inner strands lap the outer ones, so the river flows
  // instead of rotating rigidly.
  float spin = uT * 8.1 / (r * sqrt(r)) + aStrand.w;

  vec3 p0 = orbit(r, y, a0 + spin);
  vec3 pPrev = orbit(r, y, a0 - step + spin);
  vec3 pNext = orbit(r, y, a0 + step + spin);

  vec4 c0 = uViewProj * vec4(p0, 1.0);
  vec4 cP = uViewProj * vec4(pPrev, 1.0);
  vec4 cN = uViewProj * vec4(pNext, 1.0);

  vec2 s0 = c0.xy / max(c0.w, 1e-4) * uRes * 0.5;
  vec2 sP = cP.xy / max(cP.w, 1e-4) * uRes * 0.5;
  vec2 sN = cN.xy / max(cN.w, 1e-4) * uRes * 0.5;

  // Central difference. A forward difference collapses where a strand runs
  // along the view ray, and the ribbon normal spins there and beads the trail.
  vec2 dir = sN - sP;
  float len = length(dir);
  vec2 nrm = len > 1e-4 ? vec2(-dir.y, dir.x) / len : vec2(1.0, 0.0);

  vec2 sp = s0 + nrm * side * (0.5 * uWidth * aTone.y);

  float w = max(c0.w, 1e-4);
  gl_Position = vec4(sp / (uRes * 0.5) * w, c0.z, w);
  // A strand crossing behind the camera would otherwise wrap across the frame.
  if (c0.w <= 0.02) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);

  vAcross = side;
  vBright = aStrand.z;
  vHue = aTone.x;

  vec3 tang = normalize(vec3(-sin(a0 + spin), 0.0, cos(a0 + spin)));
  vFade = dot(tang, normalize(uRo - p0));
}`;

const FRAG = `#version 300 es
precision highp float;

uniform vec3  uTint;
uniform float uExpo;

in float vAcross;
in float vBright;
in float vHue;
in float vFade;

out vec4 oC;

void main(){
  // Gaussian across the ribbon: a filament with a soft edge, not a bar.
  float a = exp(-vAcross * vAcross * 3.4);

  // Doppler, the site's treatment: the limb travelling toward the camera
  // brightens and cools, the receding one warms and dims.
  float db = max(1.0 + 0.42 * vFade, 0.32);
  float dop = db * db * sqrt(sqrt(db));

  float em = a * vBright * dop * uExpo;
  vec3 warm = uTint * vec3(0.86, 0.68, 0.42);
  vec3 hot = vec3(1.0, 0.975, 0.93);
  vec3 col = mix(warm, hot, clamp(vHue * 0.42 + em * 0.58, 0.0, 1.0));
  col *= mix(vec3(1.06, 0.985, 0.90), vec3(0.93, 0.975, 1.10), smoothstep(-0.2, 0.95, vFade));

  oC = vec4(col * em, 1.0);
}`;

/**
 * The strand table. Deterministic by construction: the same seed builds the
 * same ring on every load, which is the only thing that makes a screenshot
 * comparison mean anything.
 */
function buildStrands(): { strand: Float32Array; tone: Float32Array } {
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  const strand = new Float32Array(STRANDS * 4);
  const tone = new Float32Array(STRANDS * 2);
  for (let i = 0; i < STRANDS; i++) {
    // Orbital density runs higher toward the inner edge; a uniform draw reads
    // as a printed gradient rather than as material.
    const r = R_IN + (R_OUT - R_IN) * Math.pow(rnd(), 1.6);
    // Three uniforms sum toward a normal, so strands crowd the midplane and
    // thin out at the surfaces.
    const g = (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const y = g * FLARE * r;
    const bright = 0.1 + 0.9 * Math.pow(rnd(), 2.3);
    strand.set([r, y, bright, rnd() * 6.283185], i * 4);
    tone.set([Math.pow(rnd(), 1.8), 0.55 + 1.5 * Math.pow(rnd(), 2.6)], i * 2);
  }
  return { strand, tone };
}

type GLBundle = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  buffers: WebGLBuffer[];
  vao: WebGLVertexArrayObject;
  uViewProj: WebGLUniformLocation | null;
  uRo: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
  uT: WebGLUniformLocation | null;
  uWidth: WebGLUniformLocation | null;
  uTint: WebGLUniformLocation | null;
  uExpo: WebGLUniformLocation | null;
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source.replace(/SEGMENTS/g, String(SEGMENTS)));
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function initGL(canvas: HTMLCanvasElement): GLBundle | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    depth: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !program) return null;

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);

  const vao = gl.createVertexArray();
  if (!vao) return null;
  gl.bindVertexArray(vao);

  const { strand, tone } = buildStrands();
  const buffers: WebGLBuffer[] = [];
  const bind = (name: string, data: Float32Array, size: number) => {
    const buffer = gl.createBuffer();
    if (!buffer) return;
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(loc, 1);
  };
  bind("aStrand", strand, 4);
  bind("aTone", tone, 2);

  const u = (name: string) => gl.getUniformLocation(program, name);
  return {
    gl,
    program,
    buffers,
    vao,
    uViewProj: u("uViewProj"),
    uRo: u("uRo"),
    uRes: u("uRes"),
    uT: u("uT"),
    uWidth: u("uWidth"),
    uTint: u("uTint"),
    uExpo: u("uExpo"),
  };
}

/** View-projection for a keyframe, written straight into a column-major 4x4. */
function viewProj(key: Key, aspect: number, out: Float32Array): [number, number, number] {
  const { az, radius, height, ahead, inward, down, roll, focal } = key;
  const sa = Math.sin(az);
  const ca = Math.cos(az);

  const ro: [number, number, number] = [radius * sa, height, radius * ca];
  // Tangent runs the way the ring flows; inward points at the axis.
  const tx = ca;
  const tz = -sa;
  const ix = -sa;
  const iz = -ca;
  const target: [number, number, number] = [
    ro[0] + tx * ahead + ix * inward,
    ro[1] - down,
    ro[2] + tz * ahead + iz * inward,
  ];

  let fx = target[0] - ro[0];
  let fy = target[1] - ro[1];
  let fz = target[2] - ro[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;

  // right = normalize(cross(worldUp, forward)) with worldUp = (0, 1, 0)
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;

  // up = cross(forward, right)
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;

  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const r2x = rx * cr + ux * sr;
  const r2y = ry * cr + uy * sr;
  const r2z = rz * cr + uz * sr;
  const u2x = ux * cr - rx * sr;
  const u2y = uy * cr - ry * sr;
  const u2z = uz * cr - rz * sr;

  const near = 0.05;
  const far = 400;
  const px = focal / aspect;
  const py = focal;
  const pz = (far + near) / (near - far);
  const pw = (2 * far * near) / (near - far);

  const tX = -(r2x * ro[0] + r2y * ro[1] + r2z * ro[2]);
  const tY = -(u2x * ro[0] + u2y * ro[1] + u2z * ro[2]);
  const tZ = fx * ro[0] + fy * ro[1] + fz * ro[2];

  // proj * view, folded so no temporary matrix is allocated per frame.
  out[0] = px * r2x;
  out[1] = py * u2x;
  out[2] = pz * -fx;
  out[3] = -(-fx);
  out[4] = px * r2y;
  out[5] = py * u2y;
  out[6] = pz * -fy;
  out[7] = -(-fy);
  out[8] = px * r2z;
  out[9] = py * u2z;
  out[10] = pz * -fz;
  out[11] = -(-fz);
  out[12] = px * tX;
  out[13] = py * tY;
  out[14] = pz * tZ + pw;
  out[15] = -tZ;

  return ro;
}

export function createRing(container: HTMLElement, options: RingOptions = {}): RingHandle {
  const reduced =
    options.reduced ??
    (typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);

  const glCanvas = document.createElement("canvas");
  const layerCanvas = document.createElement("canvas");
  for (const canvas of [glCanvas, layerCanvas]) {
    canvas.className = "ring-canvas";
    container.append(canvas);
  }

  const bundle = initGL(glCanvas);
  const layers = bundle ? new TLLayers(layerCanvas) : null;
  const matrix = new Float32Array(16);

  let progress = 0;
  let paused = reduced;
  let running = false;
  let raf = 0;
  let frames = 0;
  let totalMs = 0;
  let drawing = bundle !== null;
  let startedAt = 0;
  let pointerX = 0;
  let pointerY = 0;
  let driftX = 0;
  let driftY = 0;
  let width = 0;
  let height = 0;

  function showStill() {
    drawing = false;
    glCanvas.remove();
    layerCanvas.remove();
    if (options.still) {
      container.style.backgroundImage = `url(${options.still})`;
      container.style.backgroundSize = "cover";
      container.style.backgroundPosition = "center";
    }
  }

  if (!bundle) showStill();

  function size() {
    if (!bundle) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * RENDER_SCALE;
    width = container.clientWidth;
    height = container.clientHeight;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
      bundle.gl.viewport(0, 0, w, h);
      bundle.gl.uniform2f(bundle.uRes, w, h);
      // A ribbon is sized in device pixels, so its CSS width holds across DPRs.
      bundle.gl.uniform1f(bundle.uWidth, 1.0 * dpr);
    }
    layers?.resize();
  }

  function render(seconds: number) {
    if (!bundle) return;
    const { gl } = bundle;
    const t0 = performance.now();

    const key = keyAt(progress);
    const ro = viewProj(key, glCanvas.width / glCanvas.height, matrix);

    gl.useProgram(bundle.program);
    gl.bindVertexArray(bundle.vao);
    gl.uniformMatrix4fv(bundle.uViewProj, false, matrix);
    gl.uniform3f(bundle.uRo, ro[0], ro[1], ro[2]);
    gl.uniform1f(bundle.uT, seconds);
    gl.uniform3f(bundle.uTint, TINT[0], TINT[1], TINT[2]);
    gl.uniform1f(bundle.uExpo, 0.5);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Additive, so the draw order never matters. Light does not occlude light.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0.024, 0.027, 0.039, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEGMENTS + 1) * 2, STRANDS);

    totalMs += performance.now() - t0;
    frames++;
  }

  function drawLayers(seconds: number) {
    layers?.draw(seconds, 0, progress, driftX, driftY);
  }

  function renderOnce() {
    size();
    // A held frame still needs a clock, or the ring sits at its t=0 phase where
    // every strand shares an angle and the seam shows.
    render(12);
    drawLayers(12);
  }

  function frame(now: number) {
    if (!running) return;
    if (!startedAt) startedAt = now;
    const seconds = (now - startedAt) / 1000 + 12;
    driftX += (pointerX - driftX) * 0.06;
    driftY += (pointerY - driftY) * 0.06;
    size();
    render(seconds);
    drawLayers(seconds);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || !bundle || paused) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onPointer(event: PointerEvent) {
    if (paused) return;
    // Small and lerped. Pointer drift is depth, not a control.
    pointerX = (event.clientX / window.innerWidth - 0.5) * 26;
    pointerY = (event.clientY / window.innerHeight - 0.5) * 16;
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  function onResize() {
    if (!running) renderOnce();
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    stop();
    showStill();
  }

  glCanvas.addEventListener("webglcontextlost", onContextLost);
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) start();
            else stop();
          }
        })
      : null;
  observer?.observe(container);

  if (bundle) renderOnce();
  if (!paused) start();

  return {
    setProgress(p: number) {
      const next = clamp01(p);
      /*
       * A no-op update must cost nothing.
       *
       * The page's controller pushes progress on every animation frame whether
       * or not the reader moved, so redrawing on each call made "Pause
       * background motion" a lie: the ambient loop stopped and the scene was
       * still re-rendered sixty times a second at the same camera. It cost a
       * headless capture its timeout before it cost anybody a frame rate, which
       * is the only reason it was noticed.
       */
      if (next === progress) return;
      progress = next;
      // With motion off the camera still has to arrive at the chapter being
      // read; what stops is the ambient loop, not the page.
      if (!running) renderOnce();
    },
    setPaused(next: boolean) {
      paused = next;
      if (next) {
        stop();
        renderOnce();
      } else {
        startedAt = 0;
        start();
      }
    },
    destroy() {
      stop();
      observer?.disconnect();
      glCanvas.removeEventListener("webglcontextlost", onContextLost);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      if (bundle) {
        const { gl } = bundle;
        for (const buffer of bundle.buffers) gl.deleteBuffer(buffer);
        gl.deleteVertexArray(bundle.vao);
        gl.deleteProgram(bundle.program);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      glCanvas.remove();
      layerCanvas.remove();
    },
    stats() {
      return {
        frames,
        meanMs: frames ? totalMs / frames : 0,
        strands: STRANDS,
      };
    },
    get drawing() {
      return drawing;
    },
  };
}
