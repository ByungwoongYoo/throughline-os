"""Fetching a paper, and the addresses it refuses (§204, §205).

Almost all of this is about SSRF, because that is what the module is for. An
endpoint that fetches a client-supplied URL from the server is reaching out with
the server's network position, and this server has a database and an admin
surface on the same machine — so "it only runs locally" is the reason the guard
matters rather than a reason to skip it.

Nothing here touches the network. The address checks are pure once name
resolution is controlled, and controlling it is what lets a test assert that a
hostname resolving to 127.0.0.1 is refused — which is the actual attack, and one
that a test using a literal `http://127.0.0.1` address would never exercise.
"""

from __future__ import annotations

import socket

import pytest

from throughline_connectors import papers


def resolving_to(monkeypatch, *addresses: str) -> None:
    """Make every hostname resolve to the given addresses."""
    def fake(host, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, 443))
                for a in addresses]
    monkeypatch.setattr(socket, "getaddrinfo", fake)


class TestAddressesItRefuses:
    def test_a_hostname_that_resolves_to_loopback(self, monkeypatch):
        """The actual attack.

        Not `http://127.0.0.1/` — nobody sends that. An attacker registers a
        name that resolves to loopback, so the URL looks entirely ordinary and
        the guard has to run after resolution rather than on the string.
        """
        resolving_to(monkeypatch, "127.0.0.1")
        with pytest.raises(papers.PaperFetchError, match="not a public address"):
            papers.fetch_pdf("https://papers.example.org/a.pdf")

    def test_the_cloud_metadata_address(self, monkeypatch):
        resolving_to(monkeypatch, "169.254.169.254")
        with pytest.raises(papers.PaperFetchError, match="not a public address"):
            papers.fetch_pdf("https://papers.example.org/a.pdf")

    def test_a_private_range(self, monkeypatch):
        for address in ["10.0.0.5", "192.168.1.10", "172.16.0.3"]:
            resolving_to(monkeypatch, address)
            with pytest.raises(papers.PaperFetchError):
                papers.fetch_pdf("https://papers.example.org/a.pdf")

    def test_a_host_that_resolves_to_both_public_and_private(self, monkeypatch):
        """Every address is checked, not just the first.

        A hostname can answer with both, and taking `getaddrinfo`'s first entry
        is a guard that passes or fails depending on resolver ordering — which
        is to say, a guard that passes in the test and fails in the field.
        """
        resolving_to(monkeypatch, "93.184.216.34", "127.0.0.1")
        with pytest.raises(papers.PaperFetchError, match="not a public address"):
            papers.fetch_pdf("https://papers.example.org/a.pdf")

    def test_a_scheme_that_is_not_http(self):
        # `file:///etc/passwd` is the other half of this class of bug.
        for url in ["file:///etc/passwd", "ftp://example.org/a.pdf",
                    "gopher://example.org/"]:
            with pytest.raises(papers.PaperFetchError, match="http and https"):
                papers.fetch_pdf(url)

    def test_an_address_with_no_host(self):
        with pytest.raises(papers.PaperFetchError):
            papers.fetch_pdf("https:///a.pdf")

    def test_a_name_that_does_not_resolve(self, monkeypatch):
        def fails(*args, **kwargs):  # noqa: ANN002, ANN003
            raise socket.gaierror("no such host")
        monkeypatch.setattr(socket, "getaddrinfo", fails)
        with pytest.raises(papers.PaperFetchError):
            papers.fetch_pdf("https://nowhere.example.org/a.pdf")

    def test_it_does_not_say_which_internal_hosts_exist(self, monkeypatch):
        """Refusals read alike on purpose.

        Distinguishing "private address" from "does not resolve" would turn this
        endpoint into a scanner that maps the internal network one message at a
        time.
        """
        resolving_to(monkeypatch, "10.0.0.5")
        with pytest.raises(papers.PaperFetchError) as one:
            papers.fetch_pdf("https://internal.example.org/a.pdf")

        def fails(*args, **kwargs):  # noqa: ANN002, ANN003
            raise socket.gaierror("no such host")
        monkeypatch.setattr(socket, "getaddrinfo", fails)
        with pytest.raises(papers.PaperFetchError) as two:
            papers.fetch_pdf("https://internal.example.org/a.pdf")

        assert str(one.value) == str(two.value)


