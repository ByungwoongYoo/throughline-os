"""
A model that does not run on this machine is marked as such.

Ollama serves cloud models: a `:cloud` tag executes on ollama.com, and every
passage handed to it leaves the researcher's machine. Ollama reports those from
`/api/tags` beside the local ones, and the picker listed them identically — so
choosing one looked exactly like choosing a local model.

The README's guarantee is the whole reason this matters: *"Nothing leaves the
machine unless the researcher connects an external service — and where one can
be connected, the interface says so before it is used."* The hosted provider
already asks before it is used. An Ollama cloud model asked nothing, because
the check was written against the *provider* rather than against where the
model actually runs.
"""

from __future__ import annotations

import json
from unittest.mock import patch

from throughline_model.ollama import OllamaProvider, is_cloud_model


def test_a_cloud_tag_is_not_this_machine():
    assert is_cloud_model("glm-5.3-flash:cloud") is True
    assert is_cloud_model("GLM-5.3-Flash:Cloud") is True
    assert is_cloud_model(" qwen3:cloud ") is True


def test_a_local_model_is_not_mistaken_for_a_remote_one():
    # The cost of a false positive is a warning on a model that never leaves
    # the machine, which teaches a researcher to dismiss the warning.
    for name in ("qwen2.5:7b-instruct", "llama3.1:8b", "mistral",
                 "cloudy:7b", "my-cloud-model:latest"):
        assert is_cloud_model(name) is False, name


class _Response:
    def __init__(self, payload): self._payload = payload
    def read(self): return json.dumps(self._payload).encode()
    def __enter__(self): return self
    def __exit__(self, *_): return False


def test_installed_says_which_models_run_here():
    payload = {"models": [
        {"name": "qwen2.5:7b-instruct", "size": 4_683_087_332,
         "details": {"parameter_size": "7.6B", "quantization_level": "Q4_K_M",
                     "family": "qwen2"}},
        {"name": "glm-5.3-flash:cloud", "size": 0, "details": {}},
    ]}
    with patch("urllib.request.urlopen", return_value=_Response(payload)):
        models = {m["name"]: m for m in OllamaProvider().installed()}

    assert models["qwen2.5:7b-instruct"]["runs_here"] is True
    assert models["glm-5.3-flash:cloud"]["runs_here"] is False


def test_every_listed_model_says_where_it_runs():
    """
    Absent is not false. A missing field renders as "not remote" in a client
    that checks `runs_here === false`, which is the safe direction only by
    accident — so the field is always present.
    """
    payload = {"models": [{"name": "mistral", "size": 1, "details": {}}]}
    with patch("urllib.request.urlopen", return_value=_Response(payload)):
        for model in OllamaProvider().installed():
            assert "runs_here" in model


# ---------------------------------------------------------------------------
# What Ollama said, rather than a guess at why
# ---------------------------------------------------------------------------


class _HttpError(Exception):
    """Enough of `urllib.error.HTTPError` to drive the message."""

    def __init__(self, code: int, reason: str, body: bytes) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self._body = body

    def read(self) -> bytes:
        return self._body


def test_a_refusal_is_reported_in_ollamas_words():
    """
    `HTTPError` subclasses `URLError`, so a response with a status code was
    caught by the same branch as a dead socket and reported as "Ollama is not
    reachable — start it with `ollama serve`". Pointing this installation at a
    cloud model returned 402 and said exactly that, about a server that had
    been running the whole time.
    """
    from throughline_model.ollama import _what_ollama_said

    said = _what_ollama_said("glm-5.3-flash:cloud", _HttpError(
        402, "Payment Required",
        b'{"error":"this model requires a subscription, upgrade at '
        b'https://ollama.com/upgrade"}'))

    assert "402" in said
    assert "requires a subscription" in said
    assert "ollama.com/upgrade" in said
    # And never the advice that sends somebody to fix the thing that is fine.
    assert "ollama serve" not in said


def test_a_cloud_refusal_says_where_the_account_lives():
    # 402 on a local model is a different problem from 402 on a cloud one, and
    # only the second is about an account somewhere else.
    from throughline_model.ollama import _what_ollama_said

    cloud = _what_ollama_said("glm-5.3-flash:cloud",
                              _HttpError(402, "Payment Required", b"{}"))
    local = _what_ollama_said("qwen2.5:7b-instruct",
                              _HttpError(500, "Server Error", b"{}"))
    assert "ollama.com" in cloud
    assert "ollama.com" not in local


def test_a_body_that_is_not_json_is_still_passed_on():
    # Better the raw text than nothing: the point is the server's own words.
    from throughline_model.ollama import _what_ollama_said

    said = _what_ollama_said("mistral", _HttpError(503, "Unavailable",
                                                   b"model is loading"))
    assert "model is loading" in said


def test_an_unreadable_body_still_names_the_status():
    from throughline_model.ollama import _what_ollama_said

    class _Unreadable(_HttpError):
        def read(self):  # noqa: D102
            raise OSError("connection reset")

    said = _what_ollama_said("mistral", _Unreadable(500, "Server Error", b""))
    assert "500" in said and "Server Error" in said


def test_a_status_code_does_not_read_as_a_dead_server():
    """
    The routing, not just the wording.

    Every test above calls the message directly, which proves nothing about
    which branch an HTTP error lands in — and that was the bug: `HTTPError`
    subclasses `URLError`, so a 402 was handled as a socket failure. Removing
    the fix leaves these passing unless something drives the real path.
    """
    import io
    import urllib.error
    from unittest.mock import patch

    from throughline_model.ollama import ModelUnavailable, OllamaProvider
    from throughline_model.schemas import PlainSummary

    refusal = urllib.error.HTTPError(
        "http://127.0.0.1:11434/api/chat", 402, "Payment Required", {},
        io.BytesIO(b'{"error":"this model requires a subscription"}'))

    with patch("urllib.request.urlopen", side_effect=refusal):
        try:
            OllamaProvider(model="glm-5.3-flash:cloud").generate_structured(
                schema=PlainSummary, instructions="hello",
                prompt_name="p", prompt_version=1)
        except ModelUnavailable as raised:
            said = str(raised)
        else:  # pragma: no cover - the call must not succeed
            raise AssertionError("a 402 was not reported at all")

    assert "402" in said
    assert "requires a subscription" in said
    assert "ollama serve" not in said
