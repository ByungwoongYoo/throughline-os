# Trying Throughline yourself

A walkthrough for testing the product by hand, on your own machine, with nobody
to ask. It assumes nothing beyond a terminal and a browser.

Everything here is written so that when something does not work, you can tell
*which* thing did not work. Most of the frustration in testing a local stack
comes from not knowing whether the problem is the database, the API, the
interface, or the feature you were actually trying to look at.

---

## 1. Start it

```bash
./scripts/dev.sh
```

That runs three things — a worker, the API, and the web interface — and stops
all of them when you press Ctrl-C. It prints:

```
  Throughline      http://localhost:3000
  API docs         http://127.0.0.1:8080/docs
  Hand tracking    ready (model served from this machine)
```

**Open the address it prints, not a LAN address.** `http://192.168.x.x:3000`
will load the interface and then refuse camera access, because browsers only
allow cameras on secure origins and `localhost` is the one exception.

### If anything looks wrong, ask first

```bash
python scripts/manage.py doctor
```

It checks the Python version, the virtualenv, Node, the hand-tracking model
(including that the file is the one it should be, not a truncated download), both
ports, the database and migrations, and whether this machine has haptic hardware.
Every failing check names the command that fixes it.

A port held by an already-running Throughline is reported as *already serving*
rather than as a failure, because that is the normal state and a tool that calls
the working case a failure is one you learn to ignore.

### If it will not start

| What it says | What it means |
|---|---|
| `Port 3000 (web interface) is already in use by node (pid …)` | Something is already running — often a previous session. Stop it, or run `PORT=8081 WEB_PORT=3001 ./scripts/dev.sh`. |
| `No virtualenv at …` | Run `python scripts/manage.py bootstrap` once. |
| `Web interface unavailable — Node 20+ is not installed` | The API still works; the interface needs Node. |
| `Hand tracking    model not installed` | Run `npm --prefix apps/web run vendor:hand-model`. It downloads a 7.5MB model once. |

The startup checks ports *before* starting anything, so a failure here means
nothing was left running behind it.

### If pages return 500 after it has been working

Look in the terminal for `ENOENT … .next/static/development/_buildManifest.js`.
That means the interface's build directory has been corrupted, and the usual
cause is `npm run build` having been run in `apps/web` **while the dev server was
running** — both write to `.next`, and they overwrite each other. The server
keeps running and every page starts returning 500.

Stop the server, delete the directory, and start again:

```bash
rm -rf apps/web/.next
./scripts/dev.sh
```

Nothing of yours is in there; it is entirely regenerated.

---

## 2. What to look at first

Sign in. If this is a fresh machine it asks you to create the first account
instead.

The sidebar is grouped by what you are doing rather than by what the software
contains. A reasonable first pass:

1. **Overview** — the project, and what state it is in.
2. **Sources** — what has been ingested, and whether ingestion finished.
3. **Findings** and **Connections** — results, and what they rest on.
4. **Chart primitives** — every visualization the product can draw, with real
   example data. This is the fastest way to see the whole visual language at
   once, and it needs no project data.
5. **Embedding space** — your corpus projected into three dimensions.

---

## 3. Testing the gestures

This is the part that has never been tested by a human hand, so it is the part
worth your attention. Every reliability claim in it currently rests on synthetic
landmark data.

**The quickest way in is <http://localhost:3000/gesture-check>.** That page
needs no account and touches no project data — it draws a synthetic cloud and
puts the tracker's own numbers on screen, so you can test tracking here, or on a
colleague's laptop, without making anybody an account. It also lists the
specific things worth judging, which are repeated below.

Inside the workspace the same control sits on **Chart primitives → P13** (a 3D
scatter) and on **Embedding space**, on your real corpus, if it has been
embedded.

### Reading the numbers

The check page reports frames processed per second, and counts of gestures
started against completed.

- **Around 30 frames a second** is healthy. Much lower on an idle machine is
  worth reporting.
- **Many more grabs started than completed** usually means the pinch threshold
  is wrong for your hand. Press *Calibrate*.
- **Tracking lost climbing while your hand is plainly in frame** points at
  lighting or contrast rather than at the code.

### Turning it on

