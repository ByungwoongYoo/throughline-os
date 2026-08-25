"use client";

/**
 * Mol* drawing a structure file the researcher already has on disk (T077).
 *
 * Mol* is the reference renderer for macromolecular structures, and this is the
 * whole of what it is asked to do here: take one local file, choose a parser
 * from its name, place the atoms, and say how many of them there were. Camera,
 * lighting, bond perception and the cartoon geometry are its business and are
 * not reimplemented.
 *
 * **Nothing here can reach the network, and that is a construction rather than
 * a promise.** Mol*'s own `DefaultPluginSpec()` is deliberately not used: it
 * registers `DownloadStructure`, `DownloadDensity` and the volume-streaming
 * actions, and each of those is an affordance to fetch a structure by accession
 * from a server. The spec below lists `actions: []`, so no such action is
 * registered at all — the only route bytes take into the plugin is `rawData`,
 * with bytes this component read from a `File` the researcher chose.
 *
 * **`mol-plugin-ui` is not mounted either.** It brings a menu bar whose first
 * entry is "Download Structure", a state tree, and a stylesheet of its own.
 * Driving `PluginContext` against our own canvas gives the same renderer and
 * the same mouse controls with no way to ask a server for anything, and costs
 * the page no CSS.
 *
 * **The representation is chosen, not guessed.** A viewer that always applied
 * Mol*'s automatic preset would draw a cartoon for a protein and ball-and-stick
 * for a ligand, which is sensible — and would make the catalogue's separate
 * "Ball and stick" and "Space filling" entries into names for something the
 * researcher cannot actually ask for. The select below is what makes those
 * entries real.
 */

import { useEffect, useRef, useState } from "react";
import { requireWebGL } from "@/lib/specialist/contract";
import type {
  SpecialistReport, SpecialistViewerProps,
} from "@/lib/specialist/contract";

/** A trajectory parser, spelled as `parseTrajectory` spells it. */
type Parser =
  | "mmcif" | "pdb" | "pdbqt" | "pqr" | "gro" | "xyz" | "mol" | "sdf" | "mol2";

/** One recognised extension and what Mol* should be told to do with it. */
export type Readable = {
  extension: string;
  parser: Parser;
  /** `.bcif` is BinaryCIF; everything else here is text. */
  binary: boolean;
};

/**
 * Extension → parser, mirroring the `stringExtensions` and `binaryExtensions`
 * each Mol* trajectory provider declares for itself.
 *
 * **The name decides and the bytes are never sniffed.** Mol*'s own file drop
 * handler guesses by content when the extension is unhelpful; guessing here
 * would mean handing an arbitrary file to a parser that fails somewhere inside
 * itself with a message about a missing column, which is true and unreadable.
 * Refusing by name produces a sentence a person can act on.
 *
 * `.cif` is sent to the mmCIF parser rather than the small-molecule `cifCore`
 * one: both claim the extension, and the macromolecular case is the one this
 * viewer exists for. A core CIF is therefore not read — see the note on
 * "Crystal structure" in the catalogue.
 */
const READABLE: readonly Readable[] = [
  { extension: "pdb", parser: "pdb", binary: false },
  { extension: "ent", parser: "pdb", binary: false },
  { extension: "cif", parser: "mmcif", binary: false },
  { extension: "mmcif", parser: "mmcif", binary: false },
  { extension: "mcif", parser: "mmcif", binary: false },
  { extension: "bcif", parser: "mmcif", binary: true },
  { extension: "pdbqt", parser: "pdbqt", binary: false },
  { extension: "pqr", parser: "pqr", binary: false },
  { extension: "gro", parser: "gro", binary: false },
  { extension: "xyz", parser: "xyz", binary: false },
  { extension: "mol", parser: "mol", binary: false },
  { extension: "sdf", parser: "sdf", binary: false },
  { extension: "sd", parser: "sdf", binary: false },
  { extension: "mol2", parser: "mol2", binary: false },
];

/** What the refusals offer, in the form a person would type. */
export const READABLE_EXTENSIONS: readonly string[] =
  READABLE.map((r) => `.${r.extension}`);

/** Lowercased, without the dot; `""` for a name that has no extension. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/** The parser for a file name, or `null` when nothing here claims it. */
export function formatOf(fileName: string): Readable | null {
  const extension = extensionOf(fileName);
  if (extension === "") return null;
  return READABLE.find((r) => r.extension === extension) ?? null;
}

