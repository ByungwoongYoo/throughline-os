"use client";

/**
 * How much would have to be unaccounted for, for this to go away.
 *
 * Everything else on a connection's screen reports what was done: the test,
 * the corrected q-value, what the validation suite tried. None of it answers
 * the question a reviewer asks first, and the one a researcher should ask
 * before writing anything down — *what would have to be true for this to be
 * nothing?*
 *
 * The E-value answers it in one number. It pairs with the causal-language
 * validator: that stops a sentence claiming more than the design licenses,
 * and this says how far from a causal claim the evidence sits.
 *
 * **The number is never shown on its own.** An E-value quoted bare reads as a
 * quality score, and researchers would start comparing them across
 * unrelated results. So the sentence that says what it means, the assumptions
 * the conversion rests on, and the refusal to be read as causal evidence all
 * travel with it — and a fragile result is called fragile in words rather
 * than left to be inferred from a small number.
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Failure, Loading } from "./primitives";

type Report = {
  variables: [string, string];
  estimate: number;
  e_value: number;
  e_value_limit: number | null;
  headline: number;
  interval_note: string;
  assumptions: string[];
  sentence: string;
};

export function Fragility({ connectionId }: { connectionId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Report>(`/api/connections/${connectionId}/fragility`)
      .then((body) => { setReport(body); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [connectionId]);

  useEffect(load, [load]);

  if (loading) return <Loading rows={2} label="Working out how fragile this is" />;
  /*
   * A method this cannot convert honestly is not an error on this screen — it
   * is a fact about the analysis. Saying so beats a red banner, and beats
   * silence, which would leave a researcher wondering whether the number was
   * withheld or never existed.
   */
  /*
   * A body without a usable number is treated exactly like a refusal, rather
   * than trusted because the request succeeded. Found by the existing
   * connection tests, whose fixtures answer every `api.get` with connection
   * data: this panel read `headline` off one of them and crashed the whole
   * screen. In the product the same shape arrives from an older client or a
   * response that changed underneath one, and blanking the screen is a much
   * worse answer than saying no number is available.
   */
  const usable = report != null && Number.isFinite(report.headline);

  /*
   * Which refusal, and whether it is a refusal at all.
   *
   * The endpoint answers with a different status for each of these and writes
   * a sentence for every one: 422 when the method cannot be converted to a
   * risk ratio honestly, 409 when no analysis has completed or the run
   * recorded no estimate, 404 when the connection is gone. Every one of them
   * arrived here as `error` and produced the single sentence below — so a
   * connection whose analysis had simply not finished was told its *method*
   * was the problem, which is a specific claim about the researcher's own
   * work that this screen had never established. A server that was down said
   * the same thing.
   *
   * So: 422 keeps the sentence written for it. The other refusals carry the
   * server's own words, which §104 requires reach the researcher and which
   * are already written as sentences for one. Anything else — a 5xx, a
   * dropped network, something that is not an `ApiError` at all — is a
   * failure, and a failure is recoverable and offers the retry. A refusal is
   * not and must not, because a retry that cannot succeed reads as a system
   * that is merely broken.
   */
  const refused = error instanceof ApiError ? error : null;

  if (error && !refused) {
    return (
      <section className="fragility">
        <h2>How fragile is this?</h2>
        <Failure error={error} retry={load} />
      </section>
    );
  }

  if (refused && refused.status !== 422) {
    if (refused.status >= 500) {
      return (
        <section className="fragility">
          <h2>How fragile is this?</h2>
          <Failure error={error} retry={load} />
        </section>
      );
    }
    return (
      <section className="fragility">
        <h2>How fragile is this?</h2>
        <p className="note">
          {refused.message} No number is shown rather than a confident one
          with no meaning.
        </p>
      </section>
    );
  }

  if (refused || !usable) {
    return (
      <section className="fragility">
        <h2>How fragile is this?</h2>
        <p className="note">
          An E-value is computed for correlations. This connection&rsquo;s
          method is not one it can convert to a risk ratio honestly, so no
          number is shown rather than a confident one with no meaning.
        </p>
      </section>
    );
  }

  const fragile = report!.headline < 1.25;

  return (
    <section className="fragility">
      <h2>How fragile is this?</h2>
      <p className="big" data-fragile={fragile ? "yes" : "no"}>
        {report!.headline.toPrecision(3)}
      </p>
      <p className="lede">
        The strength an unmeasured confounder would need with{" "}
        <strong>both</strong> {report!.variables?.[0]} and {report!.variables?.[1]},
        as a risk ratio, to explain this association away entirely.
      </p>
      {(report!.sentence ?? "").split("\n").filter(Boolean).map((line) => (
        <p key={line} className="note">{line}</p>
      ))}
      <details>
        <summary>What this number rests on</summary>
        <ul>
          {(report!.assumptions ?? []).map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
