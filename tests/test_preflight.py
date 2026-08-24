"""The check that turns an inscrutable crash into an explanation.

On an ARM host the container connects, runs DDL, and then dies on
`CREATE EXTENSION vector` with a psycopg traceback about the server closing the
connection. Nothing in that output mentions architecture, so every reasonable
conclusion is wrong. These tests are about what the researcher is told.
"""

from __future__ import annotations

import throughline_domain.preflight as preflight


def test_a_working_vector_extension_says_nothing():
    """Silence on success. A preflight that talks on the happy path is noise
    that gets skimmed, and then the one time it matters it is skimmed too."""
    assert preflight.vector_extension_works() is None


def test_a_crashed_backend_is_explained_rather_than_re_raised(monkeypatch):
    """The whole point: the failure arrives as an exception with no clue in it."""
    class Boom:
        def __enter__(self):
            raise RuntimeError("server closed the connection unexpectedly")

        def __exit__(self, *_):
            return False

    import throughline_domain.db as db
    monkeypatch.setattr(db, "transaction", lambda: Boom())

    message = preflight.vector_extension_works()

    assert message is not None
    # Names the cause, which the psycopg traceback never does.
    assert "emulation" in message.lower()
    assert "x86-64" in message
    # Says the data is fine, because the first fear is a corrupt volume.
    assert "Nothing is wrong with your data" in message
    # And gives the route that actually works.
    assert "bootstrap.sh" in message


def test_it_does_not_matter_which_error_the_crash_arrives_as(monkeypatch):
    """A dying backend surfaces as several different psycopg errors depending on
    exactly when it went. Matching on a type would leave this silent for the
    variants nobody predicted — which is the failure mode it exists to cover."""
    import throughline_domain.db as db

    for error in (RuntimeError, ValueError, OSError):
        class Boom:
            def __enter__(self, _error=error):
                raise _error("gone")

            def __exit__(self, *_):
                return False

        monkeypatch.setattr(db, "transaction", lambda: Boom())
        assert preflight.vector_extension_works() is not None


def test_main_reports_failure_through_its_exit_code(monkeypatch, capsys):
    """serve.sh runs under `set -e`, so the exit code is what stops the boot."""
    monkeypatch.setattr(preflight, "vector_extension_works", lambda: "broken")

    assert preflight.main() == 1
    assert "broken" in capsys.readouterr().out


def test_main_is_quiet_and_succeeds_when_all_is_well(monkeypatch, capsys):
    monkeypatch.setattr(preflight, "vector_extension_works", lambda: None)

    assert preflight.main() == 0
    assert capsys.readouterr().out == ""


def test_boot_refuses_to_migrate_when_the_check_failed(monkeypatch):
    """The ordering is the point: migrations must not run and bury the message."""
    monkeypatch.setattr(preflight, "main", lambda: 1)

    def explode():
        raise AssertionError("migrate must not run after a failed check")

    import throughline_domain.migrate as migrate_module
    monkeypatch.setattr(migrate_module, "migrate", explode)

    assert preflight.boot() == 1


def test_boot_migrates_when_the_check_passed(monkeypatch, capsys):
    monkeypatch.setattr(preflight, "main", lambda: 0)
    import throughline_domain.migrate as migrate_module
    monkeypatch.setattr(migrate_module, "migrate", lambda: ["0001_foundation"])

    assert preflight.boot() == 0
    assert "0001_foundation" in capsys.readouterr().out


def test_boot_says_so_when_there_is_nothing_to_apply(monkeypatch, capsys):
    monkeypatch.setattr(preflight, "main", lambda: 0)
    import throughline_domain.migrate as migrate_module
    monkeypatch.setattr(migrate_module, "migrate", lambda: [])

    assert preflight.boot() == 0
    assert "up to date" in capsys.readouterr().out