1. Press *Try hand gestures*. Nothing happens to your camera yet.
2. Press *Set up hand gestures*. You get an explanation of what the camera is
   used for. **Still nothing happens to your camera.**
3. Press *Turn on the camera*. Now the browser asks for permission.

That ordering is deliberate and worth checking: you should never meet a
permission prompt before an explanation.

### The four gestures

| Gesture | What it does |
|---|---|
| **Pinch** thumb and index, then move your hand | Rotates the scene. Release to stop. |
| **Both hands** pinched, moved apart or together | Zooms. |
| **Point** with your index finger, other fingers curled | Hovers the nearest point. |
| **Point, then pinch** | Selects it. |

An open hand does nothing at all. That is the single most important behaviour in
the feature: the pinch is a clutch, exactly like holding a mouse button.

### What I would specifically like you to judge

These are the things no test here can answer.

1. **Hold your hand still, pinched.** Does the scene stay still? Any drift means
   the dead zone is too small.
2. **Talk, and gesture the way you would while explaining something.** Does the
   scene move? It must not. If casual movement grabs the visualization, the
   feature is worse than useless.
3. **Pinch normally, not deliberately.** Does it register first time, or do you
   have to exaggerate? If you have to exaggerate, press **Calibrate**.
4. **Move your hand and watch the scene.** Is there visible lag between the two?
5. **Take your hand out of frame mid-rotation.** The scene should stop
   immediately and not drift or spin.
6. **Cover the camera, then uncover it.** It should recover without a restart.

### Touch feedback

The check page has a **Tap the trackpad** button. Rest a finger on the trackpad
and press it: that is a real haptic tap, produced by the local process through
macOS, and it is the same tap a gesture fires.

**The limit is worth knowing before you judge it.** The actuator is in the
trackpad. A hand held in mid-air has nothing near it, so the pinch itself cannot
be felt — no software fixes that, and any product claiming otherwise on a laptop
is describing hardware it does not have. What the tap improves is the pointer
path: dragging the scene, and landing on a point, which is a hand on the
trackpad.

For mid-air gesture, confirmation is visual, plus a short click if you switch
**Sound** on. Sound is off by default because a tool that clicks in a shared
office is one you mute permanently, and then you have no feedback at all.

### The controls

- **Calibrate** — two poses, open then pinched. It measures your hand rather than
  assuming mine. If the two poses measure nearly the same, it refuses and says
  so rather than saving a threshold that would misread you.
- **Sensitivity** — rotation and zoom. Takes effect immediately, not on restart.
- **Selection reach** — how much a selection gathers. Zero selects one point;
  wider selects everything nearby.
- **Camera preview / Hand outline** — the preview minimises itself after
  calibration. The outline is the useful half: if a pinch is not registering,
  you can see whether the tracker thinks your thumb is where your thumb is.
- **Turn off the camera** — always visible while running.

### Without a camera, or without a mouse

The chart is fully usable from the keyboard, which §30 requires and Rule 5
means literally: a capability reachable only by gesture or only by pointer is
one somebody is locked out of.

Click the chart once to focus it — a small crosshair appears in the centre —
then:

| Key | What it does |
|---|---|
| Arrow keys | Rotate |
| `+` / `-` | Zoom |
| `Home` | Reset the view |
| `Enter` or `Space` | Select the point nearest the centre |
| `Escape` | Clear the selection |

There is no cursor in a 3D scene, so the target is the middle of the view:
rotate to bring a point there, then press. The crosshair is only drawn while the
chart has focus, because a permanent one would be a mark that means nothing to a
reader who is not using the keyboard.

Selecting this way also fires the trackpad tap, so it is worth trying with a
finger resting there.

### Things that should be true, and are worth checking

- The camera light goes out the moment you press *Turn off the camera*.
- Leaving the page turns the camera off.
- Refusing camera permission leaves the chart working normally with the mouse.
- Everything a gesture can do, the mouse can also do: drag to rotate, click to
  select.

---

## 3b. Drawing in the air

**<http://localhost:3000/air-ink>.** Same arrangement as the gesture page — no
account, no project, a synthetic cloud — but a different question. That page asks
whether the tracking sees your hand; this one assumes it does and asks whether a
line you draw in mid-air lands where you meant it to.

