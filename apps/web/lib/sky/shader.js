/*
 * The public site's own shader module, copied rather than reimplemented.
 *
 * Source: frontend/mods/shader.js at 37528281639d9ad34d17353503190a84da0fbf07.
 * Everything between the two markers below is byte-identical to that file, and
 * tests/sky-is-the-site-s-own-code.test.ts fails if it stops being. An
 * entrance that merely resembles the site drifts from it within a release, and
 * then the product has two answers to what it looks like.
 *
 * The markers are here because the site concatenates these modules into one
 * inline script, where a top-level binding is simply in scope for the
 * integrator below it. Here the file is an ES module, so the bindings have to
 * be exported — that export is the only line outside the copy.
 */
/* @tl-verbatim-begin frontend/mods/shader.js */
/* Throughline — ray-traced black hole, scroll-driven camera.
   Element module: shaders only. No imports, no exports; top-level consts so the
   integrator can concatenate this straight into the page's inline script. */

const TL_VERT = "#version 300 es\nin vec2 aP; void main(){ gl_Position = vec4(aP, 0.0, 1.0); }";

const TL_FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;      // render-target size in device px
uniform float uT;        // seconds * spin
uniform vec3  uTint;     // ember tint, linear-ish 0..1
uniform float uBoost;    // 0..3 disk surge
uniform float uFlare;    // 0..2 supernova flare
uniform float uCam;      // 0..1 camera path progress
uniform vec2  uStarOff;  // far-star parallax, page-px scale

out vec4 oC;

