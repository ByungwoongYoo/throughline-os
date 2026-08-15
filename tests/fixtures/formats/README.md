# Committed format fixtures

Everything else in this suite generates its fixtures at test time. These two are
the exception, and the exception is narrow: **nothing in Python writes a
`.sas7bdat` file.**

`pyreadstat` reads the format and writes `.sav`, `.por`, `.dta` and `.xpt`
instead, so there is no round-trip to run and no way to produce a sample when
the test starts. The choice was between committing a file and continuing to
advertise a format whose reader rested on nothing in this repository.

| File | What it is | Why it is here |
|---|---|---|
| `airline.sas7bdat` | 32 annual observations of an airline cost function; 6 numeric columns, each carrying a SAS column label. Written by SAS on 2008-05-13. | The only evidence in this repository that the `.sas7bdat` reader returns what SAS actually stored. |
| `corrupt.sas7bdat` | A valid SAS header with the rest of the file missing. | §104 — a truncated file must raise `UnsupportedDataset` with a sentence naming the problem, not `pyreadstat`'s own exception. This is what a failed download looks like, and it takes a different path through the reader than arbitrary nonsense bytes do. |

## Provenance

Both files come from the pandas test corpus
(`pandas/tests/io/sas/data/`), which is distributed under the
**BSD-3-Clause** licence. pandas in turn took `airline.sas7bdat` from a public
SAS example dataset.

Provenance is recorded because a committed binary that nobody can regenerate is
only as trustworthy as its stated origin — and because the next person to
wonder "can we just generate this?" deserves the answer without repeating the
search.
