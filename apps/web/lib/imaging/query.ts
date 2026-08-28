/**
 * Finding scans by how they were acquired.
 *
 * The way this workflow scales. A researcher with four hundred images cannot
 * read four hundred verdicts, and the obvious fix — rank them by similarity to
 * the case — is the thing this whole subsystem refuses, because appearance in
 * medical imaging is dominated by acquisition rather than by pathology and the
 * top of that list would be the scans taken on the same machine.
 *
 * So the query is over the *acquisition* instead: "every portal-venous CT at a
 * millimetre or under". Same facts the verdict rests on, asked as a question
 * rather than answered as a judgement, which means a large library narrows to a
 * handful without anything being scored.
 *
 * **Three outcomes, not two.** A scan whose modality was never recorded is not
 * a CT and is not *not* a CT. Dropping it silently would be the same error the
 * comparability engine exists to refuse, inverted: there, silence must not be
 * read as agreement; here, silence must not be read as exclusion. A query that
 * reports twelve matches while quietly discarding forty unreadable headers is
 * lying by omission, and the forty are usually the ones worth opening.
 *
 * **Nothing is ordered by closeness.** Results keep the order the caller gave
 * them. An ordered list of scans near a case is a differential diagnosis
 * whatever it is labelled.
 */

import {
  AXIS_LABEL, Axis, ContrastPhase, Fact, Modality, Study, Weighting,
} from "./study";
import { SPACING_TOLERANCE, THICKNESS_TOLERANCE } from "./comparability";

export type Criterion =
  | { axis: "modality"; oneOf: Modality[] }
  | { axis: "weighting"; oneOf: Weighting[] }
  | { axis: "contrast"; oneOf: ContrastPhase[] }
  | { axis: "orientation"; oneOf: Array<"axial" | "coronal" | "sagittal" | "oblique"> }
  | { axis: "sliceThickness"; atMost: number }
  | { axis: "pixelSpacing"; atMost: number }
  | { axis: "fieldStrength"; equals: number };

export type Query = Criterion[];

/** How one scan answered one criterion. */
export type Answer = "yes" | "no" | "unknown";

export type Row = {
  study: Study;
  /** Criteria this scan failed, for saying why it is not in the result. */
  failed: Axis[];
  /** Criteria it could not answer, because the fact was never recorded. */
  silent: Axis[];
  /**
   * Whether any criterion it satisfied rested on a value somebody typed.
   *
   * A match on a declared fact is a weaker match, and the difference is worth
   * carrying: it is the researcher's own claim being checked against itself.
   */
  onDeclared: boolean;
};

export type Result = {
  /** Answered every criterion, and satisfied them. */
  matched: Row[];
  /** Failed at least one criterion on a recorded fact. */
  excluded: Row[];
  /** Satisfied everything it could answer, and could not answer all of it. */
  uncertain: Row[];
};

/** Whether one scan satisfies one criterion. */
export function answer(study: Study, criterion: Criterion): Answer {
  const fact = study[criterion.axis] as Fact<unknown>;
  if (fact.value === null) return "unknown";

  switch (criterion.axis) {
    case "modality": case "weighting": case "contrast": case "orientation":
      return (criterion.oneOf as unknown[]).includes(fact.value) ? "yes" : "no";
    case "sliceThickness": case "pixelSpacing":
      // "At most" with a hair of slack, matching the ratio the verdict engine
      // uses — so a query and a verdict cannot disagree about 1.0 against 1.25.
      return Number(fact.value) <= criterion.atMost * 1.0001 ? "yes" : "no";
    case "fieldStrength":
      // Field strengths are nominal; near equality is equality.
      return Math.abs(Number(fact.value) - criterion.equals) < 0.2 ? "yes" : "no";
  }
}

/**
 * Run a query over a library.
 *
 * Order is preserved throughout. Nothing here sorts, because the only sort
 * available would be by how near a scan is to the case, and that is the ranking
 * this subsystem exists without.
 */
export function run(query: Query, studies: Study[]): Result {
  const result: Result = { matched: [], excluded: [], uncertain: [] };

  for (const study of studies) {
    const failed: Axis[] = [];
    const silent: Axis[] = [];
    let onDeclared = false;

    for (const criterion of query) {
      const verdict = answer(study, criterion);
      if (verdict === "no") failed.push(criterion.axis);
      else if (verdict === "unknown") silent.push(criterion.axis);
      else if ((study[criterion.axis] as Fact<unknown>).origin === "declared") {
        onDeclared = true;
      }
    }

    const row: Row = { study, failed, silent, onDeclared };
    /*
     * A recorded failure outranks a silence. A scan that is definitely an MR
     * belongs in "excluded" even if its slice thickness is missing — knowing
     * one thing for certain is enough to answer, and putting it in "uncertain"
     * would ask the researcher to open a file whose answer is already known.
     */
    if (failed.length > 0) result.excluded.push(row);
    else if (silent.length > 0) result.uncertain.push(row);
    else result.matched.push(row);
  }
  return result;
}

