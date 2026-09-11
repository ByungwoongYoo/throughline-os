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
 * site's tint and Doppler treatment.
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

/*
 * Few and wide, not many and thin.
 *
 * The first version drew 2,600 hairlines and the result read as wire rather
 * than light: at that density neighbouring strands land within a pixel of each
 * other and interfere, which is visible as a crosshatch moire the reference
 * does not have anywhere. The reference's band is perhaps eighty ribbons with
 * soft shoulders. Fewer strands, much wider, and a bloom pass to carry the glow
 * is what makes it photographic instead of drawn.
 */
const STRANDS = 1150;
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
/*
 * Tuned by looking, against the reference crops, not chosen.
 *
 * Exposure is low and the bloom carries the brightness. The other way round —
 * a hot scene with a little bloom — is what produced the blown white core with
 * a hard edge that the reference does not have.
 */
/** Raised to pay for the flow term, whose mean is below one. */
const EXPOSURE = 0.46;
/** Radial breathing amplitude. 0 gives concentric hoops; this gives a braid. */
const WEAVE = 0.6;
const BLOOM = 0.6;
const BLOOM_THRESHOLD = 0.5;
/** Ribbon width in CSS pixels before defocus widens it. */
const RIBBON_PX = 3.0;

const R_IN = 7.5;
const R_OUT = 16.5;
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
  { az: 0.0, radius: 15.5, height: 1.2, ahead: 15, inward: 8.5, down: 1.15, roll: -0.36, focal: 1.28 },
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
in vec4 aWeave;    // radial amplitude, radial frequency, weave phase, flow phase

out float vAcross;
out float vBright;
out float vHue;
out float vFade;
out float vSpread;
out float vFlow;

/*
 * Not a circle, and that is the whole difference between a river and a hoop.
 *
 * A strand at a FIXED radius is a hoop; a field of them is concentric hoops
 * however finely each is drawn, and rotating them rigidly makes the ring look
 * like something being spun rather than something flowing. Letting each
 * strand's radius breathe as it goes round — at its own low frequency and its
 * own phase — makes strands CROSS. They converge, diverge and braid, which is
 * what the reference does everywhere, and it is what the eye reads as flow.
 *
 * Low frequencies only: one to three swells per revolution. Higher and the
 * strands wobble instead of braiding, which looks like interference rather
 * than motion.
 */
vec3 orbit(float r, float y, float a, vec4 w){
  float rr = r + w.x * sin(a * w.y + w.z);
  float yy = y + w.x * 0.22 * cos(a * w.y * 0.7 + w.z * 1.7);
  return vec3(rr * cos(a), yy, rr * sin(a));
}

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

  vec3 p0 = orbit(r, y, a0 + spin, aWeave);
  vec3 pPrev = orbit(r, y, a0 - step + spin, aWeave);
  vec3 pNext = orbit(r, y, a0 + step + spin, aWeave);

  /*
   * Brightness travelling ALONG the strand.
   *
   * A strand of even brightness cannot show motion. The whole ring can turn and
   * still look static, because every stretch of it looks like every other
   * stretch — which is the second half of why this read as a hoop being spun.
   * The reference's strands are bright along one stretch and dark along the
   * next, and those patches travel. That is the flow you actually see.
   */
  vFlow = 0.45 + 0.55 * sin(a0 * 2.7 + aWeave.w - uT * 12.5 / r);

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

  /*
   * Defocus with distance, which is what a lens does and what stops a far
   * ribbon from aliasing. A strand whose width would fall below a pixel is
   * widened and dimmed rather than point-sampled, so the far side of the ring
   * becomes a soft wash instead of a crosshatch.
   */
  float spread = 1.0 + smoothstep(6.0, 34.0, max(c0.w, 0.001)) * 5.0;
  vec2 sp = s0 + nrm * side * (0.5 * uWidth * aTone.y * spread);

  float w = max(c0.w, 1e-4);
  gl_Position = vec4(sp / (uRes * 0.5) * w, c0.z, w);
  // A strand crossing behind the camera would otherwise wrap across the frame.
  if (c0.w <= 0.02) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);

  vAcross = side;
  vBright = aStrand.z;
  vHue = aTone.x;
  vSpread = spread;


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
in float vSpread;
in float vFlow;

out vec4 oC;

