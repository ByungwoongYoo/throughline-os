"""
D116 — a script that forgets one environment variable writes to real data.

`db.py` resolved its home as `THROUGHLINE_HOME` or `~/.throughline-os`, so
anything run from this checkout without that variable set connected to a
researcher's actual projects instead of the test cluster. The ledger records
that this is not hypothetical: two one-off scripts inserted two users, two
projects and two queued workflow runs into a real `~/.throughline-os`, and the
measurements they took were worthless because they were reading a different
database from the one under test — which only became visible when the numbers
stopped making sense.

The guard is narrow on purpose, because the same default is *correct* for an
installed copy: a researcher who runs Throughline has their data in
`~/.throughline-os` and nothing should stand between them and it. What is
refused is the *implicit* default when the code is being run out of a source
checkout, which is the only place stray scripts are written. The product's own
entry points say what they mean by setting the variable.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

#: Imported rather than spelled again: a copy here that fell out of step with
#: `db.py` would strip a variable nothing reads and leave the real one set.
from throughline_domain.db import ALLOW_INSTALLED  # noqa: E402


def _run(code: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    """Import the module in a fresh interpreter, since the home is read once."""
    environment = dict(os.environ)
    environment.pop("THROUGHLINE_HOME", None)
    # And the escape hatch, which is the whole point of the refusal being
    # testable. `manage.py` grants it for its own subcommands — it *is* the
    # installed product when it runs `dev` or `backup` — and `preflight` passed
    # that grant down to pytest, so these tests ran with the refusal switched
    # off and failed only under preflight. A guard that controls its own
    # environment cannot be defeated by whoever happened to start the run.
    environment.pop(ALLOW_INSTALLED, None)
    environment.update(env or {})
    return subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, env=environment,
        capture_output=True, text=True)


class TestTheStrayScript:
    def test_it_refuses_rather_than_opening_the_researchers_database(self):
        done = _run("from throughline_domain.db import data_root; data_root()")
        assert done.returncode != 0, (
            "a script with no THROUGHLINE_HOME opened real project data")
        assert "THROUGHLINE_HOME" in done.stderr

    def test_the_refusal_says_what_to_do(self):
        """A refusal nobody can act on is just a broken script."""
        done = _run("from throughline_domain.db import data_root; data_root()")
        assert "THROUGHLINE_HOME" in done.stderr
        assert ".throughline-os" in done.stderr, (
            "the message does not name the directory it declined to open")

    def test_importing_the_module_is_not_itself_refused(self):
        """
        Import must stay harmless. Raising at import time would break every
        tool that imports the package without touching a database — and the
        error would appear miles from its cause.
        """
        done = _run("import throughline_domain.db; print('imported')")
        assert done.returncode == 0, done.stderr
        assert "imported" in done.stdout


class TestWhatItMustNotBreak:
    def test_an_explicit_home_is_honoured(self, tmp_path):
        done = _run(
            "from throughline_domain.db import data_root; print(data_root())",
            env={"THROUGHLINE_HOME": str(tmp_path)})
        assert done.returncode == 0, done.stderr
        assert str(tmp_path) in done.stdout

    def test_a_caller_may_ask_for_the_installed_home_on_purpose(self, tmp_path):
        """
        The product's own entry points want `~/.throughline-os` and should not
        have to lie about it. Asking explicitly is allowed; forgetting is not.
        """
        done = _run(
            "import os;"
            "os.environ['THROUGHLINE_ALLOW_INSTALLED_HOME'] = '1';"
            "from throughline_domain.db import data_root; print(data_root())")
        assert done.returncode == 0, done.stderr
        assert ".throughline-os" in done.stdout

    def test_the_suite_itself_is_unaffected(self):
        """conftest sets the variable at import, so this file's own run is fine."""
        from throughline_domain.db import data_root

        assert str(data_root()) == os.environ["THROUGHLINE_HOME"]


class TestTheProductStillStarts:
    def test_the_launcher_says_which_home_it_means(self):
        """
        `manage.py` starts the API, the worker and the interface. If it does
        not name the home, the guard turns a working install into a product
        that will not boot — which is a worse defect than the one being fixed.
        """
        source = (ROOT / "scripts" / "manage.py").read_text()
        assert "THROUGHLINE_ALLOW_INSTALLED_HOME" in source \
            or "THROUGHLINE_HOME" in source, (
            "nothing in the launcher declares which database it opens")

class TestTheCheckerDoesNotExemptItself:
    """
    A verification run must not carry the exemption it exists to verify.

    `manage.py main()` grants `THROUGHLINE_ALLOW_INSTALLED_HOME` because the
    program genuinely is the installed product when it runs `dev`, `doctor` or
    `backup`. `preflight` is a subcommand of the same program, so it inherited
    the grant and handed it to pytest — and the two tests at the top of this
    file, whose whole job is to prove an unnamed home is refused, ran with the
    refusal switched off. They failed under `preflight` and passed under a bare
    `pytest`, which reads as flakiness; a security guard believed to be flaky is
    one that gets deleted rather than fixed.
    """

    def test_preflight_strips_the_allowance_before_running_a_check(self):
        source = (ROOT / "scripts" / "manage.py").read_text()
        # The subprocess call that runs each preflight step must not be handed
        # the ambient environment: `env=env or None` inherits it, allowance and
        # all, which is precisely how this went unnoticed.
        assert "env=env or None" not in source, (
            "preflight passes its own environment to its checks, so a check "
            "runs with the installed-home allowance the product grants itself")
        assert "without_the_allowance" in source, (
            "nothing in preflight removes the allowance from a check's "
            "environment")

    def test_the_variable_has_one_name_in_the_launcher(self):
        """
        Granting and stripping must use the same string. Two spellings would
        leave the grant in place while the strip removed nothing, and every
        test here would still pass.
        """
        source = (ROOT / "scripts" / "manage.py").read_text()
        assert 'ALLOW_INSTALLED_HOME = "THROUGHLINE_ALLOW_INSTALLED_HOME"' in source
        # Once it is named, the literal should not be spelled out again.
        assert source.count('"THROUGHLINE_ALLOW_INSTALLED_HOME"') == 1, (
            "the variable is spelled out more than once, so the grant and the "
            "strip can drift apart")
