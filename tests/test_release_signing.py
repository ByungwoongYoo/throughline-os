"""Signing a release, and refusing one that does not verify.

A checksum published beside the file it describes proves nothing — whoever can
replace the tarball can replace the digest next to it. That reasoning is already
in `runtimes.py`, which verifies CPython against digests committed to this
repository rather than fetched alongside the download. A release needs the same
property with no repository to check against, and a signature is how.

The tests that matter here are the refusals, and one structural check that the
private key cannot end up in the repository — because the difference between a
signing key and a published secret is one careless `git add -A`, and this
session has already come close to committing another session's work that way.

**What first install cannot do is asserted too**, so it stays a documented
limit rather than drifting into an assumed capability.
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

import pytest

from throughline_domain import signing

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def keypair():
    return signing.generate()


@pytest.fixture()
def manifest():
    return {"version": "beta-4", "file": "throughline-beta-4.tar.gz",
            "sha256": "a" * 64, "size": 19_000_000, "manifest_version": 1}


# --- the round trip ---------------------------------------------------------


def test_a_signed_manifest_verifies(keypair, manifest):
    private, public = keypair
    manifest["signature"] = signing.sign(manifest, private)
    signing.verify(manifest, public)  # raises if not


def test_changing_one_byte_of_what_matters_is_caught(keypair, manifest):
    """The whole point. The manifest names the tarball's digest, so signing it
    covers the archive transitively — swapping the archive means swapping the
    digest, and that is what fails here."""
    private, public = keypair
    manifest["signature"] = signing.sign(manifest, private)
    manifest["sha256"] = "b" * 64

    with pytest.raises(signing.VerificationError) as raised:
        signing.verify(manifest, public)
    assert "not signed by the key" in str(raised.value)


def test_a_different_key_does_not_pass(keypair, manifest):
    """Somebody else's valid signature is not this product's signature."""
    private, _ = keypair
    _, other_public = signing.generate()
    manifest["signature"] = signing.sign(manifest, private)

    with pytest.raises(signing.VerificationError):
        signing.verify(manifest, other_public)


def test_an_unsigned_manifest_is_refused(keypair, manifest):
    """"No signature" and "a bad signature" are the same answer here. A release
    built before signing existed and one stripped of its signature are
    indistinguishable, and the safe reading is the hostile one."""
    _, public = keypair
    with pytest.raises(signing.VerificationError) as raised:
        signing.verify(manifest, public)
    assert "no signature" in str(raised.value)


def test_a_mangled_signature_is_refused_not_crashed(keypair, manifest):
    _, public = keypair
    manifest["signature"] = "not base64 at all!!"
    with pytest.raises(signing.VerificationError):
        signing.verify(manifest, public)


def test_verify_raises_rather_than_returning_false(keypair, manifest):
    """`if verify(...)` on a function returning None succeeds silently for every
    input, which is how a guard becomes a no-op. This codebase has shipped a
    read with no writer more than once; a check with no consequence is the same
    defect wearing different clothes."""
    private, public = keypair
    manifest["signature"] = signing.sign(manifest, private)
    assert signing.verify(manifest, public) is None


# --- the payload both sides build ------------------------------------------


def test_the_signature_field_is_not_part_of_what_is_signed(keypair, manifest):
    """Otherwise the manifest would have to contain a signature of itself."""
    before = signing.payload(manifest)
    manifest["signature"] = "anything"
    assert signing.payload(manifest) == before


def test_key_order_does_not_change_the_payload(manifest):
    """Both sides must build identical bytes or every verification fails in a
    way that looks exactly like tampering."""
    reordered = dict(reversed(list(manifest.items())))
    assert signing.payload(reordered) == signing.payload(manifest)


# --- keys ------------------------------------------------------------------


def test_the_private_key_is_never_written_to_the_repository():
    """The difference between a signing key and a published secret is one
    careless `git add -A`."""
    source = (ROOT / "scripts" / "manage.py").read_text()
    body = source[source.index("def release_key("):]
    body = body[:body.index("\ndef ")]
    assert "print(private)" in body, "the private half must be printed, not saved"
    assert "write_text(private" not in body


def test_the_public_key_ships_inside_the_release():
    """It has to arrive *with* the software rather than from the server being
    verified — that is the entire reason a signature beats a checksum."""
    source = (ROOT / "scripts" / "release.py").read_text()
    assert '"keys",' in source, "keys/ is not in the release archive"


def test_an_existing_public_key_is_not_silently_replaced(tmp_path, monkeypatch):
    """Replacing it strands every installed copy: they verify against the key
    they shipped with, and a new one can only reach them in a release they
    cannot verify."""
    source = (ROOT / "scripts" / "manage.py").read_text()
    body = source[source.index("def release_key("):]
    assert "already exists" in body[:body.index("\ndef ")]


def test_the_public_key_is_read_from_the_installation(tmp_path, monkeypatch):
    monkeypatch.delenv("THROUGHLINE_RELEASE_PUBLIC_KEY", raising=False)
    assert signing.public_key(tmp_path) is None

    target = tmp_path / signing.PUBLIC_KEY_FILE
    target.parent.mkdir(parents=True)
    target.write_text("  a-key  \n")
    assert signing.public_key(tmp_path) == "a-key"


# --- what a release build does ---------------------------------------------


def test_an_unsigned_release_says_so_every_time(tmp_path, monkeypatch):
    """Unsigned is legitimate — there is no key until somebody makes one — but
    a release that looks identical either way is how signing gets skipped
    indefinitely."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import release as release_build

    monkeypatch.delenv("THROUGHLINE_RELEASE_KEY", raising=False)
    said = []
    result = release_build._sign_if_possible({"version": "x"}, said.append)

    assert "signature" not in result
    assert any("UNSIGNED" in line for line in said), said


def test_a_key_that_is_not_there_is_refused_rather_than_skipped(tmp_path,
                                                                monkeypatch):
    """Asked to sign and quietly not signing is worse than never signing: the
    release is published believing it is protected."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import release as release_build

    monkeypatch.setenv("THROUGHLINE_RELEASE_KEY", str(tmp_path / "absent.pem"))
    with pytest.raises(release_build.ReleaseError) as raised:
        release_build._sign_if_possible({"version": "x"}, lambda *_: None)
    assert "silently falling back" in str(raised.value)


def test_a_real_build_signs_when_a_key_is_present(tmp_path, monkeypatch):
    sys.path.insert(0, str(ROOT / "scripts"))
    import release as release_build

    private, public = signing.generate()
    key_file = tmp_path / "key.pem"
    key_file.write_text(private)
    monkeypatch.setenv("THROUGHLINE_RELEASE_KEY", str(key_file))

    manifest = {"version": "beta-4", "sha256": "c" * 64}
    signed = release_build._sign_if_possible(manifest, lambda *_: None)
    signing.verify(signed, public)
