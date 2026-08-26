"""Signing a release, and verifying one before it is trusted.

A checksum published beside the file it describes proves nothing: whoever can
replace the tarball can replace the digest next to it. `runtimes.py` already
takes this seriously — the CPython digests it verifies against are committed to
this repository rather than fetched alongside the download — and a release needs
the same property without a repository to check against. A signature provides
it: the public half ships inside the installed copy, the private half never
leaves the machine that makes releases, and a compromised download host can
serve a corrupted tarball but cannot produce a manifest that verifies.

**What is signed is the manifest, not the tarball.** The manifest names the
tarball's SHA-256, so signing it covers the archive transitively — and it means
one small signature rather than streaming twenty megabytes through a verifier.

**What first install cannot do, said plainly.** Verifying a download has to
happen before anything is installed, and any library that could check a
signature would arrive *in* that download. So a first install trusts HTTPS from
a domain we control and the digest carried in the manifest; it does not verify a
signature. Every update afterwards does, because by then the virtualenv exists.
That is the common path over a product's life, and the one-time path is
documented rather than quietly skipped — a verification that silently does
nothing is worse than none, because it is believed.

**Ed25519 rather than RSA**: small keys, small signatures, no parameter choices
to get wrong, and no way to accidentally configure it weakly.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

#: Where the public half lives inside an installation. Committed, and therefore
#: inside the release tarball — which is the point: it arrives with the software
#: rather than from the server being verified.
PUBLIC_KEY_FILE = Path("keys") / "release.pub"

#: The field the signature is written into. Excluded from the payload when
#: signing and verifying, or the manifest would have to contain a signature of
#: itself.
SIGNATURE_FIELD = "signature"


class SigningError(RuntimeError):
    """A release could not be signed, for a reason worth reading."""


class VerificationError(RuntimeError):
    """A manifest did not verify.

    Its own class because it must never be caught and shrugged at: an update
    that proceeds after a failed signature check has converted a guard into a
    delay, which is worse than not checking at all.
    """


def payload(manifest: dict[str, Any]) -> bytes:
    """The exact bytes that get signed.

    Canonical: keys sorted, no incidental whitespace, and the signature field
    removed. Both sides must build this identically or every verification fails
    for reasons that look like tampering — so it is one function called by both,
    never two implementations that agree today.
    """
    without = {k: v for k, v in manifest.items() if k != SIGNATURE_FIELD}
    return json.dumps(without, sort_keys=True, separators=(",", ":")).encode()


def generate() -> tuple[str, str]:
    """A new keypair, as (private PEM, public base64).

    Run once, by a person. The private half is never written by this code and
    never committed — it goes into a password manager and a CI secret, and if it
    is lost every installed copy stops accepting updates until a new public key
    ships, which is a release nobody can update *to*. That is the failure worth
    understanding before generating one.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    private = Ed25519PrivateKey.generate()
    pem = private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    raw = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return pem, base64.b64encode(raw).decode()


def sign(manifest: dict[str, Any], private_pem: str) -> str:
    """Sign a manifest, returning the signature as base64."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    try:
        key = serialization.load_pem_private_key(private_pem.encode(),
                                                 password=None)
    except Exception as error:
        raise SigningError(f"Could not read the signing key: {error}") from error
    if not isinstance(key, Ed25519PrivateKey):
        raise SigningError("The signing key is not an Ed25519 key.")
    return base64.b64encode(key.sign(payload(manifest))).decode()


def public_key(root: Path) -> str | None:
    """The public half shipped with this installation, if there is one."""
    override = os.environ.get("THROUGHLINE_RELEASE_PUBLIC_KEY")
    if override:
        return override.strip()
    stamped = root / PUBLIC_KEY_FILE
    if stamped.is_file():
        text = stamped.read_text().strip()
        return text or None
    return None


def verify(manifest: dict[str, Any], key_base64: str) -> None:
    """Raise unless this manifest was signed by the key we shipped with.

    Raises rather than returning False, so a caller cannot forget to look at the
    answer. `if verify(...)` with a function that returns None on success is the
    shape that turns a guard into a no-op, and it has happened in this codebase
    before — a read with no writer, a check with no consequence.
    """
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    encoded = manifest.get(SIGNATURE_FIELD)
    if not encoded:
        raise VerificationError(
            "This manifest carries no signature. A release built before "
            "signing existed, or one that has been tampered with — and from "
            "here those are the same thing.")
    try:
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(key_base64))
    except Exception as error:
        raise VerificationError(
            f"The shipped public key could not be read: {error}") from error
    try:
        key.verify(base64.b64decode(encoded), payload(manifest))
    except InvalidSignature:
        raise VerificationError(
            "This manifest was not signed by the key this installation ships "
            "with. Refusing it. A corrupted download and a substituted one "
            "look the same from here, and the safe reading of the ambiguous "
            "case is the hostile one.") from None
    except Exception as error:
        raise VerificationError(f"Signature check failed: {error}") from error
