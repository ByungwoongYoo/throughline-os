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

### Stopping it

```bash
python scripts/manage.py stop
```

Ctrl-C in the window running it does the same thing. This is for the other
case — a session started in a window you have since closed, which is easy to
forget about and does not behave like a fresh one: it keeps serving whatever
it compiled when it started, so after pulling changes the interface is the old
one and looks broken rather than stale.

It stops only a stack started from this directory. Anything else holding those
ports is named and left running.

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
| `Port 3000 (web interface) is already in use by node (pid …)` | Something is already running — often a previous session. Stop it with `python scripts/manage.py stop`, or run `PORT=8081 WEB_PORT=3001 ./scripts/dev.sh`. |
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

## 2. Making yourself an account

Sign in. If this is a fresh machine it asks you to create the first account
instead, and that first account is the administrator — nobody after it is.

If accounts already exist, **Create an account** on the sign-in page works from
this machine without anything further. Sign-up is deliberately allowed from
`127.0.0.1`, `::1` and `localhost` only: a laptop holding somebody's corpus also
joins café wifi, and an open registration endpoint there would let anyone on the
network make themselves an account next to unpublished data. To allow it from
elsewhere, the administrator turns on **Sign-up from the network** in Settings —
a deliberate act, off by default, and one only the administrator can take.

The administrator is also the only account that can install feature packs,
change the model or its key, add people, and add the desktop menu entry: those
change the machine for everyone on it, not one researcher's projects.

The only rule on the password is that it is at least twelve characters. There is
no email verification, no invite code and no network call, so nothing about
signing up depends on this machine being online.

A new account owns nothing and sees an empty workspace. That is a property of
the queries — projects are scoped by owner — rather than of the interface hiding
rows, which matters because only one of those two survives somebody writing a
new page. Once in, **Open a worked example** seeds a real project with two
ingested and analysed sources, which is the quickest way to have something on
screen. It is offered on the first screen of a new account and again on the
**New project** screen (project switcher, top left), so an account that began
with its own question can still open it; asking twice opens the one that
already exists rather than making a second copy.

The example builds in the background. The Overview's counts and *The loop*
checklist move on their own while it does — the screen re-reads the project
for as long as the server says work is still running, and stops asking once
it is not — so if the numbers sit at zero for more than a minute, look at
**Sources** for a source stuck at *queued*: that means no worker is running.

**The address bar is where you are.** It carries the project, the section
and the object that is open (`/workspace?project=…&section=findings&item=…`),
so a reload, a bookmark or a link pasted to a colleague comes back to the
same screen in the same project, and the browser's Back closes a detail
before it leaves a section. Opening the app fresh at `/workspace` returns to
the project this account had open last on this browser.

---

## 2a. What works with no AI model at all

Worth reading before you conclude something is broken. **This installation does
not need, and does not default to, any paid API.** Nothing here calls Anthropic
or OpenAI unless you deliberately configure it to.

The default model provider is **Ollama**, which runs on your own machine and
costs nothing. If Ollama is not installed, or is installed with no model pulled,
the system does not fail — it reports the capability as unavailable and says
what would fix it. `GET /api/system/capabilities` is where that lives, and the
interface reads it.

**Works with no model whatsoever:**

- ingesting PDFs and datasets, and everything about sources
- literature and dataset search across the outside repositories
- reading and marking papers, and taking excerpts to the board
- every statistical analysis: correlations, estimates, specification curves,
  discoveries, consistency checks
- the knowledge graph — centrality, communities, reachability, paths
- embedding space, chart primitives, the whole visual language
- search, notebook, provenance, impact, vocabulary, patterns, key findings
- hand tracking, Air Ink, and the gesture pages

**Needs a model** — these report unavailability rather than approximating:

- plain-language summaries of an analysis run
- asking a question about an object
- proposing variable labels
- extracting structured fields from a paper
- locating claims in a source

To turn those on without spending anything, install Ollama and pull a model:

```
ollama pull qwen2.5:7b-instruct
```

Then `ollama serve`, and the capability check starts reporting it as usable.
Nothing else has to change — the provider is already the default.

A smaller model works too, and is worth choosing on a laptop: `qwen2.5:1.5b-instruct`
answers far faster and needs a fraction of the memory. Set it with
`THROUGHLINE_MODEL`, or in Settings, which refuses to select a model that is not
actually installed rather than leaving you configured-but-broken.

