/**
 * What is on screen right now, for the assistant to be told about (§36).
 *
 * The assistant already knew what a researcher had *pointed at*; it did not
 * know what they were *looking at*. Asked "why are these different?" on a
 * screen showing two hundred of four hundred connections, it had no way to
 * know the question was about a subset — and every answer it gave about "the
 * connections" was an answer about half of them.
 *
 * **This is deliberately module state rather than React state.** The thing
 * being modelled is genuinely singular and genuinely global: there is one
 * screen, and the question "what is the researcher looking at" has one answer
 * at a time. Threading it through the component tree would mean every screen
 * that can open a journal passing a view prop down to it, and the prop would
 * be wrong in exactly the places nobody remembered to update.
 *
 * **The reset is the correctness property.** `enterScreen` clears everything
 * else, because a filter left over from a screen the researcher has left is
 * worse than no context at all: the assistant would be told a filter is in
 * force that is not, and would qualify a true answer into a false one. Screens
 * report what they are showing; leaving a screen withdraws it.
 *
 * Nothing here is trusted by the server. It is a statement about a browser,
 * and `throughline_domain.research_context` validates, bounds and labels it as
 * such before a model sees a word of it.
 */

export type ViewFilter = { field: string; value?: string };

export type ViewState = {
  screen?: string;
  filters?: ViewFilter[];
  /** How many records this screen is showing. */
  showing?: number;
  /** How many there are altogether, when the screen actually knows. */
  total?: number;
  chart?: { kind?: string; x?: string; y?: string; colour?: string };
  focus?: string;
};

let current: ViewState = {};

/**
 * Move to a screen, discarding everything the previous one reported.
 *
 * Called with the same screen twice, it still clears — a screen remounting is
 * a screen that has not yet reported this time round, and stale counts are the
 * failure this whole module is built to avoid.
 */
export function enterScreen(screen: string): void {
  current = { screen };
}

/** Add what this screen is showing to the current view. */
export function reportView(partial: Omit<ViewState, "screen">): void {
  current = { ...current, ...partial };
}

/** What to send with a question. */
export function currentView(): ViewState {
  return { ...current };
}

/** For tests, and for a sign-out that should leave nothing behind. */
export function forgetView(): void {
  current = {};
}
