"""
Where a researcher's data may go, and who decides (§84).

§84 asks for four modes — no AI, local, private hosted, approved external —
for organisation-level controls over them, and that external transmission be
*understandable*. Two things were wrong.

**The privacy guarantee was a constant.** `OllamaProvider` reported
`local=True` whatever host it pointed at, so the same backend against
`127.0.0.1` and against `https://ai.university.edu` made the same promise while
doing opposite things. A guarantee that cannot be false is not one.

**There were no organisation-level controls at all.** A researcher could select
a hosted provider from the interface and nothing above them could say no.

The policy fails closed, and that is the decision worth testing hardest: a
value nobody can parse is one nobody set on purpose, and the safe reading of
"I do not understand this instruction about where research data may go" is to
send it nowhere.
"""

from __future__ import annotations

import pytest
from throughline_model import registry
from throughline_model.ollama import runs_on_this_machine


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch):
    monkeypatch.delenv("THROUGHLINE_AI_POLICY", raising=False)
    monkeypatch.delenv("OLLAMA_HOST", raising=False)
    monkeypatch.delenv("THROUGHLINE_MODEL_PROVIDER", raising=False)
    yield


class TestLocalityIsMeasuredNotAsserted:
    @pytest.mark.parametrize("host", [
        "http://127.0.0.1:11434", "http://localhost:11434", "[::1]:11434",
        "unix:///tmp/ollama.sock",
    ])
    def test_this_machine_is_local(self, host):
        assert runs_on_this_machine(host) is True

    @pytest.mark.parametrize("host", [
        "https://ai.university.edu", "http://192.168.1.50:11434",
        "http://ollama.internal:11434",
    ])
    def test_somebody_elses_server_is_not(self, host):
        """
        Including one on the same network. "Inside the building" is not the
        promise the local default makes; "on this laptop" is.
        """
        assert runs_on_this_machine(host) is False

    def test_the_capability_says_where_it_runs(self, monkeypatch):
        """
        The sentence a researcher reads before deciding to paste in
        unpublished work. It used to say "nothing leaves the device" while
        every prompt did.
        """
        from throughline_model.ollama import OllamaProvider

        remote = OllamaProvider(host="https://ai.university.edu")
        assert remote.capability().local is False


class TestThePolicyIsTheOperatorsAndFailsClosed:
    def test_the_default_permits_everything(self, monkeypatch):
        """Unset is a deployment nobody has restricted, not a locked one."""
        assert registry.policy() == "external"

    @pytest.mark.parametrize("mode", ["none", "local", "hosted", "external"])
    def test_each_named_mode_is_honoured(self, monkeypatch, mode):
        monkeypatch.setenv("THROUGHLINE_AI_POLICY", mode)
        assert registry.policy() == mode

    @pytest.mark.parametrize("nonsense", ["loose", "ALL", "yes", "", "  "])
    def test_a_value_nobody_can_parse_sends_nothing_anywhere(
            self, monkeypatch, nonsense):
        """
        The most important test in this file.

        A typo that silently permitted everything would be the worst possible
        behaviour for the setting that decides where unpublished research goes.
        """
        monkeypatch.setenv("THROUGHLINE_AI_POLICY", nonsense)
        assert registry.policy() == "none"
        assert registry.permitted("local") is False

    def test_a_stricter_policy_refuses_a_further_mode(self, monkeypatch):
        monkeypatch.setenv("THROUGHLINE_AI_POLICY", "local")
        assert registry.permitted("local") is True
        assert registry.permitted("hosted") is False
        assert registry.permitted("external") is False

    def test_the_modes_are_ordered_by_how_far_data_travels(self):
        """The ordering *is* the mechanism, so it is asserted rather than
        assumed by the comparisons above."""
        assert registry.MODES == ("none", "local", "hosted", "external")
        assert set(registry.MODE_MEANINGS) == set(registry.MODES)


class TestASelectionIsClassified:
    def test_ollama_on_this_machine_is_local(self, monkeypatch):
        assert registry.mode_of("ollama") == "local"

    def test_ollama_pointed_elsewhere_is_hosted(self, monkeypatch):
        """
        This is what makes "private hosted AI" a real mode rather than a name.
        Same backend, different promise, told apart by the address.
        """
        monkeypatch.setenv("OLLAMA_HOST", "https://ai.university.edu")
        assert registry.mode_of("ollama") == "hosted"

    def test_another_companys_model_is_external(self):
        assert registry.mode_of("anthropic") == "external"

    def test_no_provider_is_no_ai(self):
        for name in ("none", "off", "disabled", ""):
            assert registry.mode_of(name) == "none"

    def test_an_unknown_backend_is_treated_as_the_furthest(self):
        """Guessing the other way would understate where data goes."""
        assert registry.mode_of("some-new-vendor") == "external"


class TestThePolicyIsEnforcedWhereItCannotBeBypassed:
    def test_a_forbidden_provider_yields_no_model_and_says_why(
            self, monkeypatch):
        """
        Enforced in the registry rather than the interface: a control that is
        only applied where it is drawn is not a control.
        """
        monkeypatch.setenv("THROUGHLINE_AI_POLICY", "local")
        monkeypatch.setenv("THROUGHLINE_MODEL_PROVIDER", "anthropic")
        registry.configure(provider="anthropic")
        try:
            capability = registry.provider(refresh=True).capability()
            assert capability.text is False
            assert "permits" in capability.note
        finally:
            registry.configure(provider="ollama")
            registry.provider(refresh=True)