**Health says "degraded" and that is usually fine.** `/api/health` reports
degraded when any *optional* capability is missing, and each check says which
one — a missing model, or no background worker having reported in recently, are
both degraded and neither stops you using the product. Only an unreachable
database is critical, and only that gives a 503. Read the `checks` object rather
than the top-line word.

---

## 2b. What to look at first

Open **Overview** and work **The loop** from the top. Six steps — add sources,
profile a dataset, generate and test candidates, try to destroy what survived,
record a finding, communicate it — each ticked from the project's real counts,
each a button that takes you to where the step happens. The strip at the top of
every screen carries the same step and the same button, so you can start the
next step from wherever you are, and the panel on the right says the same thing
in a sentence.

Two things the loop cannot tell you:

- **Workboard** sits beside Overview because the brief calls it the central
  operating surface: it is where the project's objects are arranged, not a step.
- The chart catalogue is a view of **Figures** — *Chart primitives* beside *This
  project*. It draws every chart the product has against illustrative data and
  needs no project of its own, but the question it answers is "what could I draw
  this as", which you have while making a figure.

The rail's groups are kinds of screen, in the order the work happens: the
project itself, gathering, discovering and testing, communicating, and this
machine. Nothing in it is a step; the strip is where the numbering lives.

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

Inside the workspace the same control sits on **Figures** → *Chart primitives* →
P13 (a 3D scatter) and on **Analyses** → *Embedding space*, on your real corpus,
if it has been embedded.

### The first time you turn the camera on

You get four steps: **point, pinch, move, release**. They advance when the system
actually *sees* you do them — not when you press Next.

That is the point of them. A slideshow with a Next button teaches nothing and
confirms nothing: you could click through all four without the tracking having
seen your hand once. Getting to the end here is proof that gestures work on this
machine, with this camera, in this light, for your hand.

It is also the best diagnostic in the product. If you get stuck on **pinch**
while **point** completed, you know the camera can see you and the pinch
threshold is the problem — which is a specific thing to tell me, rather than "it
doesn't work".

Every step can be skipped on its own, and the whole thing can be skipped. Nothing
is blocked while it runs — the figures respond to your hand throughout. It only
appears once; after that it is remembered.

### You can see which figure you have hold of

With two figures on a page, the one your hand is over gets a **dashed outline**,
and the one you have actually taken hold of gets a **solid green one**. Those are
deliberately different pictures rather than the same one at two strengths: "this
is the one I would grab" and "this is the one I have" are different facts, and
until now neither was shown at all. If you pinched the wrong figure, the way you
found out was by turning something you did not mean to.

The outline stays on the figure you started on even if your hand wanders off it,
which is the rule that stops a long drag being handed to whatever you passed
over.

### It tells you what a pinch would do

Beside the cursor you will see *pinch to draw*, *pinch to rub out*, *pinch to
select* — whichever applies.

It does not stay there. It appears when the answer **changes** (your hand has
arrived somewhere new, or you switched tool) and whenever your hand **goes
still** — because holding your hand over something without acting is
deliberating, and that is the other moment it helps. While you are moving, it
fades away. A label pinned to the cursor forever would follow you across the
figure, sit on the data you are reading, and become furniture you stop seeing.

### The eraser has a size

Switch to the eraser and you will see a faint dashed circle around the cursor.
That is how far it actually reaches. Before, you had to guess — and a tool whose
extent you cannot see takes more than you meant about half the time, which on an
eraser costs you an annotation.

### You can see your hand now

With the camera on there is a small ring where the system thinks your pinch
point is, and **a ring around it that fills as your fingers close**.

That arc is the important part. Before, when a pinch did not register, there was
no way to tell whether the camera could not see your hand, or could see it and
disagreed about what counts as a pinch, or your hand was not over a figure —
three different faults with one symptom, nothing happened. Now you can see
whether you are at a tenth or at nine tenths.

The ring pulses at the moment the pinch is *accepted*, which is a little after
your fingers meet — that gap is the two-frame rule that stops a passing hand
leaving a dot. Watching it once tells you more about the feature than any
explanation.

It also says what a pinch would do — *pinch to draw*, *pinch to rub out*, *pinch
to select* — and it sits where the mark would begin rather than at your
fingertip, which is about 65 pixels away.