void main(){
  // A gentle shoulder. The reference's ribbons fade out across their width;
  // a tight core with black beside it is what made the first version read as
  // drawn rather than photographed.
  float a = exp(-vAcross * vAcross * 2.4);

  // Doppler, the site's treatment: the limb travelling toward the camera
  // brightens and cools, the receding one warms and dims.
  float db = max(1.0 + 0.42 * vFade, 0.32);
  float dop = db * db * sqrt(sqrt(db));

  // Divided by the spread, so widening a distant ribbon does not brighten it.
  // Without this the far side of the ring gains energy as it defocuses and
  // blows out — the opposite of what distance does.
  float em = a * vBright * dop * uExpo * vFlow / vSpread;
  vec3 warm = uTint * vec3(0.86, 0.68, 0.42);
  vec3 hot = vec3(1.0, 0.975, 0.93);
  vec3 col = mix(warm, hot, clamp(vHue * 0.42 + em * 0.58, 0.0, 1.0));
  col *= mix(vec3(1.06, 0.985, 0.90), vec3(0.93, 0.975, 1.10), smoothstep(-0.2, 0.95, vFade));

  oC = vec4(col * em, 1.0);
}`;

/*
 * Bloom, in three passes over a quarter-size buffer.
 *
 * This is the difference between light and wire, and it is not decoration. A
 * bright edge in a photograph bleeds into the pixels around it, and every
 * reference frame is full of that bleed — the white core of the band is not a
 * white shape with a hard boundary, it is a bright thing seen through a lens.
 * Drawing the ribbons alone can never produce it however finely they are drawn,
 * which is why the first version read as a wireframe at any strand count.
 *
 * Two radii, composited together. A tight halo gives an edge its glow; a wide
 * one lifts the whole band off the black. One radius alone reads as a filter
 * applied to the image rather than as how the image was made.
 */
const SKY_FRAG = `#version 300 es
precision highp float;

uniform vec3  uRight;
uniform vec3  uUp;
uniform vec3  uFwd;
uniform float uFocal;
uniform float uAspect;
uniform vec2  uDrift;
uniform vec3  uTint;

in vec2 vUV;
out vec4 oC;

