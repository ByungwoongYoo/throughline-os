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

export function ProvenanceLogLink({ findingId }: { findingId: string }) {
  return (
    <p className="prov-log">
      <a
        className="btn"
        href={`/api/findings/${findingId}/provenance.md`}
        download
      >
        Download the provenance log
      </a>{" "}
      <span className="note">
        Every analysis behind this finding, with its seed, its library versions
        and the hash of the data it read — what a methods section needs, and
        what a reviewer would ask for.
      </span>
    </p>
  );
}
