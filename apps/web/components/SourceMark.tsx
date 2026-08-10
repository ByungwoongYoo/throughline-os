"use client";

/**
 * Marks for the connectors.
 *
 * **These are not the sources' real logos, and that is deliberate.** arXiv,
 * PubMed, Crossref and the rest own their marks; reproducing them inside a
 * product implies an endorsement or an affiliation that does not exist. The
 * workspace also has to work with no network, so fetching a favicon is not an
 * option even where it would be allowed. So each source gets a monogram drawn
 * here — recognisable at 18px, honest about being ours.
 *
 * **The colour is deliberately weak.** The one rule the design system will not
 * bend on is that saturated colour belongs to data and chrome stays
 * near-neutral. Fourteen bright badges in a result list would compete with
 * every chart on the screen, so the hues below are low-chroma and do most of
 * their work at ~12% alpha behind a letterform. Recognition is carried by the
 * *letters*, which is why each monogram is one or two characters chosen to be
 * distinct at a glance: OA, CR, aX, PM, S2, EP, bR, DJ, AI, Zo, Ze, Dy, DV, Fs.
 *
 * The third field, `kind`, matters more than the colour. A result from a
 * dataset repository, a preprint server and a peer-reviewed index are three
 * different sorts of evidence, and the mark carries that distinction so a list
 * never flattens them into "sources".
 */

export type SourceKind = "index" | "preprint" | "dataset" | "personal";

type Mark = { label: string; hue: number; kind: SourceKind; title: string };

const MARKS: Record<string, Mark> = {
  openalex: { label: "OA", hue: 212, kind: "index",
              title: "OpenAlex — open index of scholarly works" },
  crossref: { label: "CR", hue: 28, kind: "index",
              title: "Crossref — the DOI registration agency" },
  arxiv: { label: "aX", hue: 356, kind: "preprint",
           title: "arXiv — preprints in physics, maths and computing" },
  pubmed: { label: "PM", hue: 202, kind: "index",
            title: "PubMed — biomedical literature index" },
  semanticscholar: { label: "S2", hue: 268, kind: "index",
                     title: "Semantic Scholar — citations and references" },
  europepmc: { label: "EP", hue: 168, kind: "index",
               title: "Europe PMC — biomedical records with open-access full text" },
  biorxiv: { label: "bR", hue: 14, kind: "preprint",
             title: "bioRxiv — preprints, not peer reviewed" },
  medrxiv: { label: "mR", hue: 4, kind: "preprint",
             title: "medRxiv — preprints, not peer reviewed" },
  doaj: { label: "DJ", hue: 130, kind: "index",
          title: "DOAJ — vetted open-access journals" },
  openaire: { label: "AI", hue: 190, kind: "index",
              title: "OpenAIRE — European research graph" },
  zotero: { label: "Zo", hue: 350, kind: "personal",
            title: "Your own Zotero library, read-only" },
  zenodo: { label: "Ze", hue: 220, kind: "dataset",
            title: "Zenodo — open deposit, anyone may upload" },
  dryad: { label: "Dy", hue: 96, kind: "dataset",
           title: "Dryad — curated data behind published papers" },
  dataverse: { label: "DV", hue: 42, kind: "dataset",
               title: "Dataverse — curated, with variable-level metadata" },
  figshare: { label: "Fs", hue: 288, kind: "dataset",
              title: "Figshare — open deposit" },
};

/** Unknown sources still get a mark rather than a hole in the row. */
function markFor(name: string): Mark {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return MARKS[key] ?? {
    label: name.slice(0, 2).replace(/^./, (c) => c.toUpperCase()),
    hue: 220, kind: "index", title: name,
  };
}

export function SourceMark({ name, size = 18 }: { name: string; size?: number }) {
  const mark = markFor(name);
  return (
    <span
      className="smark"
      data-kind={mark.kind}
      title={mark.title}
      style={{
        width: size, height: size,
        fontSize: Math.round(size * 0.46),
        // oklch keeps every mark at the same perceived lightness, so no badge
        // shouts louder than its neighbour purely because of its hue.
        ["--smark-hue" as string]: String(mark.hue),
      }}
      aria-hidden
    >
      {mark.label}
    </span>
  );
}

/**
 * A source with its mark, its name and its state.
 *
 * `ok=false` is drawn differently from a zero count on purpose: "PubMed
 * returned nothing" and "PubMed did not answer" are different facts about the
 * world, and a researcher who reads the first when the second is true will
 * conclude the literature is empty.
 */
export function SourceChip({
  name, ok, count, note, polite,
}: {
  name: string;
  ok?: boolean;
  count?: number;
  note?: string | null;
  /** False when the source works but is throttled or unconfigured. */
  polite?: boolean;
}) {
  const state = ok === false ? "down" : polite === false ? "limited" : "ok";
  return (
    <span className="schip" data-state={state} title={note ?? markFor(name).title}>
      <SourceMark name={name} size={16} />
      <span className="schip-name">{name}</span>
      {count !== undefined && ok !== false && (
        <span className="schip-count numeric">{count}</span>
      )}
      {ok === false && <span className="schip-state">did not answer</span>}
      {ok !== false && polite === false && (
        <span className="schip-state">limited</span>
      )}
    </span>
  );
}

export { markFor };
