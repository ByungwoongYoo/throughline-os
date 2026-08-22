"""Checks that run before anything serves, so a failure explains itself.

There is one of these so far, and it earned its place by being found the hard
way: on an ARM machine the container starts, connects, runs DDL happily, and
then dies on `CREATE EXTENSION vector` with a psycopg traceback about the server
closing the connection unexpectedly. Nothing in that output mentions
architecture, so the reasonable conclusions are all wrong — a corrupt volume, a
broken image, a bug in the migration.

What is actually happening is that `pgvector` is compiled C using SIMD
instructions, and it does not survive qemu's x86-64 emulation. Docker Desktop on
an Apple Silicon Mac emulates x86-64 for this image, so the extension crashes the
backend it is being loaded into. The rest of PostgreSQL is fine, which is exactly
why the failure is so confusing: everything works until the one thing that does
not.

This cannot be fixed here. `pgserver` publishes no linux-aarch64 wheel, so the
image is x86-64 by necessity (see the Dockerfile), and under emulation pgvector
crashes. The honest response is to say so immediately, name the cause, and point
at the install route that does work — rather than crash-looping and letting
someone spend an evening on their volume.
"""

from __future__ import annotations

EMULATION_ADVICE = """
Throughline cannot start: the vector extension crashed the embedded PostgreSQL.

  This is almost certainly an architecture problem rather than a broken
  installation. This image is x86-64 — the embedded PostgreSQL it is built
  around publishes no Linux ARM build — so on an ARM host (Docker on an Apple
  Silicon Mac, or an ARM server) it runs under emulation. PostgreSQL itself is
  fine under emulation; pgvector, which is compiled C using SIMD instructions,
  is not, and it takes the server down as it loads.

  Nothing is wrong with your data or your volume.

  On an Apple Silicon Mac, install natively instead — it is also considerably
  faster than the container would have been:

      ./scripts/bootstrap.sh

  On an x86-64 machine, this error means something else and the container log
  above is the place to look.
""".strip()


def vector_extension_works() -> str | None:
    """Return None if the vector extension loads, or a message explaining why not.

    Deliberately opens its own connection and swallows a broad exception. A
    crashed backend surfaces as any of several psycopg errors depending on
    exactly when the server died, and matching on the type would make this
    silent for the variants it did not anticipate — the failure it exists to
    describe is precisely the one that arrives in an unexpected shape.
    """
    try:
        from .db import transaction

        with transaction() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
    except Exception:  # noqa: BLE001
        return EMULATION_ADVICE
    return None


def main() -> int:
    problem = vector_extension_works()
    if problem is None:
        return 0
    print(problem, flush=True)
    return 1


def boot() -> int:
    """Check, then migrate, in one process.

    Deliberately one process rather than two shell steps. Each Python process
    that touches the database starts its own embedded PostgreSQL and stops it on
    exit, so a separate preflight step would start the server, stop it, and have
    migrations start it again — two extra cluster lifecycles on every container
    boot, for a check that takes a second. Sharing the process shares the server.
    """
    problem = main()
    if problem:
        return problem

    from .migrate import migrate

    applied = migrate()
    print("migrations:", ", ".join(applied) if applied else "up to date",
          flush=True)
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through serve.sh
    import os
    import sys

    code = boot()
    sys.stdout.flush()
    sys.stderr.flush()
    if code:
        # `os._exit` on the failure path only, and deliberately.
        #
        # The server has already crashed by this point, so there is nothing to
        # clean up — but `pgserver` registers an atexit handler that tries to
        # stop it anyway, and that handler spends a minute failing and then
        # prints twenty lines of connection errors and "server does not shut
        # down". All of it lands *after* the explanation, so the last thing on
        # screen is the confusing output this check exists to replace. Exiting
        # immediately keeps the guidance as the final word.
        os._exit(code)
    raise SystemExit(code)
