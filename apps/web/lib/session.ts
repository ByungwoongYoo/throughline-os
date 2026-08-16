/**
 * The identity of one working session.
 *
 * Not the sign-in session, and deliberately not the account. This answers a
 * narrower question: which looks at the data belong to the same sitting, so
 * that multiple-comparison correction can run over the family a researcher
 * actually accumulated rather than over each verb separately.
 *
 * `sessionStorage` rather than `localStorage`, and the difference is the whole
 * design. localStorage would make one family that grows for as long as the
 * browser profile lives — every test a researcher has ever run corrected
 * together, which reports today's result as though it were the ten-thousandth
 * thing they tried. sessionStorage ends with the tab, which is a much closer
 * match to what a person means by "this afternoon's work" and errs, when it is
 * wrong, toward too small a family rather than an absurd one.
 *
 * A new tab starts a new family. That is a real limitation and it is the honest
 * side to err on: splitting one sitting across two tabs under-counts the looks,
 * whereas a single permanent identifier would over-count them forever, and an
 * over-corrected result looks like a failure the researcher cannot explain.
 */

const KEY = "throughline.session";

/**
 * The current session id, created on first use.
 *
 * Returns null during server rendering, where there is no tab and therefore no
 * session — callers omit the field rather than inventing one, and the backend
 * treats an absent session as "this work stands alone", which is the behaviour
 * that existed before any of this.
 */
export function sessionId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;

    const fresh = `ses_${crypto.randomUUID().replace(/-/g, "")}`;
    window.sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private browsing and hardened profiles can refuse storage entirely.
    // Returning null costs the cross-verb family and nothing else: every
    // sweep still forms its own, which is exactly the pre-existing behaviour.
    // Throwing here would take down discovery for a counting feature.
    return null;
  }
}