/**
 * A query describing how this case was acquired.
 *
 * Built only from what the case actually records: an axis the case is silent
 * about places no constraint, because filtering a library by a fact you do not
 * have is filtering by a guess.
 *
 * The thresholds match the verdict engine's tolerances deliberately, so
 * "everything this query returns" and "everything the partition calls directly
 * comparable" are the same set. Two answers to the same question that disagreed
 * would make both untrustworthy — and a test holds them together.
 */
export function fromCase(study: Study): Query {
  const query: Query = [];

  if (study.modality.value !== null) {
    query.push({ axis: "modality", oneOf: [study.modality.value] });
  }
  if (study.weighting.value !== null) {
    query.push({ axis: "weighting", oneOf: [study.weighting.value] });
  }
  if (study.contrast.value !== null) {
    query.push({ axis: "contrast", oneOf: [study.contrast.value] });
  }
  if (study.orientation.value !== null) {
    query.push({ axis: "orientation", oneOf: [study.orientation.value] });
  }
  if (study.sliceThickness.value !== null) {
    query.push({ axis: "sliceThickness",
                 atMost: study.sliceThickness.value * THICKNESS_TOLERANCE });
  }
  if (study.pixelSpacing.value !== null) {
    query.push({ axis: "pixelSpacing",
                 atMost: study.pixelSpacing.value * SPACING_TOLERANCE });
  }
  if (study.fieldStrength.value !== null) {
    query.push({ axis: "fieldStrength", equals: study.fieldStrength.value });
  }
  return query;
}

/** The query in words, so a reader can check it says what they meant. */
export function describeQuery(query: Query): string {
  if (query.length === 0) {
    return "No constraints: every scan is returned, because nothing was asked.";
  }
  const parts = query.map((criterion) => {
    const name = AXIS_LABEL[criterion.axis];
    if ("oneOf" in criterion) {
      return criterion.oneOf.length === 1
        ? `${name} is ${criterion.oneOf[0]}`
        : `${name} is one of ${criterion.oneOf.join(", ")}`;
    }
    if ("atMost" in criterion) {
      return `${name} is at most ${Number(criterion.atMost.toFixed(2))} mm`;
    }
    return `${name} is ${criterion.equals} T`;
  });
  return `${parts.join("; ")}.`;
}

/**
 * The result in words, with the unanswerable scans counted.
 *
 * The uncertain count is the number that must not be swallowed. A researcher
 * told "12 of 400" concludes the other 388 were considered and rejected; told
 * "12 matched, 41 could not be judged", they know where to look next.
 */
export function describeResult(result: Result): string {
  const total = result.matched.length + result.excluded.length
              + result.uncertain.length;
  if (total === 0) return "Nothing in the library to search.";

  let text = `${result.matched.length} of ${total} match`;
  if (result.uncertain.length > 0) {
    text += `. ${result.uncertain.length} cannot be judged — they satisfy `
          + "everything they record and do not record the rest, so they are "
          + "neither included nor ruled out";
  }
  if (result.excluded.length > 0) {
    text += `. ${result.excluded.length} differ on something recorded`;
  }
  const weak = result.matched.filter((r) => r.onDeclared).length;
  if (weak > 0) {
    text += `. ${weak} match on a value that was typed rather than read from `
          + "the file";
  }
  return `${text}.`;
}

/**
 * A list as a person would say it: "a", "a and b", "a, b and c".
 *
 * Joining with "and" throughout reads as carelessness — and on a screen whose
 * whole claim is that it was careful about what it excluded, that is the
 * sentence a sceptical reader is looking at hardest.
 */
function asList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Why one scan is not in the result, in words a researcher can act on. */
export function explainRow(row: Row): string {
  if (row.failed.length > 0) {
    return `Differs on ${asList(row.failed.map((a) => AXIS_LABEL[a]))}.`;
  }
  if (row.silent.length > 0) {
    return `Does not record ${asList(row.silent.map((a) => AXIS_LABEL[a]))}`
         + " — it may well match, and nothing here can say so.";
  }
  return row.onDeclared
    ? "Matches, on at least one value that was stated rather than read."
    : "Matches on every constraint, all read from the file.";
}