### Reading the numbers

**Delay from frame to response** is three numbers — typical, 95th percentile,
99th. Three rather than one on purpose: lag is not felt as an average, it is felt
as the moments the scene stops keeping up, and a tracker that answers in 20ms
forty-nine times and 400ms once averages to 27ms and feels broken. The 99th is
the number that corresponds to "it stutters".

The target is under 60ms. This counts inference and interpretation, not camera
exposure or the display, so the true delay is a little longer than what is shown.

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

### An annotation knows which view it was drawn in

Circle some points, then rotate the chart. The ink stays where it is on screen
while the marks move underneath — which is honest, because a loop drawn on a
screen has no fixed meaning in a scene you can turn. Depth is ambiguous from one
angle, so there is no region of data you can be said to have circled
independently of where you were standing.

Rather than pretend otherwise, the strokes table has a **Still the same view?**
column. It says *yes* while the scene is where you drew it, and offers **no — go
back to it** once you have moved. Pressing that returns the chart to exactly the
orientation and zoom the annotation was made at.

### Measuring between two observations

Click two points on the cloud. You get the difference **along each axis, in that
axis's own units** — and no single distance.

That refusal is the feature, not a limitation I could not get round. The three
axes are scaled independently so the shape of the cloud is legible, which means a
centimetre along one is a different amount of a different quantity from a
centimetre along another. There is no length of the line between two
observations — not one that is hard to compute, one that **does not exist**. A
number there would be an invented unit, and it would end up in a paper.

Click the same point twice and it says so rather than reporting three zeroes.
Two *different* observations that happen to coincide still measure as zero,
because that is a real finding.

### Colours and layers

A **Colour** row with four colours — not a picker, because a floating palette for
every change is worse than four good choices.

A **Layers** list below the strokes table lets you turn a group of annotations
off to see the figure underneath. Hiding is not erasing: everything comes back.

One thing there is worth knowing even though you cannot trigger it yet.
**Anything the assistant draws is always dashed**, and that cannot be changed —
not by picking a style, not by copying one from another mark. A figure showing a
*suggested* trend line is making a different claim from one showing a trend line
you committed to, and that difference has to survive being screenshotted,
printed in greyscale, and read a year later by somebody who was not there.

### Drawing a straight line

A hand in mid-air cannot draw a straight line, and smoothing does not fix it:
your arm rotates about your shoulder while you believe you are moving it
sideways, so the line bows. Fine for an annotation, wrong for an axis marker or
a trend line.

The **Straightedge** row constrains the line *as you draw it* — Free, Straight
(holds whatever direction you set off in), Horizontal, Vertical, 45°, or
Magnetic.

**Magnetic** is the one worth trying. It pulls the line onto level, upright or
45° when you are already close, and leaves a deliberately oblique line alone. A
tool that snapped everything to the nearest of those would drag every thirty-
degree line to forty-five, and you would be fighting it rather than using it.

Unlike the shape offer, this is not something applied afterwards — it is a ruler
you picked up first, so the constrained line *is* what you drew.

### Selecting with a lasso

The **Tool** row has a third setting: *Lasso*. Draw a loop around some points and
it tells you what was inside — then **the boundary disappears**.

That is the difference from drawing a loop with the pen. A lasso is a question,
not an annotation: you drew it to ask *which of these*, and if it stayed on the
figure every selection would leave a scribble behind for you to clean up. It is
also absent from undo, so pressing undo after a selection does not put a
boundary you had finished with back on the chart.

### Tidying a shape

Draw a circle, a box, a line, an arrow, a bracket or a region. If the mark looks
like one of those, the strokes table offers **tidy into ...** and you can take it
or leave it.

Two things are deliberate. It reads the mark **after** you finish, never while
you are still drawing — a shape that morphs under your hand as you aim at it is
worse than a wobbly one. And **what you drew is kept**: tidying changes the drawn
copy, never the record, so the annotation can always say what your hand actually
did. Undo takes it back.

If it says *as drawn*, it means the mark did not clearly look like anything. That
is the intended answer for a deliberately irregular boundary — a system that
offered you a neat ellipse there would have misread what you meant.

### Rubbing things out

There is a **Tool** row: *Pen* and *Eraser*. Switch to the eraser, pinch, and
move across a mark — the ink goes as your hand passes, not when you let go.

