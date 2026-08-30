"use client";

/**
 * What this finding would look like in a reference library.
 *
 * Preview only, deliberately. The write path exists, is tested, and is
 * idempotent — and it has never made a single call against a real Zotero
 * library. Everything known about it comes from the documented protocol and a
 * replaced transport, which is enough to be confident about the logic and not
 * enough to put a button in front of somebody that writes into a decade of
 * their accumulated reading. A library is not version-controlled and there is
 * no undo in that direction.
 *
 * So this ships the half that cannot damage anything: the exact note, rendered
 * from the real endpoint, with a plain statement of why there is nothing to
 * press. When the write path has been exercised against a throwaway library,
 * the button is a small addition — and it will be an addition somebody made
 * after checking, rather than one that shipped on the strength of a passing
 * test suite.
 *
 * The preview is not decoration. A note written into a library outlives the
 * project that produced it, gets read by someone who has forgotten the context,
 * and cannot be re-derived from a tool they may no longer run. Seeing the text
 * first is the difference between a tool a researcher trusts with their library
 * and one they do not.
 */

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { Failure, Loading } from "./primitives";

type Note = { finding_id: string; html: string };

export function LibraryNote({ projectId, findingId }: {
  projectId: string;
  findingId: string;
}) {
  const [open, setOpen] = useState(false);

  // No family is named. The server reads the count from the project's open line
  // of enquiry, so an exported note carries the record rather than whatever
  // identifier this browser was holding.
  const { data, error, loading, reload } = useApi<Note>(
    open ? `/api/projects/${projectId}/findings/${findingId}/library-note` : null,
    [open],
  );

  if (!open) {
    return (
      <p style={{ marginTop: 16 }}>
        <button type="button" onClick={() => setOpen(true)}>
          Preview this as a library note
        </button>
      </p>
    );
  }

  return (
    <section aria-labelledby="note-heading" style={{ marginTop: 16 }}>
      <h2 id="note-heading">As a library note</h2>

      {error ? <Failure error={error} retry={reload} /> : null}
      {loading && !data ? <Loading rows={3} label="Composing the note" /> : null}

      {data && (
        <>
          {/*
            The note carries its own caveats — status, causation, how many times
            the data was looked at — because it has to survive leaving this
            system. Rendered as it would be written rather than reformatted for
            this screen: a preview that differs from what is sent is not one.

            Inserted as HTML on purpose, and the reason it is safe is specific
            rather than general. Every value in that string is escaped where the
            note is composed — `library_note._esc` runs over the title, the
            statement and each limitation — so the only tags present are the
            handful the composer emits itself. A finding titled with a script
            tag arrives here already inert, and there is a test on the composer
            asserting exactly that.

            The alternative — escaping again here — would show a researcher
            markup instead of a note, which defeats the one thing a preview is
            for. If the composer ever stops escaping, this becomes a hole; that
            is why the guarantee lives beside the code that provides it.
          */}
          <div
            className="card"
            style={{ fontSize: 13 }}
            dangerouslySetInnerHTML={{ __html: data.html }}
          />

          <p className="note">
            Nothing has been written anywhere. Sending this to Zotero is built
            but has never run against a real library, so it is not offered here
            yet — a write into somebody&apos;s references is not a thing to
            ship on the strength of a passing test.
          </p>
        </>
      )}
    </section>
  );
}
