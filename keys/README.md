# Release keys

`release.pub` is the public half of the release signing key. It is committed on
purpose, and it travels inside every release tarball — that placement is the
whole point. A signature is worth more than a checksum only because the thing
that verifies it arrives *with the software* rather than from the server being
verified.

There is no key here yet. Make one, once:

```bash
python scripts/manage.py release-key
```

It writes `release.pub` for you to commit and **prints the private half without
saving it anywhere**. Put that in a password manager and a CI secret, then point
`THROUGHLINE_RELEASE_KEY` at a file containing it when building a release.

A signing key written to disk by a script is a signing key that gets committed
eventually; the only thing standing between a private repository and a published
private key is nobody running `git add -A` at the wrong moment.

**Losing the private key strands every installed copy.** They verify against the
key they shipped with, so a replacement can only reach them inside a release
they would have to verify with the key they no longer have. There is no recovery
path that does not involve people reinstalling by hand.

**What this does not cover.** A first install cannot check a signature:
verification has to happen before anything is installed, and the library that
would check it arrives in the download. First install trusts HTTPS from a domain
we control plus the digest carried in the manifest. Every update afterwards
verifies properly, because the virtualenv exists by then.