**Erasing the middle of a line leaves two lines**, not one line gone and not a
line with an invisible gap in it. Both halves keep the points your hand actually
made; nothing is redrawn or smoothed on the way out.

The eraser is a mode on purpose. People wave their hands while they talk, so a
wiping motion only erases once you have said you are erasing — otherwise the most
destructive thing on the canvas would also be the easiest to trigger by accident,
and you would be looking at your hands rather than at the annotation that just
vanished.

A whole wipe is **one** press of undo, however many frames it took, and it hands
back the original strokes rather than rebuilt ones.

### Undo covers clearing now

*Clear* used to throw away every mark on the canvas permanently. It no longer
does: **Undo** takes it back and hands you the same strokes, not redrawn copies.

The buttons say what they would do — *Undo clearing 12 strokes* rather than
*Undo* — because after a few minutes of drawing, "Undo" on its own is not a
decision anybody can make.

Worth trying: draw several marks, press *Clear*, then *Undo*. Everything should
come back in the order you drew it. *Redo* puts it away again.

### The pen spans the page, not one chart

There are two figures on this page now — the cloud and a fitted saddle — and
**one pen across both**. Whichever figure your hand is over is the one you are
drawing on, and a loop resolves against *that* figure's observations.

That is not cosmetic. A layer that sat inside one chart could only be drawn on
inside it, and would need its own recorder and its own undo history per figure,
so a mark could never cross from one to the other and undo would not span them.

Worth checking: draw a loop on the saddle and read the count, then draw the same
loop on the cloud. The two should describe different observations. If a loop over
one figure ever reports observations from the other, that is a serious fault and
worth telling me about — the number would be plausible and wrong.

### If the line is too fast to write with

Use the **Stabilisation** buttons under the pen controls. This was the first
thing real hands found, and the default has been changed because of it.

- **Steady** (the default) — a hand held still now drifts under 4 pixels, where
  before it drifted 75. Your hand moves the pen slightly further than the pen
  travels, which is what makes fine control possible.
- **Handwriting** — the most precise. Your hand moves about 1.5x further than
  the ink does, and the line never runs ahead of where the camera last saw you.
  Use this for letters and equations.
- **Natural** — one-to-one with your hand, for big marks and arrows.

If none of them let you write, that is worth telling me: the settings were tuned
against a simulated tremor, and a real hand is the only thing that can say
whether the numbers are right.

### Saying what you mean

Under the strokes table there is a box. Draw a loop around some points, then type
what you want — *why are these different*, *compare this with this*.

The word **these** is resolved against what your hand was doing when you typed
it, not against whatever happens to be selected. That includes a word entered
while you are still drawing, which is the normal case in speech and the one that
is easy to get wrong.

It is typed rather than spoken on purpose. The browser's built-in speech
recognition sends your microphone audio to Google, which would break the promise
that nothing here leaves your machine — so it is not switched on by default.
Typing runs the identical path, so this is the real feature and not a stand-in.

Nothing is run. What comes back is a proposal you would accept or decline,
because a spoken sentence is ambiguous and has no natural moment to confirm it: a
misheard word should cost you a decline, not an analysis.

The sentence is dated from **when you started typing it**, not when you press
the button. Draw a loop, take a few seconds to compose the sentence, and
*these* still finds the loop — before this it did not, and you were told nothing
was indicated about the circle you had just drawn.

One thing typing cannot do that speech will: *compare this with this*, one word
per cluster, gesturing between the two. Both your hands are on the keyboard, so
every word of a typed sentence necessarily refers to the same moment.

Worth trying: type the sentence **without** drawing anything first. It should
refuse and tell you to circle something while you say the word — not quietly
answer about whatever was last selected.

### Two charts on one page

This page has two figures — the cloud and the saddle — and until now **only the
cloud responded to your hand**. The saddle was connected to the page and to
nothing that produces gestures, so waving at it did nothing and looked exactly
like broken tracking.

Both are live now. The one your hand is over is the one you are steering, and
once you pinch, that figure is **held until you let go** — dragging across the
other one will not hand your gesture to it halfway through.

One thing that is deliberate and might read as a fault: **you can only address a
figure that is on screen.** Scroll so the saddle is visible and it becomes
reachable; the cloud, now scrolled off, does not. You point at what you can see.

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
