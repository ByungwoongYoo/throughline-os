"""
The model a selection reports is the one that will answer (T182).

`registry.selection()` reported `model: None` whenever nobody had set one, and
`/api/system/capabilities` passed that on — while the provider it builds runs
its default, `qwen2.5:7b-instruct`, perfectly well. So the capability report
said no model was named on a machine where model features were working, which
reads as "off". Named now: the choice, the environment, or the provider's own
default, in that order, with `source` still saying which of the first two it
was.
"""

from __future__ import annotations

import pytest
from throughline_model import registry
from throughline_model.anthropic_provider import DEFAULT_MODEL as HOSTED_DEFAULT
from throughline_model.ollama import DEFAULT_MODEL as LOCAL_DEFAULT


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    saved = dict(registry._override)
    monkeypatch.delenv("THROUGHLINE_MODEL", raising=False)
    monkeypatch.delenv("THROUGHLINE_MODEL_PROVIDER", raising=False)
    registry._override.update({"provider": None, "model": None, "api_key": None})
    yield
    registry._override.clear()
    registry._override.update(saved)
    registry._cached.cache_clear()


def test_the_local_default_is_named_when_nothing_is_chosen():
    assert registry.selection() == {"provider": "ollama", "model": LOCAL_DEFAULT,
                                    "source": "environment"}


def test_the_hosted_default_is_named_for_the_hosted_provider(monkeypatch):
    monkeypatch.setenv("THROUGHLINE_MODEL_PROVIDER", "anthropic")
    assert registry.selection()["model"] == HOSTED_DEFAULT


def test_an_explicit_model_still_wins(monkeypatch):
    monkeypatch.setenv("THROUGHLINE_MODEL", "llama3.1:8b")
    assert registry.selection()["model"] == "llama3.1:8b"
    registry.configure(model="qwen2.5:14b")
    assert registry.selection() == {"provider": "ollama", "model": "qwen2.5:14b",
                                    "source": "chosen in the interface"}


def test_no_model_is_named_when_models_are_off(monkeypatch):
    # "off" builds no provider, so there is no default to name.
    monkeypatch.setenv("THROUGHLINE_MODEL_PROVIDER", "off")
    assert registry.selection()["model"] is None


def test_the_capability_report_carries_it():
    import importlib
    app = importlib.import_module("throughline_api.app")
    assert app._model_selection()["model"] == LOCAL_DEFAULT


def test_a_failed_switch_puts_back_the_model_that_was_running():
    """
    `choose_model` captures `selection()`, switches, and on failure configures
    the captured values back. With `model: None` captured, `configure(model=None)`
    changed nothing — so a hosted switch refused for a bad key left `ollama`
    pointed at `claude-opus-5`, and every local model feature broke until
    somebody chose a model again.
    """
    previous = registry.selection()
    registry.configure(provider="anthropic", model=HOSTED_DEFAULT)
    registry.configure(provider=previous["provider"] or "ollama", model=previous["model"])

    assert registry.selection()["provider"] == "ollama"
    assert registry.selection()["model"] == LOCAL_DEFAULT
