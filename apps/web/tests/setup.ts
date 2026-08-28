import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/**
 * Give the test DOM a `localStorage`, because Node 26 takes it away.
 *
 * Node 26 added its own global `localStorage`, and unless the process is
 * started with `--localstorage-file` that global is **defined but undefined** —
 * present enough to win, empty enough to be useless. happy-dom aliases `window`
 * to `globalThis`, so Node's global shadows the one happy-dom installs, and
 * `window.localStorage` comes back `undefined` while `window.sessionStorage`
 * beside it is a perfectly good Storage object.
 *
 * The failure this produced is worth recording because of how it looked.
 * Fifty-five tests across the spatial suite died in `beforeEach` on
 * `window.localStorage.clear()` — every one of them reporting "Cannot read
 * properties of undefined", none of them reporting anything about storage, and
 * all of them in code that had not changed. It reads exactly like a broken
 * component, and the cause is the Node version the tests happen to run under.
 *
 * So this is an environment shim and nothing more: it restores a standard
 * browser API that the runtime removed, using happy-dom's own `Storage` class,
 * and only when it is genuinely missing. It is deliberately not a mock — the
 * settings tests assert real round-trips through storage, and a stub that
 * merely absorbed writes would let a persistence bug pass while looking green.
 */
function restoreLocalStorage(): void {
  if (typeof window === "undefined") return;
  const existing = (window as unknown as { localStorage?: unknown }).localStorage;
  if (existing) return;

  const Storage = (globalThis as unknown as { Storage?: new () => Storage })
    .Storage;
  // Fail loudly rather than silently substituting a fake: if happy-dom stops
  // exporting Storage, the honest outcome is a broken setup a person looks at,
  // not a suite that passes against something that is not storage.
  if (typeof Storage !== "function") {
    throw new Error(
      "This DOM has no localStorage and no Storage class to build one from. "
      + "Tests that assert persistence cannot be trusted here.");
  }

  const storage = new Storage();
  // `configurable` so a test that wants to replace or spy on storage still can.
  Object.defineProperty(window, "localStorage", {
    value: storage, writable: false, configurable: true, enumerable: true,
  });
}

restoreLocalStorage();

afterEach(cleanup);


/**
 * A test cannot pass while the thing it rendered threw.
 *
 * React catches an error thrown during render, unmounts the tree, and logs it.
 * The DOM is then empty — and an empty DOM satisfies every `queryBy…` that
 * expects nothing, every `not.toContain`, and every assertion about a call
 * that was made before the crash. The test goes green over a component that
 * fell over.
 *
 * This has now cost four separate debugging sessions in this repository, and
 * every one of them began by looking in the wrong place, because a dead render
 * reports itself as whatever the first query happened to ask for: *unable to
 * find role combobox* when the picker was fine, *unable to find the button*
 * when the button was fine. The cause was always a fixture that had drifted
 * from the type it stands in for — an object literal is a second copy of an
 * API contract, and nothing keeps the two together unless it is typed.
 *
 * So the render error becomes the failure. A test that means to provoke one —
 * an error boundary, a deliberately bad prop — opts out by name.
 */
const RENDER_CRASH =
  /TypeError|is not iterable|Cannot read propert|is not a function/;

/** Tests that provoke a render error on purpose. */
const ALLOWED_TO_CRASH: RegExp[] = [];

let crashes: string[] = [];
let realError: typeof console.error;

beforeEach(() => {
  crashes = [];
  realError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (RENDER_CRASH.test(text)) crashes.push(text.slice(0, 300));
    realError(...args);
  };
});

afterEach((ctx) => {
  console.error = realError;
  const name = ctx.task?.name ?? "";
  if (!crashes.length) return;
  if (ALLOWED_TO_CRASH.some((pattern) => pattern.test(name))) return;
  throw new Error(
    "Something threw while rendering, so this test asserted against an empty "
    + "DOM:\n  " + crashes[0]
    + "\n\nUsually a test fixture that has drifted from the type it stands "
    + "in for. Type the fixture and the compiler will point at the missing "
    + "field.");
});