float rhash(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main(){
  vec2 uv = (vUV * 2.0 - 1.0);
  uv.x *= uAspect;
  vec3 rd = normalize(uv.x * uRight + uv.y * uUp + uFocal * uFwd);

  // The site's own star lookup: spherical cell hash, drifted by the pointer and
  // the runway so the deepest layer creeps while the ring sweeps.
  vec2 sph = vec2(atan(rd.z, rd.x), asin(clamp(rd.y, -1.0, 1.0))) * 177.63 + uDrift;
  float dens = min(max(fwidth(sph.x), fwidth(sph.y)), 6.0);
  vec2 cell = floor(sph);
  float hs = rhash(cell * 1.7);
  float star = step(0.9955, rhash(cell)) * hs * hs;
  vec2 cf = fract(sph) - 0.5;
  star *= smoothstep(0.4, 0.05, length(cf)) * smoothstep(2.4, 0.6, dens);
  vec3 sc = mix(vec3(0.76, 0.83, 1.0), vec3(1.0, 0.92, 0.80), rhash(cell * 3.31));

  vec3 col = sc * star * 0.9;
  col += uTint * 0.010 * (1.0 - abs(rd.y));      // faint band haze
  oC = vec4(col, 1.0);
}`;

const QUAD_VERT = `#version 300 es
in vec2 aP;
out vec2 vUV;
void main(){ vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;

const BRIGHT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform float uThresh;
in vec2 vUV;
out vec4 oC;
void main(){
  vec3 c = texture(uSrc, vUV).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  // A soft knee. A hard cutoff puts a visible contour through the band where
  // the bloom switches on.
  float k = smoothstep(uThresh, uThresh + 0.45, l);
  oC = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDir;
uniform vec2 uTexel;
in vec2 vUV;
out vec4 oC;
void main(){
  // Nine-tap gaussian, separable: two passes instead of eighty-one samples.
  float w[5];
  w[0] = 0.227027; w[1] = 0.1945946; w[2] = 0.1216216; w[3] = 0.054054; w[4] = 0.016216;
  vec3 c = texture(uSrc, vUV).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDir * uTexel * float(i) * 1.7;
    c += texture(uSrc, vUV + o).rgb * w[i];
    c += texture(uSrc, vUV - o).rgb * w[i];
  }
  oC = vec4(c, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uHalo;
uniform sampler2D uGlow;
uniform float uBloom;
in vec2 vUV;
out vec4 oC;
void main(){
  vec3 c = texture(uScene, vUV).rgb;
  c += texture(uHalo, vUV).rgb * uBloom * 0.85;
  c += texture(uGlow, vUV).rgb * uBloom * 0.55;
  // The site's own grade, applied once at the end where it belongs: tonemap,
  // a touch of film saturation, and the vignette.
  c = c / (1.0 + c);
  c = pow(c, vec3(0.78));
  float sl = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(sl), c, 1.06);
  vec2 uv = vUV * 2.0 - 1.0;
  uv.x *= 1.6;
  c *= 1.0 - 0.30 * smoothstep(0.6, 1.7, length(uv));
  oC = vec4(max(c, vec3(0.0)), 1.0);
}`;

/**
 * The strand table. Deterministic by construction: the same seed builds the
 * same ring on every load, which is the only thing that makes a screenshot
 * comparison mean anything.
 */
function buildStrands(): { strand: Float32Array; tone: Float32Array; weave: Float32Array } {
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  const strand = new Float32Array(STRANDS * 4);
  const tone = new Float32Array(STRANDS * 2);
  const weave = new Float32Array(STRANDS * 4);
  for (let i = 0; i < STRANDS; i++) {
    // Orbital density runs higher toward the inner edge; a uniform draw reads
    // as a printed gradient rather than as material.
    const r = R_IN + (R_OUT - R_IN) * Math.pow(rnd(), 1.6);
    // Three uniforms sum toward a normal, so strands crowd the midplane and
    // thin out at the surfaces.
    const g = (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const y = g * FLARE * r;
    // A steeper draw leaves most strands dim and a few bright, which is what
    // opens dark lanes between the ribbons. A flat distribution washes them
    // into one sheet — smooth, but not the reference's separated threads.
    const bright = 0.06 + 0.94 * Math.pow(rnd(), 2.9);
    strand.set([r, y, bright, rnd() * 6.283185], i * 4);
    // Wide variance on purpose: a handful of broad ribbons carry the band and
    // the rest texture it. A uniform width reads as a comb.
    tone.set([Math.pow(rnd(), 1.8), 0.35 + 4.2 * Math.pow(rnd(), 3.0)], i * 2);
    // Amplitude in world units against a band three units wide: enough to
    // cross a neighbour, not enough to leave the river.
    weave.set([
      WEAVE * (0.25 + 1.5 * Math.pow(rnd(), 1.7)),
      1 + Math.floor(rnd() * 3),
      rnd() * 6.283185,
      rnd() * 6.283185,
    ], i * 4);
  }
  return { strand, tone, weave };
}

/** One offscreen buffer: a texture and the framebuffer that draws into it. */
type Target = {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
};

type GLBundle = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  sky: WebGLProgram;
  bright: WebGLProgram;
  blur: WebGLProgram;
  composite: WebGLProgram;
  quad: WebGLBuffer;
  quadVao: WebGLVertexArrayObject;
  /** scene, then the two bloom radii. Rebuilt on resize. */
  targets: Target[];
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

/**
 * Half-float, because the scene is additive and routinely exceeds 1.0 before
 * the tonemap. An 8-bit target clips it there, and everything above the clip
 * becomes flat white with no bloom to extract — which is exactly the hard-edged
 * blowout the first version had.
 */
function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): Target | null {
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  if (!tex || !fb) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); return null; }
  return { tex, fb, w, h };
}

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

  // Rendering into a half-float target needs this on most implementations;
  // without it the framebuffer is incomplete and there is no bloom to add.
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("EXT_float_blend");

  // An arrow rather than a declaration: a hoisted function loses the null
  // narrowing on `gl` that the guard above just established.
  const link = (vertSrc: string, fragSrc: string): WebGLProgram | null => {
    const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    const p = vs && fs ? gl.createProgram() : null;
    if (!vs || !fs || !p) return null;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
    return p;
  };

  const program = link(VERT, FRAG);
  const sky = link(QUAD_VERT, SKY_FRAG);
  const bright = link(QUAD_VERT, BRIGHT_FRAG);
  const blur = link(QUAD_VERT, BLUR_FRAG);
  const composite = link(QUAD_VERT, COMPOSITE_FRAG);
  if (!program || !sky || !bright || !blur || !composite) return null;
  gl.useProgram(program);

  const vao = gl.createVertexArray();
  if (!vao) return null;
  gl.bindVertexArray(vao);

  const { strand, tone, weave } = buildStrands();
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
  bind("aWeave", weave, 4);

  // The fullscreen triangle every post pass draws, on its own VAO so binding it
  // never disturbs the instanced strand attributes.
  const quad = gl.createBuffer();
  const quadVao = gl.createVertexArray();
  if (!quad || !quadVao) return null;
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  for (const p of [sky, bright, blur, composite]) {
    const loc = gl.getAttribLocation(p, "aP");
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
  }
  gl.bindVertexArray(null);

  const u = (name: string) => gl.getUniformLocation(program, name);
  return {
    gl,
    program,
    sky,
    bright,
    blur,
    composite,
    quad,
    quadVao,
    targets: [],
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

/** The camera basis the sky pass needs to rebuild a ray per pixel. */
type Basis = {
  ro: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  fwd: [number, number, number];
};

/** View-projection for a keyframe, written straight into a column-major 4x4. */
function viewProj(key: Key, aspect: number, out: Float32Array): Basis {
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

  return {
    ro,
    right: [r2x, r2y, r2z],
    up: [u2x, u2y, u2z],
    // Forward is negated in the view matrix; the ray builder wants it pointing
    // the way the camera looks.
    fwd: [fx, fy, fz],
  };
}

export function createRing(container: HTMLElement, options: RingOptions = {}): RingHandle {
  const reduced =
    options.reduced ??
    (typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);

  /*
   * One canvas.
   *
   * There were two: the WebGL scene, and a 2D canvas on top that `TLLayers`
   * painted stars, dust and film grain onto. That layering is what the public
   * site does, and it is right there — but there the sky sits behind a hole,
   * not in front of a bright band. Here it put grain across the brightest part
   * of the ring, which no reference frame has. The stars moved into the scene
   * pass, where they are behind the ribbons and inside the same tonemap, and
   * the vignette moved into the composite. `lib/sky/layers.js` is untouched and
   * still drives the gate.
   */
  const glCanvas = document.createElement("canvas");
  glCanvas.className = "ring-canvas";
  container.append(glCanvas);

  const bundle = initGL(glCanvas);
  const matrix = new Float32Array(16);

  let progress = 0;
  /**
   * Where the scroll says the camera should be, as opposed to where it is.
   *
   * The camera eases toward this rather than snapping to it, which is the
   * difference between a scene that tracks the wheel and one that flows. The
   * lag is small — a few frames — but it is what stops a trackpad's discrete
   * steps from arriving as discrete steps in the artwork.
   */
  let target = 0;
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
      const { gl } = bundle;
      gl.useProgram(bundle.program);
      gl.uniform2f(bundle.uRes, w, h);
      // A ribbon is sized in device pixels, so its CSS width holds across DPRs.
      gl.uniform1f(bundle.uWidth, RIBBON_PX * dpr);

      // The bloom buffers are quarter and eighth size. Blur radius is measured
      // in texels, so a smaller buffer is both cheaper and wider — which is the
      // whole trick, and why bloom costs almost nothing.
      for (const t of bundle.targets) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      const q = (n: number, by: number) => Math.max(1, n >> by);
      const made = [
        makeTarget(gl, w, h),
        makeTarget(gl, q(w, 2), q(h, 2)),
        makeTarget(gl, q(w, 2), q(h, 2)),
        makeTarget(gl, q(w, 3), q(h, 3)),
        makeTarget(gl, q(w, 3), q(h, 3)),
      ];
      // If half-float targets are refused, draw straight to the canvas without
      // bloom rather than showing nothing. Dimmer, but still the ring.
      bundle.targets = made.every((t): t is Target => t !== null) ? made : [];
    }
  }

  /** One post pass: bind a target, a source texture, and draw the triangle. */
  function pass(program: WebGLProgram, dst: Target | null, src: WebGLTexture,
                set?: (gl: WebGL2RenderingContext) => void) {
    if (!bundle) return;
    const { gl } = bundle;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : glCanvas.width, dst ? dst.h : glCanvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(bundle.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(program, "uSrc"), 0);
    set?.(gl);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render(seconds: number) {
    if (!bundle) return;
    const { gl } = bundle;
    const t0 = performance.now();

    const key = keyAt(progress);
    const cam = viewProj(key, glCanvas.width / glCanvas.height, matrix);
    const ro = cam.ro;
    const [scene, haloA, haloB, glowA, glowB] = bundle.targets;
    const bloomed = bundle.targets.length === 5;

    // ---- the ring itself, into the scene buffer --------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomed ? scene.fb : null);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(bundle.program);
    gl.uniformMatrix4fv(bundle.uViewProj, false, matrix);
    gl.uniform3f(bundle.uRo, ro[0], ro[1], ro[2]);
    gl.uniform1f(bundle.uT, seconds);
    gl.uniform3f(bundle.uTint, TINT[0], TINT[1], TINT[2]);
    gl.uniform1f(bundle.uExpo, EXPOSURE);

    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0.024, 0.027, 0.039, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    /*
     * Stars first, into the same buffer.
     *
     * They used to be painted by `TLLayers` onto a second canvas laid over the
     * top, which put a star field in FRONT of the ring: fine grain speckled
     * across the brightest part of the band, which no reference frame has,
     * because a star behind a bright ribbon is not visible through it. Drawn
     * here they are behind the additive ribbons and inside the same tonemap, so
     * a bright ribbon washes them out on its own.
     */
    gl.useProgram(bundle.sky);
    gl.bindVertexArray(bundle.quadVao);
    const sky = (name: string) => gl.getUniformLocation(bundle!.sky, name);
    gl.uniform3f(sky("uRight"), cam.right[0], cam.right[1], cam.right[2]);
    gl.uniform3f(sky("uUp"), cam.up[0], cam.up[1], cam.up[2]);
    gl.uniform3f(sky("uFwd"), cam.fwd[0], cam.fwd[1], cam.fwd[2]);
    gl.uniform1f(sky("uFocal"), key.focal);
    gl.uniform1f(sky("uAspect"), glCanvas.width / glCanvas.height);
    // The deepest layer creeps: pointer drift plus the runway position, so the
    // sky moves against the ring rather than with it.
    gl.uniform2f(sky("uDrift"), driftX * 0.8, driftY * 0.8 + progress * 150);
    gl.uniform3f(sky("uTint"), TINT[0], TINT[1], TINT[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- the ribbons, added over it --------------------------------------
    gl.useProgram(bundle.program);
    gl.bindVertexArray(bundle.vao);
    gl.enable(gl.BLEND);
    // Additive, so the draw order never matters. Light does not occlude light.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEGMENTS + 1) * 2, STRANDS);
    gl.disable(gl.BLEND);

    if (bloomed) {
      const texel = (t: Target) => (g: WebGL2RenderingContext) => {
        g.uniform2f(g.getUniformLocation(bundle!.blur, "uTexel"), 1 / t.w, 1 / t.h);
      };
      const dir = (x: number, y: number) => (g: WebGL2RenderingContext) => {
        g.uniform2f(g.getUniformLocation(bundle!.blur, "uDir"), x, y);
      };
      const both = (t: Target, x: number, y: number) => (g: WebGL2RenderingContext) => {
        texel(t)(g); dir(x, y)(g);
      };

      pass(bundle.bright, haloA, scene.tex, (g) => {
        g.uniform1f(g.getUniformLocation(bundle!.bright, "uThresh"), BLOOM_THRESHOLD);
      });
      // Tight halo.
      pass(bundle.blur, haloB, haloA.tex, both(haloB, 1, 0));
      pass(bundle.blur, haloA, haloB.tex, both(haloA, 0, 1));
      // Wide lift, blurred twice more at half again the size.
      pass(bundle.blur, glowA, haloA.tex, both(glowA, 1, 0));
      pass(bundle.blur, glowB, glowA.tex, both(glowB, 0, 1));
      pass(bundle.blur, glowA, glowB.tex, both(glowA, 1, 0));
      pass(bundle.blur, glowB, glowA.tex, both(glowB, 0, 1));

      // ---- composite to the canvas ---------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.useProgram(bundle.composite);
      gl.bindVertexArray(bundle.quadVao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, haloA.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, glowB.tex);
      gl.uniform1i(gl.getUniformLocation(bundle.composite, "uScene"), 0);
      gl.uniform1i(gl.getUniformLocation(bundle.composite, "uHalo"), 1);
      gl.uniform1i(gl.getUniformLocation(bundle.composite, "uGlow"), 2);
      gl.uniform1f(gl.getUniformLocation(bundle.composite, "uBloom"), BLOOM);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    gl.bindVertexArray(null);
    totalMs += performance.now() - t0;
    frames++;
  }

  function renderOnce() {
    size();
    // A held frame still needs a clock, or the ring sits at its t=0 phase where
    // every strand shares an angle and the seam shows.
    render(12);
  }

  function frame(now: number) {
    if (!running) return;
    if (!startedAt) startedAt = now;
    const seconds = (now - startedAt) / 1000 + 12;
    // Ease toward the scroll position. 0.12 lands about a fifth of a second
    // behind a fast flick and is imperceptible on a slow one. This is the
    // difference between a scene that tracks the wheel and one that flows.
    progress += (target - progress) * 0.12;
    if (Math.abs(target - progress) < 0.0002) progress = target;
    driftX += (pointerX - driftX) * 0.06;
    driftY += (pointerY - driftY) * 0.06;
    size();
    render(seconds);
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
      if (next === target) return;
      target = next;
      // With motion off there is no loop to ease it, so the camera arrives at
      // once. Pause means less movement, not a camera that ignores the reader.
      if (!running) {
        progress = next;
        renderOnce();
      }
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
