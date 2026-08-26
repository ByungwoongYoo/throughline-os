# frontend/ — the black-hole landing page

The download/landing page for Throughline: a ray-traced black hole (WebGL2
geodesic shader) with real scroll parallax, story beats that dissolve into the
hole, a blast that condenses the hole into the Throughline mark (Download +
GitHub buttons live under the lockup), the mark expanding back into the hole,
and an infinite scroll loop. Published as a Claude Design canvas during
design iteration; intended to be ported into `apps/web` when the design is
final.

**Now tracked** (T085). It was untracked via `.git/info/exclude` so design
iteration would not dirty the shared tree — which also meant it existed on
exactly one machine and a `git clean -fdx` would have deleted it. The generated
output stays out of git: `Main.dc.html` is built by `assemble.mjs`, and `shots/`
is 2.2 MB of regenerable screenshots.

## Deploying it

```bash
node frontend/assemble.mjs      # sources -> Main.dc.html
```

Upload `Main.dc.html` as the page. The download buttons point at a **release
host**, not at GitHub — they used to link into the private repository and
returned 404 to every stranger the page exists for. Override the host when
assembling:

```bash
TL_RELEASES=https://downloads.example.com node frontend/assemble.mjs
```

The host must serve what `python scripts/manage.py release` writes into `dist/`:

| File | What it is |
|---|---|
| `Throughline.command` | macOS launcher — double-click |
| `Throughline.bat` | Windows launcher — double-click |
| `throughline.sh` | Linux launcher |
| `install.sh` | the one-liner, offered for reading first |
| `throughline-<version>.tar.gz` | what the launchers install |
| `latest.json` | the signed manifest an installed copy checks |

`tests/test_landing_downloads.py` fails if the page links a file the release
does not publish, because those are two lists in two languages that must name
the same things, and nothing else connects them.

**`__TL_GITHUB__` still points at a private repository.** For a public page that
button is a 404 with a promise on it; decide whether to remove it or point it
somewhere real before this goes live.

## Files

- `main.template.html` — the page: markup, helmet CSS, and the integrator
  `Component` (scroll/pointer state, choreography windows, module wiring).
  **Edit this, not `Main.dc.html`.**
- `mods/shader.js` — `TL_VERT`/`TL_FRAG`: the ray-traced Gargantua with a
  scroll-driven camera (uniforms documented in-file).
- `mods/layers.js` — `TLLayers`: near-star/dust parallax + film grain canvas.
- `mods/beats.js` — `TLBeats`: text beats enter as line-rises, exit by
  dissolving into particles that stream into the hole.
- `mods/sections.js` — unused since the below-the-fold section was cut;
  kept because it is a complete, verified entrance-parallax section module.
- `assemble.mjs` — splices the three active modules into the template at the
  `/*__TL_MODULES__*/` marker → writes `Main.dc.html`.
- `canvas.json` — Design-canvas layout manifest (single artboard).
- `tools/mkharness.mjs` — extracts markup + script from `Main.dc.html` into a
  standalone `harness.html` (stubs the design-canvas runtime) for headless
  viewing.
- `tools/shot.mjs` — screenshots the harness with apps/web's Playwright
  (SwiftShader flag included, so it works without a GPU).

## The loop (never ship unseen)

```bash
node frontend/assemble.mjs
node frontend/tools/mkharness.mjs frontend/Main.dc.html frontend/dist/harness.html
node frontend/tools/shot.mjs frontend/dist/harness.html frontend/shots
```

Look at the screenshots, fix, repeat. Scroll-progress map (p = scrollY /
(520vh − 100vh)): beats [−0.08,0.22] and [0.26,0.46] · flash 0.54–0.62 ·
mark on the rim 0.60–0.68 · condense 0.68–0.75 · buttons 0.73–0.86 ·
reverse + camera pull-out 0.86–1 · wrap to start at the bottom.

Publishing to the design canvas happens from a Claude session (the canvas
seeder is session tooling, not part of this folder).