/**
 * What the researcher asked to see.
 *
 * `auto` is not a fifth drawing — it is the decision deferred until the file
 * has been counted, because whether a cartoon has anything to trace is a fact
 * about the file rather than a preference.
 */
export type Representation =
  | "auto" | "cartoon" | "ball-and-stick" | "spacefill" | "molecular-surface";

/** Every representation except the deferred one. */
export type DrawnAs = Exclude<Representation, "auto">;

const REPRESENTATIONS: ReadonlyArray<{ id: Representation; label: string }> = [
  { id: "auto", label: "Automatic" },
  { id: "cartoon", label: "Cartoon" },
  { id: "ball-and-stick", label: "Ball and stick" },
  { id: "spacefill", label: "Space filling" },
  { id: "molecular-surface", label: "Molecular surface" },
];

/** The catalogue's words for each, used in the report a reader sees. */
const DRAWN_LABEL: Record<DrawnAs, string> = {
  "cartoon": "cartoon",
  "ball-and-stick": "ball and stick",
  "spacefill": "space filling",
  "molecular-surface": "a molecular surface",
};

/**
 * Which Mol* colour theme each representation gets.
 *
 * Chain colouring says something at the scale a cartoon or a surface is read
 * at; element colouring says something at the scale individual atoms are read
 * at. Neither is decoration — a space-filling model coloured by chain hides
 * exactly the thing a person opened a space-filling model to see.
 */
const COLOUR: Record<DrawnAs, "chain-id" | "element-symbol"> = {
  "cartoon": "chain-id",
  "ball-and-stick": "element-symbol",
  "spacefill": "element-symbol",
  "molecular-surface": "chain-id",
};

/** What Mol* found, in the terms the report is written in. */
export type StructureCounts = {
  /** Atoms actually placed in the drawn structure. */
  atoms: number;
  chains: number;
  residues: number;
  /** Residues in a polymer Mol* can trace; zero for a ligand or a small molecule. */
  polymerResidues: number;
  /** NMR ensembles and trajectories hold several; the first is drawn. */
  models: number;
};

/**
 * The parts of Mol*'s `Structure` this file reads.
 *
 * Written structurally rather than importing the type, so that counting can be
 * tested against a hand-built object in an environment that cannot load Mol* at
 * all. `specialist-molstar.test.tsx` walks the installed `.d.ts` files to check
 * these members still exist, because a fake that has drifted from the real
 * shape is a test that passes and means nothing.
 */
export type CountableStructure = {
  readonly elementCount: number;
  readonly polymerResidueCount: number;
  readonly models: ReadonlyArray<{
    readonly atomicHierarchy: {
      readonly chains: { readonly _rowCount: number };
      readonly residues: { readonly _rowCount: number };
    };
  }>;
};

export function countStructure(structure: CountableStructure): StructureCounts {
  const model = structure.models[0];
  return {
    atoms: structure.elementCount,
    chains: model?.atomicHierarchy.chains._rowCount ?? 0,
    residues: model?.atomicHierarchy.residues._rowCount ?? 0,
    polymerResidues: structure.polymerResidueCount,
    models: structure.models.length,
  };
}

/** Which drawing `auto` means for this particular file. */
export function resolveRepresentation(
  choice: Representation, counts: StructureCounts,
): DrawnAs {
  if (choice !== "auto") return choice;
  return counts.polymerResidues > 0 ? "cartoon" : "ball-and-stick";
}

