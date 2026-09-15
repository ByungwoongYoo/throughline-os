"""Fetching the PDF behind a search result (§204, §205).

The literature search already returns a `pdf_url` for open-access records, and
the reader already renders bytes. This is the missing middle — and it is a
server-side fetch rather than a browser one for a boring reason: arXiv, Crossref
and the rest do not send CORS headers, so a browser cannot read the response
even when it is allowed to make the request.

**The guard that matters is SSRF, and it is the whole reason this file is not
four lines.** An endpoint that takes a URL from the client and fetches it from
the server will, given a malicious or careless caller, happily fetch
`http://127.0.0.1:8080/api/...`, `http://[::1]/`, or a cloud metadata address —
using the server's own network position, which is exactly the position an
attacker does not have. This installation is local, which lowers the stakes and
does not change the shape of the bug: the API also binds a database and an
admin surface on this machine, and "it's only localhost" is what makes localhost
worth reaching.

So the destination is resolved and checked *before* the request is made, and
rejected if it lands anywhere private. Redirects are followed manually so each
hop is checked the same way — a public URL that 302s to `169.254.169.254` is
the standard way this guard gets bypassed when it is applied only once.

**And the address actually connected to is checked as well.** Resolving a name
to decide and letting the connection resolve it again is the other standard
bypass: a name whose DNS answers public for the check and loopback for the
connection (rebinding) passed the first guard and was fetched from this machine
(T165). See `_connection_to_public_peers`.

**A PDF is not trusted here either.** The bytes are handed to the browser, which
hands them to PDF.js with scripting off; nothing on this side parses them. What
this does enforce is that they are plausibly a PDF and not, say, a 900MB file
or an HTML login page — a reader that spent a minute downloading a captcha page
and then said "that file could not be opened" would be telling the truth and
helping nobody.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request

from .base import USER_AGENT, ConnectorError

#: Papers are large but not unbounded. A 60MB PDF is a big supplementary-heavy
#: article; a 600MB one is not a paper and would sit in browser memory.
MAX_BYTES = 60 * 1024 * 1024

#: Long enough for a slow repository, short enough that a hung host does not
#: hold a request open until the researcher gives up on the whole page.
TIMEOUT = 30.0

#: Enough hops for the usual doi.org -> publisher -> CDN chain, few enough that
#: a redirect loop ends.
MAX_REDIRECTS = 5


class PaperFetchError(ConnectorError):
    """A PDF that will not be fetched, with a reason for a person."""


def _is_public(host: str) -> bool:
    """
    Whether a hostname resolves only to addresses out on the internet.

    Every address is checked, not just the first. A hostname can resolve to both
    a public and a loopback address, and taking `getaddrinfo`'s first answer is
    a guard that passes on Monday and fails on Tuesday depending on resolver
    ordering.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    if not infos:
        return False

    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        # `is_global` is False for loopback, link-local, private ranges,
        # multicast and the reserved blocks — including 169.254.169.254, which
        # is the one worth naming.
        if not address.is_global:
            return False
    return True


