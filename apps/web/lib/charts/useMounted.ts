import { useEffect, useState } from "react";

/**
 * False during the server render and the first client render; true after.
 *
 * This exists for one defect, which this project has now shipped twice: a
 * browser capability read *during render*. `canRecord()` asks whether
 * `MediaRecorder` exists; `CameraManager.supported()` asks about
 * `navigator.mediaDevices`. Both are honest questions with different answers on
 * the two passes — the server says no and the browser says yes — so the server
 * sends markup with one fewer button than the browser expects, React finds a
 * tree it cannot reconcile, and the *whole page* is thrown away and rendered
 * again from scratch. The console says "server rendered HTML didn't match" and
 * the page looks fine, which is why it survived: nothing is visibly broken, the
 * cost is a discarded hydration on every load.
 *
 * Gating on this hook makes the two passes agree by construction — the answer
 * is no on both, and the capability is asked about a frame later, on the client,
 * where it can be answered truthfully.
 *
 * **The test suite cannot catch this by rendering.** happy-dom supplies
 * `navigator`, and jsdom-style environments supply enough of the rest, so both
 * passes agree in tests and disagree only in a real browser. A test that
 * asserts "the capability-dependent element is absent from the first render"
 * (see `tests/hydration-capability.test.tsx`) is the shape that does catch it,
 * because it fails when the gate is removed regardless of what the environment
 * provides.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
