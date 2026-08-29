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