def _checked(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise PaperFetchError(
            "Only http and https addresses can be fetched.")
    if not parsed.hostname:
        raise PaperFetchError("That address names no host.")
    if not _is_public(parsed.hostname):
        # Deliberately the same message for "private address" and "does not
        # resolve": distinguishing them turns this endpoint into a scanner that
        # reports which internal hosts exist.
        raise PaperFetchError(
            f"{parsed.hostname} is not a public address this can fetch from.")
    return url


def fetch_pdf(url: str, *, mailto: str | None = None) -> bytes:
    """
    The PDF at `url`, if it is a PDF and the address is somewhere public.

    Redirects are followed by hand so every hop is checked. `urllib`'s automatic
    redirect handling would follow a public URL to a private one without ever
    consulting the guard above, which is the failure this is arranged to avoid.
    """
    current = _checked(url)
    headers = {
        "User-Agent": USER_AGENT.format(mailto=mailto or "unknown"),
        "Accept": "application/pdf,*/*",
    }

    for _ in range(MAX_REDIRECTS):
        request = urllib.request.Request(current, headers=headers)
        opener = urllib.request.build_opener(_NoRedirects, _PublicOnlyHTTP,
                                             _PublicOnlyHTTPS)
        try:
            with opener.open(request, timeout=TIMEOUT) as response:
                location = response.headers.get("Location")
                if response.status in {301, 302, 303, 307, 308} and location:
                    # Re-checked on every hop, which is the point.
                    current = _checked(urllib.parse.urljoin(current, location))
                    continue
                return _body(response)
        except urllib.error.HTTPError as exc:
            if exc.code in {301, 302, 303, 307, 308}:
                location = exc.headers.get("Location")
                if not location:
                    raise PaperFetchError(
                        "That address redirected to nowhere.") from exc
                current = _checked(urllib.parse.urljoin(current, location))
                continue
            raise PaperFetchError(
                f"That paper could not be downloaded ({exc.code}). It may be "
                "behind a paywall.") from exc
        except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
            raise PaperFetchError(
                f"That paper could not be downloaded ({exc}).") from exc

    raise PaperFetchError("That address redirects in a loop.")


def _body(response: object) -> bytes:
    read = getattr(response, "read")
    headers = getattr(response, "headers")

    declared = headers.get("Content-Length")
    if declared is not None:
        try:
            if int(declared) > MAX_BYTES:
                raise PaperFetchError(
                    f"That file is {int(declared) // (1024 * 1024)}MB, which is "
                    "larger than this will download.")
        except ValueError:
            pass  # A malformed header is not a reason to refuse; the cap below
                  # still applies to what actually arrives.

    # One byte over the cap, so a server that lies about Content-Length — or
    # omits it entirely, which is common — still cannot stream unboundedly into
    # memory.
    data = read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise PaperFetchError(
            "That file is larger than this will download.")

    # Checked by content rather than by the header, because plenty of
    # repositories serve PDFs as application/octet-stream, and plenty of
    # paywalls serve an HTML login page as application/pdf.
    if not data.startswith(b"%PDF-"):
        raise PaperFetchError(
            "That address did not return a PDF. It may be a landing page "
            "rather than the paper itself.")
    return data


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    """Hands redirects back rather than following them (see `fetch_pdf`)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def _connection_to_public_peers(base: type, *, host: str, proxied: bool):
    """
    A connection class that refuses to talk to anything but a public address.

    `_checked` resolves the name to decide, and the connection resolves it
    *again* to connect — so a name whose DNS answers a public address for the
    first lookup and loopback for the second (DNS rebinding) passed the check
    and was fetched from this machine: the API on loopback, cloud metadata, the
    very things this module exists to keep out of reach (T165). So the address
    the socket actually connected to is checked, after connecting and before a
    byte of the request is sent. It is the peer that matters, not any lookup.

    Not when a proxy is configured: then the socket's peer is the proxy, which
    may rightly be on a private network, and the proxy — not this process —
    resolves the destination. Refusing every proxied fetch would break the
    installations behind one, and the hostname is still checked by `_checked`.
    """
    def make(connect_to: str, **kwargs):
        connection = base(connect_to, **kwargs)
        if proxied:
            return connection
        create = connection._create_connection

        def checked(address, *args, **kw):
            sock = create(address, *args, **kw)
            peer = sock.getpeername()[0].split("%", 1)[0]
            if not ipaddress.ip_address(peer).is_global:
                sock.close()
                raise PaperFetchError(
                    f"{host} is not a public address this can fetch from.")
            return sock

        connection._create_connection = checked
        return connection
    return make


class _PublicOnlyHTTP(urllib.request.HTTPHandler):
    def http_open(self, req):  # noqa: D102
        return self.do_open(_connection_to_public_peers(
            http.client.HTTPConnection, host=urllib.parse.urlsplit(req.full_url).hostname or "", proxied=req.has_proxy()), req)


class _PublicOnlyHTTPS(urllib.request.HTTPSHandler):
    def https_open(self, req):  # noqa: D102
        return self.do_open(_connection_to_public_peers(
            http.client.HTTPSConnection, host=urllib.parse.urlsplit(req.full_url).hostname or "", proxied=req.has_proxy()),
            req, context=self._context)
