"""Whether a release install can actually *run*, as opposed to install.

**Everything before this verified the install and stopped there.** The tarball
downloaded, the checksum verified, the tree landed, the bootstrap built a
virtualenv — and every one of those runs was killed at that point, on three
platforms, because the next step takes minutes. The first person to let it run
to the end found that it starts the stack and then shuts itself down.

The cause was one branch. `start` asked `if node:` and ran `npm run dev` inside
`apps/web`. A release ships the *exported* interface and no npm project, so npm
exited with `ENOENT ... apps/web/package.json`; the supervisor exits as soon as
any child does — deliberately, since a dead worker beside a live API looks like
a working stack that never finishes anything — so it took the API and worker
down with it.

It is invisible on a source checkout, because there `package.json` exists and
the dev server is the correct thing to start. The defect lives only on the
installation nobody develops on, which is every installation a stranger has.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import manage  # noqa: E402


def make_tree(root: Path, *, package_json: bool, exported: bool) -> Path:
    web = root / "apps" / "web"
    (web / "out").mkdir(parents=True)
    if package_json:
        (web / "package.json").write_text("{}\n")
    if exported:
        (web / "out" / "index.html").write_text("<html></html>")
    return root


def test_a_release_install_does_not_try_to_run_a_dev_server(tmp_path):
    """The defect itself. A release has the exported interface and no npm
    project, so there is nothing for `npm run dev` to run — and attempting it
    does not merely fail, it takes the whole stack down."""
    tree = make_tree(tmp_path, package_json=False, exported=True)
    assert not manage._can_run_dev_server(tree), (
        "a release install would start a dev server it has no project for")


def test_a_source_checkout_still_runs_the_dev_server(tmp_path):
    """The fix must not cost developers live reload — that is the whole reason
    the dev-server branch exists."""
    tree = make_tree(tmp_path, package_json=True, exported=True)
    assert manage._can_run_dev_server(tree), (
        "a checkout with an npm project should still run the dev server")


def test_having_node_installed_is_not_the_question(tmp_path):
    """**The conflation that caused it.** Node being present on the machine says
    nothing about whether this installation has a project to build. Most
    researcher machines have Node for some unrelated reason, and every one of
    them got a stack that started and immediately stopped."""
    source = manage.__file__ and Path(manage.__file__).read_text()
    assert "if node and _can_run_dev_server():" in source, (
        "start is branching on Node alone again")
    assert "if node:\n            print(f\"\\n  Throughline" not in source


def test_the_exported_interface_is_what_a_release_serves(tmp_path):
    """The design is sound and was already documented — `_ensure_interface` says
    an already-built interface needs no Node at all, "which is the case a
    release should arrive in". Only the branch in `start` disagreed."""
    tree = make_tree(tmp_path, package_json=False, exported=True)
    assert (tree / "apps" / "web" / "out" / "index.html").is_file()
    assert not manage._can_run_dev_server(tree)
