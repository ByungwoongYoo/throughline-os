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

import { Acquisition, Axis, Fact } from "./study";
import { domainOf } from "./domain";

/**
 * One constraint, on one axis, in whatever discipline named it.
 *
 * Open on the axis rather than a closed union of radiology's seven, so a
 * microscopist can narrow to a channel and a preparation the same way. The
 * three shapes are the three ways the profiles compare anything: a set a value
 * must be in, a ceiling it must be under, and a nominal value it must be at.
 */
type Named = {
  /** The discipline's word for this axis. Falls back to the key. */
  label?: string;
  /** The unit the number is in, where it has one. */
  unit?: string;
};

export type Criterion =
  | ({ axis: Axis; oneOf: unknown[] } & Named)
  | ({ axis: Axis; atMost: number } & Named)
  /** `within` is the axis's own tolerance; absent means exact equality. */
  | ({ axis: Axis; equals: number; within?: number } & Named);

export type Query = Criterion[];

/** How one scan answered one criterion. */
export type Answer = "yes" | "no" | "unknown";

export type Row = {
  study: Acquisition;
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
export function answer(acquisition: Acquisition, criterion: Criterion): Answer {
  const fact = acquisition[criterion.axis] as Fact<unknown> | undefined;
  if (fact === undefined || fact.value === null) return "unknown";

  /*
   * Decided by the shape of the constraint rather than by the name of the
   * axis, so a channel and a modality are answered by one line of code and a
   * discipline can be added without touching this function.
   */
  if ("oneOf" in criterion) {
    // Folded for the same reason the verdict folds free text, so a query and a
    // verdict cannot disagree about "DAPI" against "dapi".
    const fold = (v: unknown) => String(v).trim().toLowerCase();
    return criterion.oneOf.some((v) => v === fact.value
                                    || fold(v) === fold(fact.value))
      ? "yes" : "no";
  }
  if ("atMost" in criterion) {
    // "At most" with a hair of slack, matching the ratio the verdict engine
    // uses — so a query and a verdict cannot disagree about 1.0 against 1.25.
    return Number(fact.value) <= criterion.atMost * 1.0001 ? "yes" : "no";
  }
  /*
   * A nominal value, so near equality is equality: 1.5 T is written as 1.494
   * by some scanners and is still 1.5 T.
   *
   * The tolerance is the axis's own — 0.2 T for a magnet, 0.05 for a numerical
   * aperture — taken from the acquisition's profile when the criterion does not
   * carry one. Not a constant: a number chosen for magnets, applied to an
   * aperture, would quietly call two different lenses the same.
   */
  const slack = criterion.within
    ?? nominalTolerance(acquisition, criterion.axis);
  return Math.abs(Number(fact.value) - criterion.equals) <= slack ? "yes" : "no";
}

/** The tolerance the profile itself uses for a nominal axis, or exact. */
function nominalTolerance(acquisition: Acquisition, axis: Axis): number {
  const spec = domainOf(acquisition.domain).axes.find((a) => a.key === axis);
  return spec?.match.kind === "near" ? spec.match.epsilon : 0;
}

/**
 * Run a query over a library.
 *
 * Order is preserved throughout. Nothing here sorts, because the only sort
 * available would be by how near a scan is to the case, and that is the ranking
 * this subsystem exists without.
 */
export function run(query: Query, studies: Acquisition[]): Result {
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
export function fromCase(acquisition: Acquisition): Query {
  const query: Query = [];
  for (const axis of domainOf(acquisition.domain).axes) {
    const fact = acquisition[axis.key] as Fact<unknown> | undefined;
    if (fact === undefined || fact.value === null) continue;
    if (axis.match.kind === "ratio") {
      // The same tolerance the verdict uses, so "narrow to this acquisition"
      // and "is this comparable" cannot disagree about what counts as close.
      query.push({ axis: axis.key, label: axis.label, unit: axis.unit,
                   atMost: Number(fact.value) * axis.match.tolerance });
    } else if (axis.match.kind === "near") {
      query.push({ axis: axis.key, label: axis.label, unit: axis.unit,
                   equals: Number(fact.value), within: axis.match.epsilon });
    } else {
      query.push({ axis: axis.key, label: axis.label, unit: axis.unit,
                   oneOf: [fact.value] });
    }
  }
  return query;
}

/** The query in words, so a reader can check it says what they meant. */
export function describeQuery(query: Query): string {
  if (query.length === 0) {
    return "No constraints: every scan is returned, because nothing was asked.";
  }
  const parts = query.map((criterion) => {
    const name = criterion.label ?? criterion.axis;
    if ("oneOf" in criterion) {
      return criterion.oneOf.length === 1
        ? `${name} is ${criterion.oneOf[0]}`
        : `${name} is one of ${criterion.oneOf.join(", ")}`;
    }
    if ("atMost" in criterion) {
      const unit = criterion.unit === undefined ? "" : ` ${criterion.unit}`;
      return `${name} is at most ${Number(criterion.atMost.toFixed(2))}${unit}`;
    }
    const unit = criterion.unit === undefined ? "" : ` ${criterion.unit}`;
    return `${name} is ${criterion.equals}${unit}`;
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
  // Named by the row's own discipline, so a micrograph is not told it differs
  // on "sequence weighting".
  const axes = domainOf(row.study.domain).axes;
  const label = (key: Axis) =>
    axes.find((a) => a.key === key)?.label ?? key;
  if (row.failed.length > 0) {
    return `Differs on ${asList(row.failed.map(label))}.`;
  }
  if (row.silent.length > 0) {
    return `Does not record ${asList(row.silent.map(label))}`
         + " — it may well match, and nothing here can say so.";
  }
  return row.onDeclared
    ? "Matches, on at least one value that was stated rather than read."
    : "Matches on every constraint, all read from the file.";
}