Press *Take out the pen*, then pinch and move. Two things have to be true at once
before anything draws: the pen has to be out **and** you have to be pinching.
Pointing draws nothing at any time, on purpose — pointing is what people do while
they talk, and a stray mark on a figure is something somebody has to notice and
delete.

Under the chart there is a row per stroke: how many points it recorded, how long
it was, whether it was read as a closed region, and what it caught.

### What I would specifically like you to judge

Every number in this subsystem came from reasoning rather than from a hand, so
these are the things I genuinely do not know:

1. **Does the line feel attached to your fingertip?** It is drawn about one frame
   ahead of where the camera last saw you, to cover latency that cannot be
   removed. Ahead is wrong too: if it overshoots when you stop or turn a corner,
   the horizon is too long.
2. **Do you get dots you did not mean?** A pinch has to hold for two frames to
   count as a mark. Stray dots mean that is too low; lines that start late mean
   it is too high.
3. **Do your loops close?** The *Closed?* column says whether each stroke was
   read as a region. A loop that looks closed to you and reads as open is the
   difference between selecting a cluster and being told to draw it again.
4. **Is the count right?** Draw round a group you can count by eye and compare.
   This matters more than anything else on the page: it is the number that would
   be quoted, and it is the one thing that could be wrong without looking wrong.
5. **Does it stay fast?** Draw thirty or forty strokes and see whether the line
   lags more than it did at the start. It should not — finished strokes sit on a
   separate layer that is not touched while you draw. If it does slow down, that
   is a real defect and worth telling me about.

### Things that should be true, and are worth checking

- *Clear* while you are mid-stroke stops the line and lets you start a new one
  straight away, without releasing the pinch first.
- Putting the pen away mid-line **keeps** the mark you just drew. It does not
  throw it away.
- A pinch you abandon after a single frame leaves nothing behind.
- Nothing on this page can be reached by mouse — the hand is the input — but the
  chart underneath still rotates and selects with the mouse exactly as before.

---

## 4. Testing the rest of the interface

**Charts.** Every chart has a *data table* beneath it. That is not a nicety: it
is how the figure stays readable for someone using a screen reader, and how you
check that what you are seeing matches the numbers.

**The 3D scatter says what it is hiding.** It reports how many points are hidden
behind others. A 3D scatter that does not say this is claiming you can see
everything, and you cannot.

**Embedding space states its own weakness.** Above the chart it tells you how
much of the variation the three axes carry. If that number is low, it says so in
words rather than leaving you to interpret a percentage.

**Ask about a selection.** Select a point (or a region) in Embedding space, type
a question, press Ask. The answer is recorded in the project journal, attributed
to the model — never presented as your own note. If no model is configured it
says so rather than failing silently.

---

## 5. When something looks wrong

Check in this order. Each step rules out a layer.

```bash
curl -s http://127.0.0.1:8080/api/health | python3 -m json.tool
```

`"status": "ok"` or `"degraded"` both mean the API and database are fine —
`degraded` just means an optional capability (a model, the graph projection) is
unavailable, and the response says which.

- **The interface loads but has no data** → the API is not answering. The health
  check above will say so.
- **A gesture does nothing** → turn on *Hand outline*. If there is no outline on
  your hand, the tracker is not seeing it (lighting, or the hand is out of
  frame). If there is an outline but nothing moves, that is a threshold problem,
  and *Calibrate* is the fix.
- **The camera light stays on after switching off** → that is a bug. Please say
  so; it is the most serious failure this feature can have.
- **Everything is slow** → check whether it is the chart or the tracking, by
  turning the camera off. The chart alone should be smooth.

---

## 6. Stopping it

Ctrl-C in the terminal running `dev.sh` stops all three processes, including the
ones they started. If something survives:

```bash
pkill -f "next start"; pkill -f "next dev"; pkill -f uvicorn; pkill -f throughline_workers
```

---

## 7. Your data

Everything lives in `~/.throughline-os`. Nothing is sent anywhere: the database
is embedded, the hand-tracking model is served from this machine, and camera
frames never leave the browser tab.

To take a copy before experimenting:

```bash
./scripts/backup.sh
```

`./scripts/restore.sh` puts one back.
