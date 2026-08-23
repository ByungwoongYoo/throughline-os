import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