// cheap hash — good enough for the disk noise, kept so the disk grades exactly
// as the shipped shader did.
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// robust hash for the sky-cell grid and the grain: the cheap one degenerates at
// the large indices the sky lookup uses (|sph| runs to ~560) and lays stars out
// in dotted arcs along whole elevation bands.
float rhash(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm5(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  uv.y -= 0.32;                       // hole anchored at 0.34h, matching layers and beats

  // ---- camera path -------------------------------------------------------
  // one smoothstep drives everything, so every term is monotonic in uCam.
  float e = clamp(uCam, 0.0, 1.0);
  e = e * e * (3.0 - 2.0 * e);

  float camDist = mix(17.0, 9.0, e);      // wide -> pushed in
  float camY    = mix(1.5, 0.78, e);      // holds ~5deg elevation the whole way
  float yaw     = 0.35 * e;               // slight orbit; the disk sweep changes
  float roll    = mix(-0.08, -0.489, e);  // lands on the brand's -28 degrees
  float focal   = mix(1.70, 1.34, e);     // eases the push so nothing snaps

  vec3 ro = vec3(sin(yaw) * camDist, camY, -cos(yaw) * camDist);
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  // sign chosen so a negative roll tilts the image the same way CSS
  // rotate(-28deg) tilts the logo's slash: up towards the right.
  vec2 ruv = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * uv;
  vec3 v = normalize(ruv.x * rt + ruv.y * up + focal * fw);
  vec3 p = ro;

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  bool captured = false;
  float minR = 1e3;

  // per-pixel step dither: breaks the concentric stepping bands inside the
  // shadow into fine texture the grain then absorbs. Stable in time, so it
  // never shimmers.
  float jit = 0.88 + 0.24 * rhash(gl_FragCoord.xy * 0.719 + 11.3);

  for (int i = 0; i < 90; i++){
    float r2 = dot(p, p);
    float r = sqrt(r2);
    minR = min(minR, r);
    if (r < 1.0) { captured = true; break; }
    if (r > 32.0 && dot(p, v) > 0.0) break;
    // far from the hole there is nothing to sample, so stride harder and keep
    // the fine steps for the lensed region (same 90-step budget as before).
    float dt = clamp(r * 0.14, 0.045, 0.34) * (1.0 + 0.95 * smoothstep(9.5, 16.5, r)) * jit;
    vec3 h = cross(p, v);
    v += -1.5 * dot(h, h) * p / (r2 * r2 * r) * dt;    // geodesic bend, r^-5
    vec3 pn = p + v * dt;

    // thin volumetric haze hugging the disk — gives the sheet apparent depth.
    // gated on |y| first so most steps skip the radius work entirely.
    float ay = abs(p.y);
    if (ay < 0.345) {
      float dr = length(p.xz);
      if (dr > 1.9 && dr < 8.0) {
        float hz = 1.0 - ay * 2.9;
        float q = 2.2 / dr; q *= q; q *= q;             // (2.2/dr)^4, no pow()
        float ha = hz * hz * hz * q * (0.9 + 0.2 * uBoost);
        vec3 hc = mix(uTint * vec3(0.80, 0.48, 0.25), vec3(1.0, 0.93, 0.82), min(ha * 0.9, 0.30));
        col += (1.0 - alpha) * hc * ha * dt * 0.17;
      }
    }

    if (p.y * pn.y < 0.0) {                              // disk-plane crossing
      vec3 hit = mix(p, pn, p.y / (p.y - pn.y));
      float hr = length(hit.xz);
      if (hr > 2.1 && hr < 8.8) {
        float phi = atan(hit.z, hit.x);
        float sp = phi * hr * 0.55 + uT * 3.4 / (hr * sqrt(hr));
        // domain warp -> filaments shear instead of reading as ring noise
        float w = vnoise(vec2(hr * 1.35, sp * 0.5 + uT * 0.05));
        float fil = fbm5(vec2(hr * 2.4 - uT * 0.12 + w * 0.85, sp + w * 1.7));
        fil = 0.25 + 1.52 * smoothstep(0.32, 0.92, fil);
        // fine striations, faded out where lensing compresses the inner image
        fil *= mix(1.0, 0.80 + 0.40 * vnoise(vec2(hr * 9.0, sp * 0.28)), smoothstep(2.3, 3.6, hr));
        // rays that grazed the photon sphere carry a hugely magnified, hugely
        // compressed image of the disk; let their texture relax to flat so the
        // filament grid stops beading along the shadow rim.
        fil = mix(1.05, fil, smoothstep(1.42, 2.30, minR));
        float qf = 2.2 / hr; qf = qf * qf * sqrt(sqrt(qf));          // (2.2/hr)^2.25
        float fall = qf * smoothstep(8.8, 6.5, hr) * smoothstep(2.1, 2.5, hr);
        vec3 tang = normalize(vec3(-hit.z, 0.0, hit.x));
        float ap = dot(tang, -normalize(v));                        // >0 approaching
        float db = max(1.0 + 0.42 * ap, 0.35);
        float dop = db * db * sqrt(sqrt(db));                       // db^2.25
        float inner = smoothstep(3.7, 2.2, hr);                     // hot inner edge
        float em = fall * fil * dop * (4.4 + uBoost) * (1.0 + 0.62 * inner);
        vec3 ramp = mix(uTint * vec3(0.55, 0.38, 0.26), uTint, clamp(em * 0.4, 0.0, 1.0));
        ramp = mix(ramp, vec3(1.0, 0.97, 0.90), clamp(em * 0.22 - 0.25, 0.0, 1.0));
        ramp = mix(ramp, vec3(1.0, 0.98, 0.94), inner * inner * 0.34);
        // Doppler colour: approaching limb shifts bluish-white, receding warms
        ramp *= mix(vec3(1.06, 0.985, 0.90), vec3(0.93, 0.975, 1.10), smoothstep(-0.15, 0.95, ap));
        col += (1.0 - alpha) * em * ramp * 0.75;
        alpha += (1.0 - alpha) * clamp(em * 0.5, 0.0, 0.8);
      }
    }
    p = pn;
  }

  // Escaped-ray sky. Everything derivative-dependent is computed in uniform
  // control flow (fwidth inside a branch is undefined in GLSL ES 3.00), then
  // masked by the captured flag at the end.
  vec3 d = normalize(v);
  // 177.63 = degrees * 3.1 sky cells per degree. uStarOff arrives in page px and
  // is converted through the live focal length, so the deepest layer creeps at
  // ~1:1 with the offset the integrator passes and does not speed up as the
  // camera pushes in.
  vec2 sph = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 177.63
           + uStarOff * (0.3944 / focal);
  // where lensing crushes many sky cells into one pixel the point grid aliases
  // into dotted arcs — fade the field out exactly there.
  float dens = min(max(fwidth(sph.x), fwidth(sph.y)), 6.0);
  if (!captured) {
    vec2 cell = floor(sph);
    float hs = rhash(cell * 1.7);
    float star = step(0.9955, rhash(cell)) * hs * hs;
    vec2 cf = fract(sph) - 0.5;
    star *= smoothstep(0.4, 0.05, length(cf)) * smoothstep(2.4, 0.6, dens);
    vec3 sc = mix(vec3(0.76, 0.83, 1.0), vec3(1.0, 0.92, 0.80), rhash(cell * 3.31));
    col += (1.0 - alpha) * sc * star * 1.45;
    col += (1.0 - alpha) * uTint * 0.012 * (1.0 - abs(d.y));   // faint band haze
  }

  // photon-sphere glow: rays that grazed r~1.5 carry the ring's light
  col += uTint * 0.085 / (abs(minR - 1.5) + 0.21) * (1.0 - alpha) * 0.60;
  col += vec3(1.0, 0.96, 0.90) * 0.030 / (abs(minR - 1.5) + 0.055) * (1.0 - alpha) * 0.30;

  // supernova flare
  col += vec3(1.0, 0.95, 0.85) * uFlare * (1.4 / (length(uv) + 0.35));

  col *= 1.30;
  col = col / (1.0 + col);                                 // tone map
  col = pow(col, vec3(0.75));
  float sl = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(sl), col, 1.14);                          // film-stock saturation
  col *= 1.0 - 0.32 * smoothstep(0.7, 1.6, length(uv));    // vignette

  // ---- film grain, after tone map ---------------------------------------
  float g1 = rhash(gl_FragCoord.xy + vec2(fract(uT * 0.717) * 311.7, fract(uT * 0.531) * 197.3));
  float g2 = rhash(gl_FragCoord.xy * 0.5 + vec2(fract(uT * 0.313) * 73.1, fract(uT * 0.911) * 151.9));
  float grain = (g1 - 0.5) * 0.72 + (g2 - 0.5) * 0.28;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += grain * 0.035 * (0.45 + 0.85 * smoothstep(0.0, 0.55, lum));

  oC = vec4(max(col, vec3(0.0)), 1.0);
}`;

// UNIFORMS:
//   uRes     vec2   render-target size in device pixels (canvas.width, canvas.height).
//                   Drives the aspect-correct uv; pass the *scaled* backing-store
//                   size, not the CSS size. Range: > 0.
//   uT       float  animation clock = elapsedSeconds * spinRate. Feeds disk
//                   rotation, filament drift and the grain jitter, so it must
//                   advance every frame (a frozen uT freezes the grain).
//                   Range: 0 .. +inf, monotonically increasing.
//   uTint    vec3   ember tint #e8b76a as vec3(0.910, 0.718, 0.416). Colours the
//                   disk body, the photon-ring bloom and the band haze.
//                   Range: 0..1 per channel.
//   uBoost   float  disk surge — lifts emission and the volumetric haze on a
//                   beat. 0 = rest, ~1 = a strong pulse, 3 = maximum.
//                   Range: 0..3.
//   uFlare   float  supernova flare — a screen-centred white bloom at the hole
//                   anchor. 0 = off, 1 = bright, 2 = blown out. Range: 0..2.
//   uCam     float  camera path progress, normally the page scroll progress p.
//                   0 -> camDist 17, camY 1.5, yaw 0, roll -0.08, focal 1.70
//                   1 -> camDist  9, camY 0.78, yaw 0.35 rad, roll -0.489 rad
//                        (-28 deg, the brand angle), focal 1.34
//                   Internally eased with one smoothstep, so every term is
//                   smooth and monotonic; no oscillation anywhere on the path.
//                   Values are clamped, so overscroll is safe. Range: 0..1.
//   uStarOff vec2   far-star parallax offset in *page pixels*, converted inside
//                   the shader through the live focal length so the sky moves
//                   about 1:1 with the number you pass and does not speed up as
//                   the camera pushes in. Pass
//                   vec2(pointerDriftX, scrollY * 0.05 + pointerDriftY):
//                   a 400vh runway (~3600 px * 0.05 = 180 px) drifts the star
//                   field ~180 px, the slowest layer on the page. Only the
//                   escaped-ray sky lookup reads it. Range: any finite value;
//                   practical +-600.
//
// Notes for the integrator:
//   * The screen anchor of the hole is fixed by `uv.y -= 0.3` and is independent
//     of uCam: x = 0.5 * width, y = 0.35 * height of the canvas. It does not
//     drift as the camera pushes in.
//   * 90 bending steps, unchanged. The step size now strides harder outside
//     r > 9.5 so the wider uCam=0 framing still reaches the far side of the
//     disk within the same budget. Runs at the shipped 0.66x render scale.
//   * Cost measured against the shipped shader in the same headless rig
//     (1440x900, 0.66x, swiftshader): shipped 1.83 fps, this 1.67 fps at
//     uCam=0 and 1.83 fps at uCam=1 — parity within measurement noise. The
//     added realism is paid for by removing pow() from the inner loop
//     (r^-5 and the two ^2.25 terms are now multiplies and sqrts).
//   * Roll sign: the rotation matrix is transposed relative to the shipped
//     shader so that a NEGATIVE roll tilts the image the same way CSS
//     rotate(-28deg) tilts the logo's slash — up towards the right. Verified
//     against a -28deg overlay at uCam=1.
//   * The `hash` used by the disk noise is the shipped one, deliberately, so
//     the disk grades identically. The sky and the grain use `rhash`; the
//     cheap hash degenerates at the sky's large cell indices and drew stars
//     as dotted arcs across the frame.
//   * Vertex shader is the original fullscreen triangle; draw 3 vertices with
//     the [-1,-1, 3,-1, -1,3] buffer.
/* @tl-verbatim-end */
export { TL_VERT, TL_FRAG };
