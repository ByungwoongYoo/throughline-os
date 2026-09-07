"use client";

/**
 * Stating what the file did not record.
 *
 * The engine has always had three kinds of evidence — read from a header,
 * stated by a person, and unknown — and `evidenceStrength` has always counted a
 * stated fact for half a read one, and `text()` has always rendered it as
 * "stated, not read from the file". None of that was reachable. There was no
 * way for a researcher to state anything, so a third of the provenance model
 * existed only in the synthetic example, and every comparison of real files
 * came back "cannot be judged" the moment an axis was silent.
 *
 * That bites hardest outside radiology, which is how it went unnoticed. A DICOM
 * header states nearly everything. OME-TIFF states most of it — but not
 * preparation, because OME has no field for whether a specimen was fixed or
 * live, and preparation decides *what is present to be imaged*. So a
 * microscopist with two perfectly comparable images was permanently told they
 * could not be judged, and nothing on the screen let them say otherwise.
 *
 * **What is read is never editable here.** Only silent axes are offered. A
 * header fact and a person's recollection are different evidence, and letting
 * the second quietly overwrite the first would destroy the distinction the
 * whole engine is built on — with no way afterwards to tell which verdicts
 * rested on which.
 *
 * **It knows no discipline.** The fields come from the profile's axes, so a new
 * profile gets this screen for free and this file never learns what a channel
 * or a contrast phase is.
 */

import { useId } from "react";
import { Domain } from "@/lib/imaging/domain";
import { Acquisition, Fact, declared, unknown } from "@/lib/imaging/study";

export type DeclareProps = {
  acquisition: Acquisition;
  domain: Domain;
  /** Given the axis and the new value, or null to withdraw a statement. */
  onDeclare: (axis: string, value: string | number | null) => void;
};

const factOf = (a: Acquisition, key: string): Fact<unknown> =>
  (a[key] as Fact<unknown> | undefined) ?? unknown<unknown>();

export function Declare({ acquisition, domain, onDeclare }: DeclareProps) {
  const group = useId();

  /*
   * Silent and stated axes only. An axis read from the file is shown by the
   * comparability panel already, and is not this component's business.
   */
  const open = domain.axes.filter((axis) => {
    const fact = factOf(acquisition, axis.key);
    return fact.origin !== "header";
  });

  if (open.length === 0) {
    return (
      <p className="case-note">
        Every axis this comparison rests on was read from the file. Nothing to
        state.
      </p>
    );
  }

  return (
    <div className="declare">
      <p className="case-note">
        {open.length === domain.axes.length
          ? `This file recorded none of what a ${domain.noun} comparison rests `
            + "on."
          : `${open.length} of the ${domain.axes.length} axes were not recorded.`}
        {" "}You can state them, and anything you state is marked as stated
        rather than read — it counts for half as much, and every verdict resting
        on one says so.
      </p>

      {open.map((axis) => {
        const fact = factOf(acquisition, axis.key);
        const stated = fact.origin === "declared";
        const value = fact.value === null ? "" : String(fact.value);
        const id = `${group}-${axis.key}`;
        const numeric = axis.match.kind === "ratio" || axis.match.kind === "near";

        return (
          <div key={axis.key} className="declare-row">
            <label htmlFor={id}>
              {axis.label}
              {axis.unit !== undefined && ` (${axis.unit})`}
            </label>

            {axis.options === undefined ? (
              <input
                id={id}
                type={numeric ? "number" : "text"}
                step={numeric ? "any" : undefined}
                value={value}
                placeholder="not recorded"
                onChange={(event) => {
                  const next = event.target.value;
                  onDeclare(axis.key,
                    next === "" ? null : numeric ? Number(next) : next);
                }}
              />
            ) : (
              /*
               * A list rather than a free field wherever the axis has a closed
               * vocabulary — the difference between an engine and a spell
               * checker, and the reason `Modality` is a union.
               */
              <select
                id={id}
                value={value}
                onChange={(event) => onDeclare(
                  axis.key, event.target.value === "" ? null : event.target.value)}
              >
                <option value="">not recorded</option>
                {axis.options.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            )}

            {stated && <span className="declare-stated">stated</span>}
            <p className="declare-why">{axis.note}</p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Apply a statement to an acquisition.
 *
 * Refuses to touch an axis the file recorded, and that refusal is the point
 * rather than a guard against a mistake: a header fact outranks a recollection,
 * and a screen that let the second overwrite the first would leave no way to
 * tell afterwards which verdicts rested on which.
 */
export function withDeclared(
  acquisition: Acquisition, axis: string, value: string | number | null,
): Acquisition {
  const existing = (acquisition[axis] as Fact<unknown> | undefined);
  if (existing?.origin === "header") return acquisition;
  return {
    ...acquisition,
    [axis]: value === null ? unknown<unknown>() : declared(value),
  };
}
