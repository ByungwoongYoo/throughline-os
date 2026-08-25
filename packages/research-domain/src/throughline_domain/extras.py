"""The feature packs a researcher can turn on, and what each one costs them.

The base install carries what everybody needs. Everything else is an extra that
is declared, reported as absent, and installable on demand — the architecture
already worked, it simply had no single place that knew about it. `datasets.py`
had the good version for file formats: an unreadable `.parquet` is reported as
*"needs the parquet extra"* and never as *"unreadable"*, because those are
different facts to somebody deciding whether to convert their file. This
generalises that to every optional capability rather than only the ones that
happen to be file formats.

Before this, `/api/system/capabilities` reported formats properly and said
nothing whatsoever about the graph driver, local transcription, figure
digitising or the hosted model client. Four capabilities a researcher could not
discover except by trying them and reading an error — which for speech meant a
503 naming a Python module. That gap was recorded as D032; this closes it.

**The probe is `find_spec`, not an import.** Asking whether a module can be
found costs a path search; importing it costs whatever the module does at import
time, and for torch that is seconds and hundreds of megabytes of RSS. A
capabilities endpoint that the interface polls must not be the thing that loads
the machine-learning stack.

**Every pack states what is withheld, not only what is gained.** "Semantic
search unavailable" is a fact about the software; "search falls back to lexical,
so a query finds the word and not the meaning" is a fact about the researcher's
results, and it is the second one that tells them whether the download is worth
it. The same standard the retrieval note already met.

**Sizes are stated, and they are the reason this exists.** `speech` pulls in
torch, which is gigabytes — an order of magnitude more than everything else on
this list combined. A researcher on a metered connection or a small laptop is
entitled to know that before the progress bar starts, not after.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Pack:
    """One installable capability.

    `module` is what `find_spec` looks for and is deliberately the *import*
    name rather than the distribution name — they differ often enough
    (`opencv-python-headless` imports as `cv2`, `pyshp` as `shapefile`,
    `openai-whisper` as `whisper`) that conflating them is a bug waiting for a
    quiet afternoon.
    """

    name: str
    distribution: str
    module: str
    enables: str
    withheld: str
    approximate_size: str


#: Every pip extra this product declares, in one place.
#:
#: Deliberately **not** including the `formats` bundle from
#: `throughline-ingestion`: it is a convenience alias for the five format packs
#: below it, and offering both a bundle and its members on the same screen means
#: a researcher can install the same thing twice and wonder which one worked.
#:
#: Deliberately **not** including the local embedding model either. It is
#: optional and it is reported, but it is a model download rather than a pip
#: extra — `embeddings.model_dir()` owns it, and pretending one mechanism is the
#: other would produce an install button that runs the wrong command.
PACKS: tuple[Pack, ...] = (
    Pack("parquet", "throughline-ingestion", "pyarrow",
         "Reading .parquet, .feather and .arrow datasets.",
         "Those files are reported as needing this extra rather than opened.",
         "~156 MB"),
    Pack("rds", "throughline-ingestion", "pyreadr",
         "Reading R's .rds, .rdata and .rda files.",
         "An R workspace cannot be opened; export to .csv is the alternative.",
         "~20 MB"),
    Pack("hdf5", "throughline-ingestion", "tables",
         "Reading .h5 and .hdf5 containers.",
         "HDF5 files are reported as needing this extra.",
         "~30 MB"),
    Pack("netcdf", "throughline-ingestion", "xarray",
         "Reading .nc, the n-dimensional array format climate and ocean data "
         "arrives in.",
         "NetCDF files cannot be opened.",
         "~40 MB"),
    Pack("geo", "throughline-ingestion", "shapefile",
         "Reading shapefiles, zipped or loose.",
         "Geographic boundaries cannot be read from .shp.",
         "~2 MB"),
    Pack("graph", "throughline-domain", "neo4j",
         "Projecting the knowledge graph into Neo4j for graph queries.",
         "Nothing on the provenance path is lost — ADR 0002 makes the "
         "projection derived, never the source of a fact, and PostgreSQL "
         "answers the same questions more slowly.",
         "~5 MB, plus a Neo4j server you run yourself"),
    Pack("speech", "throughline-domain", "whisper",
         "Transcribing recorded audio locally, so speech and gesture land on "
         "one clock.",
         "Dictation is unavailable and typing is the alternative — which the "
         "voice timeline supports, at the cost of not being able to gesture "
         "while speaking.",
         "**gigabytes** — it pulls in torch"),
    Pack("digitise", "throughline-domain", "cv2",
         "Reading data points off a published figure, and comparing two images.",
         "A figure in a PDF stays a picture; its numbers must be typed in.",
         "~90 MB"),
    Pack("anthropic", "throughline-model", "anthropic",
         "Talking to a hosted Claude model instead of a local one.",
         "The workspace reports no provider configured and every assistant "
         "surface stays inert. Nothing else is affected — and nothing leaves "
         "this machine, which for some researchers is the point.",
         "~2 MB"),
)

BY_NAME: dict[str, Pack] = {pack.name: pack for pack in PACKS}


def installed(pack: Pack) -> bool:
    """Whether this installation already has it.

    `find_spec` rather than an import: see the module docstring. It can raise
    for a package whose parent is itself missing, which is a broken install
    rather than an absent extra — either way the honest answer here is "no".
    """
    try:
        return importlib.util.find_spec(pack.module) is not None
    except (ImportError, ValueError):
        return False


def install_command(pack: Pack) -> str:
    """The command that turns it on, quoted so a shell does not eat the bracket.

    Square brackets are a glob in every POSIX shell, so an unquoted
    `pip install throughline-domain[graph]` silently installs nothing whenever a
    file called `throughline-domaing` happens to exist, and installs the plain
    distribution the rest of the time. Quoting it is not fussiness.
    """
    return f"pip install '{pack.distribution}[{pack.name}]'"


def availability() -> dict[str, dict[str, Any]]:
    """Every pack and its state here — the shape the capabilities screen reads.

    `install` is None when a pack is present, for the same reason
    `format_availability` does it: a command offered for something already
    installed is an invitation to a confusing no-op.
    """
    report: dict[str, dict[str, Any]] = {}
    for pack in PACKS:
        here = installed(pack)
        report[pack.name] = {
            "installed": here,
            "distribution": pack.distribution,
            "enables": pack.enables,
            # Stated whether or not it is installed: somebody deciding to
            # *remove* one deserves the same sentence as somebody adding it.
            "withheld_without_it": pack.withheld,
            "approximate_size": pack.approximate_size,
            "install": None if here else install_command(pack),
        }
    return report


# ---------------------------------------------------------------------------
# Turning one on
# ---------------------------------------------------------------------------

import subprocess  # noqa: E402  (kept beside the code that needs it)
import sys  # noqa: E402
import threading  # noqa: E402


class UnknownPack(KeyError):
    """A name that is not one of ours. Never reaches pip."""


@dataclass
class Install:
    """The progress of one install. `installed()` remains the ground truth.

    Deliberately in memory and deliberately not in the work queue. The queue is
    drained by a separate worker process, and T010 exists because that worker is
    not always running — an install that silently waits forever for a drain is a
    worse answer than one that dies with the process that started it. Losing
    this on restart costs a progress bar; it cannot cost correctness, because
    every reader of "is it installed?" asks `find_spec` rather than this.
    """

    pack: str
    state: str = "running"          # running | installed | failed
    detail: str = ""


_installs: dict[str, Install] = {}
_installs_lock = threading.Lock()


def install_status(name: str) -> Install | None:
    with _installs_lock:
        return _installs.get(name)


def _pip_arguments(pack: Pack) -> list[str]:
    """The exact argv. A list and never a string, and never through a shell.

    This is the one place in the product where a name that came from a client
    could become a command. It cannot: `name` was looked up in `BY_NAME` before
    reaching here, so the only strings that can appear are the nine literals in
    `PACKS`. The argument is still assembled as a list rather than interpolated
    into a command line, because a guard that depends on an earlier guard is one
    refactor away from not being a guard at all.
    """
    return [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
            f"{pack.distribution}[{pack.name}]"]


def install_now(name: str, *, runner=subprocess.run) -> Install:
    """Install one pack synchronously. Returns its final state.

    `runner` is injected so the tests can drive every branch without a network
    and without mutating the virtualenv the suite is running in — installing
    torch to prove a code path is not a test, it is an outage.
    """
    pack = BY_NAME.get(name)
    if pack is None:
        raise UnknownPack(name)

    record = Install(pack=name)
    with _installs_lock:
        _installs[name] = record

    try:
        result = runner(_pip_arguments(pack), capture_output=True, text=True)
    except OSError as error:
        record.state = "failed"
        record.detail = f"Could not start pip: {error}"
        return record

    if result.returncode != 0:
        record.state = "failed"
        # The tail, not the whole log: pip's output is long and the reason is at
        # the end, and this string goes to a screen rather than to a file.
        record.detail = (result.stderr or result.stdout or "").strip()[-800:]
        return record

    # Without this the interpreter keeps the negative result it cached the first
    # time something asked, and the capabilities screen goes on reporting the
    # pack as missing until the process restarts — which reads as "the install
    # did nothing" to the one person who just watched it succeed.
    importlib.invalidate_caches()

    if not installed(pack):
        record.state = "failed"
        record.detail = ("pip reported success but the module is still not "
                         f"importable ({pack.module}). The virtualenv pip "
                         "installed into may not be the one this is running "
                         "from.")
        return record

    record.state = "installed"
    record.detail = f"{pack.distribution}[{pack.name}] is available."
    return record


def install_in_background(name: str) -> Install:
    """Start an install and return immediately with its running record.

    Some of these are gigabytes; a request that waits for torch times out long
    before pip finishes, and the researcher is told the install failed while it
    is still going.
    """
    if name not in BY_NAME:
        raise UnknownPack(name)
    existing = install_status(name)
    if existing is not None and existing.state == "running":
        return existing

    record = Install(pack=name)
    with _installs_lock:
        _installs[name] = record

    threading.Thread(target=install_now, args=(name,), daemon=True,
                     name=f"install-{name}").start()
    return record
