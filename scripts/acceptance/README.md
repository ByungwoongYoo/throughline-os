# Acceptance measurements

Two things the test suite cannot see, because it renders into happy-dom: it
applies no CSS and runs no WebGL. Both of these need a browser and the running
app, so they are scripts rather than tests.

## Text over the ring

The entrance sets light type over a moving luminous band. Whether a sentence
can be read is the one thing that cannot be traded for a better-looking frame,
and it had been failing unnoticed: "The study reports an association" sat at
3.78:1 against white before the disk was widened and 2.66:1 after, where normal
text needs 4.5:1.

```
bash scripts/demo-up.sh                                   # from a real terminal
node scripts/acceptance/entrance-ground.mjs /tmp/ground
.venv/bin/python scripts/acceptance/entrance-contrast.py /tmp/ground
```

The capture makes the type transparent rather than hiding its container, so
every background, rule and scrim stays exactly where it is — the ground the
contrast is actually against. Hiding the container instead removes the scrim
along with the text and reports a fixed block as still failing.

Run it after any change to `lib/entrance/ring.ts`, to the entrance's copy
layout, or to `app/entrance.css`.