class TestRedirects:
    """The bypass this module is arranged around.

    A guard applied once, at the start, is defeated by a public URL that
    redirects to a private one — which is the standard way this class of bug is
    exploited, and why `fetch_pdf` follows redirects by hand instead of letting
    urllib do it. A mutation that dropped the re-check on each hop survived the
    first version of this file, so these exist because that gap was real.
    """

    def test_a_public_url_that_redirects_to_loopback_is_refused(self, monkeypatch):
        seen: list[str] = []

        def resolve(host, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
            seen.append(host)
            address = "127.0.0.1" if host == "evil.example.org" else "93.184.216.34"
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]
        monkeypatch.setattr(socket, "getaddrinfo", resolve)

        class Redirecting:
            status = 302
            headers = {"Location": "https://evil.example.org/inside"}
            def read(self, n: int = -1) -> bytes: return b""
            def __enter__(self): return self
            def __exit__(self, *a): return False

        monkeypatch.setattr(
            papers.urllib.request, "build_opener",
            lambda *a, **k: type("O", (), {"open": lambda s, r, timeout=None: Redirecting()})())

        with pytest.raises(papers.PaperFetchError, match="not a public address"):
            papers.fetch_pdf("https://papers.example.org/a.pdf")
        # The redirect target really was resolved — otherwise this would pass
        # for the wrong reason.
        assert "evil.example.org" in seen

    def test_a_redirect_loop_ends(self, monkeypatch):
        resolving_to(monkeypatch, "93.184.216.34")

        class Looping:
            status = 302
            headers = {"Location": "https://papers.example.org/a.pdf"}
            def read(self, n: int = -1) -> bytes: return b""
            def __enter__(self): return self
            def __exit__(self, *a): return False

        monkeypatch.setattr(
            papers.urllib.request, "build_opener",
            lambda *a, **k: type("O", (), {"open": lambda s, r, timeout=None: Looping()})())

        with pytest.raises(papers.PaperFetchError, match="redirects in a loop"):
            papers.fetch_pdf("https://papers.example.org/a.pdf")


class TestWhatItAccepts:
    def test_a_public_address_passes_the_check(self, monkeypatch):
        # Proves the guard is not simply refusing everything, which is the
        # failure mode a suite of refusal tests cannot otherwise detect.
        resolving_to(monkeypatch, "93.184.216.34")
        assert papers._checked("https://arxiv.org/pdf/2101.00001") \
            == "https://arxiv.org/pdf/2101.00001"


class TestTheBytesItWillAccept:
    class FakeResponse:
        def __init__(self, body: bytes, headers: dict[str, str] | None = None):
            self._body = body
            self.headers = headers or {}
            self.status = 200

        def read(self, n: int = -1) -> bytes:
            return self._body if n < 0 else self._body[:n]

    def test_something_that_is_not_a_pdf(self):
        """Checked by content, not by the header.

        Paywalls serve HTML login pages as `application/pdf` routinely. A reader
        that spent a minute downloading a captcha page and then said "that file
        could not be opened" would be telling the truth and helping nobody.
        """
        page = b"<!DOCTYPE html><html><body>Sign in</body></html>"
        with pytest.raises(papers.PaperFetchError, match="did not return a PDF"):
            papers._body(self.FakeResponse(
                page, {"Content-Type": "application/pdf"}))

    def test_a_pdf_served_as_octet_stream(self):
        # The mirror of the case above: plenty of repositories serve a genuine
        # PDF with the wrong content type, and refusing it would be wrong.
        body = b"%PDF-1.7\n...body..."
        assert papers._body(self.FakeResponse(
            body, {"Content-Type": "application/octet-stream"})) == body

    def test_a_file_that_declares_itself_too_large(self):
        with pytest.raises(papers.PaperFetchError, match="larger than"):
            papers._body(self.FakeResponse(
                b"%PDF-1.7", {"Content-Length": str(papers.MAX_BYTES + 1)}))

    def test_a_file_that_lies_about_its_size(self):
        """The cap applies to what arrives, not to what was promised.

        A server that omits Content-Length — common — or understates it would
        otherwise stream without limit into the researcher's memory.
        """
        oversized = b"%PDF-1.7" + b"x" * (papers.MAX_BYTES + 10)
        with pytest.raises(papers.PaperFetchError, match="larger than"):
            papers._body(self.FakeResponse(oversized, {"Content-Length": "10"}))

    def test_it_never_reads_without_a_limit(self):
        """The cap has to be on the *read*, not only on what came back.

        Checking the length after reading everything is still a refusal, and
        still loads the whole thing into memory first — so a server streaming
        ten gigabytes is a refusal that arrives after the damage. A mutation
        replacing the bounded read with `read()` survived until this existed.
        """
        asked: list[int] = []

        class Recording(self.FakeResponse):
            def read(self, n: int = -1) -> bytes:
                asked.append(n)
                return super().read(n)

        papers._body(Recording(b"%PDF-1.7\n..."))
        assert asked, "the body was never read"
        assert all(n > 0 for n in asked), \
            f"read was called without a limit: {asked}"
        assert max(asked) <= papers.MAX_BYTES + 1

    def test_a_malformed_length_header_is_not_a_refusal(self):
        body = b"%PDF-1.7\n..."
        assert papers._body(self.FakeResponse(
            body, {"Content-Length": "not a number"})) == body
