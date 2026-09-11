/**
 * The reproducibility record for one finding, as a file to attach.
 *
 * `EvidenceGraphView` above answers "why do we believe this" on screen. This
 * answers the question a methods section asks — what somebody would have to do
 * to get the number again — and answers it as something they can put in
 * supplementary material: each analysis behind the finding with its method,
 * the reason that method was chosen, the seed, the library versions and the
 * input hashes §44 requires a run to record.
 *
 * On the finding's own screen rather than with the other exports, because this
 * one is about a particular result: a researcher wants it while looking at the
 * thing it describes, not while thinking about the project as a whole.
 *
 * A plain link. The browser already knows how to save a file the server marks
 * as an attachment, and fetching it into a Blob would add a copy in memory and
 * a filename this code would have to invent.
 */

/**
 * The script that produces this analysis's number again.
 *
 * Beside the run it belongs to, because that is where somebody is standing
 * when they ask "how was this computed". Generated from the recorded spec, so
 * the script and the recorded number cannot drift apart — and refused, with
 * the method named, where the computation cannot be written out honestly in a
 * few lines.
 */
import { Fold } from "./primitives";

export function ReproductionScriptLink({ runId }: { runId: string }) {
  // A `div`, not a `p`: the fold below is a `<details>`, and a details inside
  // a paragraph is closed by the parser before it is rendered.
  return (
    <div className="prov-log">
      <a className="btn" href={`/api/analyses/${runId}/reproduce.py`} download>
        Download the script
      </a>
      <Fold summary="What the script re-runs, and what it does not" count={1}>
        <span className="note">
          Re-runs this one analysis from the recorded specification. It does not
          re-run the assumption checks or the correction that decided whether the
          result survived — a p-value on its own is not a finding.
        </span>
      </Fold>
    </div>
  );
}


export function ProvenanceLogLink({ findingId }: { findingId: string }) {
  return (
    <div className="prov-log">
      <a
        className="btn"
        href={`/api/findings/${findingId}/provenance.md`}
        download
      >
        Download the provenance log
      </a>
      <Fold summary="What the provenance log holds" count={1}>
        <span className="note">
          Every analysis behind this finding, with its seed, its library versions
          and the hash of the data it read — what a methods section needs, and
          what a reviewer would ask for.
        </span>
      </Fold>
    </div>
  );
}