/** Thousands separators, without asking the runtime's locale. */
function grouped(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function plural(count: number, noun: string): string {
  return `${grouped(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * What to say about a parsed file, before anything is added to the scene.
 *
 * Two of the three outcomes are refusals, and both are cases a viewer that
 * trusted the library would show as an empty box: a file that parsed but holds
 * no coordinates, and a cartoon asked of something with no polymer to trace.
 * Deciding here rather than after rendering is what lets the component avoid
 * adding a representation it already knows draws nothing.
 */
export function verdictFor(
  counts: StructureCounts, drawnAs: DrawnAs, fileName: string,
): SpecialistReport {
  if (counts.atoms <= 0) {
    return {
      drawn: false,
      because: `Mol* parsed “${fileName}” and found no atoms in it, so there `
        + "is nothing to place. The file was read in this browser and nowhere "
        + "else.",
    };
  }

  if (drawnAs === "cartoon" && counts.polymerResidues <= 0) {
    return {
      drawn: false,
      because: "A cartoon traces a polymer backbone, and Mol* found none in "
        + `“${fileName}” — ${plural(counts.atoms, "atom")}, no polymer `
        + "residue among them. Choose ball and stick or space filling to see "
        + "this file.",
    };
  }

  const detail = [
    counts.chains > 0 ? plural(counts.chains, "chain") : null,
    counts.residues > 0 ? plural(counts.residues, "residue") : null,
  ].filter((part): part is string => part !== null);

  const ensemble = counts.models > 1
    ? ` The file holds ${plural(counts.models, "model")}; the first is drawn.`
    : "";

  return {
    drawn: true,
    describes: `${plural(counts.atoms, "atom")} from “${fileName}”, drawn as `
      + `${DRAWN_LABEL[drawnAs]}`
      + (detail.length > 0 ? ` — ${detail.join(", ")}.` : ".")
      + ensemble,
  };
}

const NOTHING_CHOSEN =
  "No structure file has been chosen, so Mol* has read nothing. Pick one from "
  + `your own disk — ${READABLE_EXTENSIONS.join(", ")} — and open the viewer `
  + "again.";

const NO_CANVAS =
  "Mol* started but this browser gave it no 3D canvas to draw into, so nothing "
  + "was drawn and the file was not read.";

/** Named by extension because that is the only thing this viewer looked at. */
export function unreadable(fileName: string): string {
  const extension = extensionOf(fileName);
  const named = extension === ""
    ? "a name with no extension at all"
    : `“.${extension}”`;
  return `“${fileName}” was not opened. This viewer picks a parser from the `
    + `file's extension and never from its contents, and ${named} matches none `
    + `of ${READABLE_EXTENSIONS.join(", ")}.`;
}

export function noStructure(fileName: string): string {
  return `Mol* read “${fileName}” but built no structure from it, so there is `
    + "nothing to draw.";
}

export function parseFailed(fileName: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `Mol* could not read “${fileName}”: ${detail}. The file stayed in `
    + "this browser — nothing was fetched and nothing was sent.";
}

export default function MolstarViewer(
  { file, onClose, onStatus }: SpecialistViewerProps,
) {
  const frame = useRef<HTMLDivElement | null>(null);
  const surface = useRef<HTMLCanvasElement | null>(null);
  const [choice, setChoice] = useState<Representation>("auto");
  const [report, setReport] = useState<SpecialistReport | null>(null);

  /*
   * One effect owns the whole plugin, and changing the representation tears it
   * down and rebuilds it.
   *
   * That re-reads and re-parses the file, which is the slower of the two
   * designs — the other keeps the parsed structure and swaps only the
   * representation node in Mol*'s state tree. It is chosen anyway because it
   * has exactly one lifecycle: every path that creates a plugin is the path
   * that disposes it. A half-updated state tree, or a representation left
   * behind by a switch that failed, is a viewer showing something that is no
   * longer what the controls say it is, and that is the failure this whole
   * seam exists to keep out.
   */
  useEffect(() => {
    let live = true;
    // Assigned several awaits into the async body below; the cleanup can run
    // first, so it is declared out here and disposed from there.
    let plugin: { dispose: () => void } | null = null;

    const announce = (next: SpecialistReport) => {
      if (!live) return;
      setReport(next);
      onStatus?.(next);
    };

    setReport(null);

    if (file === undefined) {
      announce({ drawn: false, because: NOTHING_CHOSEN });
      return;
    }

    const format = formatOf(file.name);
    if (format === null) {
      announce({ drawn: false, because: unreadable(file.name) });
      return;
    }

    // Before the library, not after: Mol* given no context fails deep inside
    // its renderer with a message about a shader, and the people this actually
    // happens to are on remote desktops rather than debugging one.
    const blocked = requireWebGL(frame.current);
    if (blocked !== null) {
      announce({ drawn: false, because: blocked });
      return;
    }

    void (async () => {
      try {
        // Dynamic, and only from here: a static import would put Mol* in the
        // first load for every researcher who never opens a structure.
        const { PluginContext } = await import("molstar/lib/mol-plugin/context");
        const { PluginSpec } = await import("molstar/lib/mol-plugin/spec");
        const { PluginBehaviors } = await import("molstar/lib/mol-plugin/behavior");
        if (!live) return;

        const created = new PluginContext({
          // Empty on purpose. Every built-in Mol* action that can reach a
          // server lives in this list, and an unregistered action cannot be
          // invoked by anything.
          actions: [],
          behaviors: [
            PluginSpec.Behavior(PluginBehaviors.Representation.HighlightLoci),
            PluginSpec.Behavior(PluginBehaviors.Camera.FocusLoci),
          ],
        });
        plugin = created;

        // The cleanup below disposes `plugin`, but only what existed when it
        // ran. Everything after an await here may be resuming into a viewer
        // that has already been closed, and a WebGL context is a limited
        // resource in every browser: leaking one per abandoned load is how a
        // viewer stops opening at all after a dozen files.
        const abandoned = () => {
          if (live) return false;
          created.dispose();
          return true;
        };

        await created.init();
        if (abandoned()) return;

        const canvas = surface.current;
        const container = frame.current;
        if (canvas === null || container === null) {
          // Should not happen — both are rendered unconditionally — so say so
          // rather than sit on "Reading…" forever if it ever does.
          created.dispose();
          announce({ drawn: false, because: NO_CANVAS });
          return;
        }

        const started = await created.initViewerAsync(canvas, container);
        if (abandoned()) return;
        if (!started) {
          announce({ drawn: false, because: NO_CANVAS });
          return;
        }

        const bytes = format.binary
          ? await file.arrayBuffer()
          : await file.text();
        if (abandoned()) return;

        const data = await created.builders.data.rawData({
          data: bytes, label: file.name,
        });
        const trajectory = await created.builders.structure
          .parseTrajectory(data, format.parser);
        const model = await created.builders.structure.createModel(trajectory);
        // `model` rather than the default `assembly`: the researcher opened a
        // file, and what is drawn should be what the file holds rather than a
        // biological assembly generated from it — otherwise the atom count
        // reported below describes something they cannot find in their data.
        const built = await created.builders.structure
          .createStructure(model, { name: "model", params: {} });
        if (abandoned()) return;

        const structure = built.data;
        if (!structure) {
          // Refusing means the frame is hidden, and a plugin left running
          // behind a hidden frame holds a WebGL context and an animation loop
          // for something nobody can see. Switching the representation builds
          // a fresh one, so there is nothing to keep this for.
          created.dispose();
          announce({ drawn: false, because: noStructure(file.name) });
          return;
        }

        const counts = countStructure(structure);
        const drawnAs = resolveRepresentation(choice, counts);
        const verdict = verdictFor(counts, drawnAs, file.name);

        if (!verdict.drawn) {
          created.dispose();
          announce(verdict);
          return;
        }

        await created.builders.structure.representation.addRepresentation(
          built, { type: drawnAs, color: COLOUR[drawnAs] });
        created.managers.camera.reset();
        announce(verdict);
      } catch (cause) {
        plugin?.dispose();
        announce({ drawn: false, because: parseFailed(file.name, cause) });
      }
    })();

    return () => {
      live = false;
      plugin?.dispose();
    };
  }, [file, onStatus, choice]);

  const drawn = report !== null && report.drawn;
  const refusal = report !== null && !report.drawn ? report.because : null;
  const opening = file !== undefined && report === null;
  const showing = opening || drawn;
  const format = file === undefined ? null : formatOf(file.name);

  return (
    <figure className={showing ? "chart" : "chart chart-refused"}>
      {/*
        The frame stays mounted in every state, refusals included. `requireWebGL`
        probes the document this element belongs to, so a viewer that removed
        its own mount point would have nothing to probe when the next file
        arrives. It is collapsed and hidden rather than absent — an empty frame
        with a border reads as an empty file, which is the one thing it must
        never be mistaken for.
      */}
      <div
        ref={frame}
        style={{
          position: "relative",
          width: "100%",
          height: showing ? 420 : 0,
          display: showing ? "block" : "none",
        }}
      >
        <canvas
          ref={surface}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
          }}
        />
      </div>

      {opening && file !== undefined && (
        <p className="spatial-note">
          Reading {file.name} with Mol*, in this browser.
        </p>
      )}

      {!showing && (
        <p className="chart-refusal">{refusal ?? NOTHING_CHOSEN}</p>
      )}

      {file !== undefined && format !== null && (
        <p className="chart-refusal-detail">
          {file.name} → Mol* “{format.parser}” parser
        </p>
      )}

      {format !== null && (
        <div className="spatial-row">
          <label>
            Drawn as{" "}
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value as Representation)}
            >
              {REPRESENTATIONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {onClose !== undefined && (
        <button type="button" className="spatial-quiet" onClick={onClose}>
          Close this viewer
        </button>
      )}

      <figcaption className="chart-caption">
        Drag to rotate, scroll to zoom. The file is read in this browser and
        goes nowhere: no structure can be fetched by accession here, because no
        action that could fetch one is registered in this plugin.
      </figcaption>
    </figure>
  );
}
