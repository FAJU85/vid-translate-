"""The engine's fast mode under load (shared/load.py)."""
from app.shared import config, load


def test_fast_only_when_enough_are_waiting(monkeypatch):
    monkeypatch.setattr(config, "FAST_WHEN_WAITING", 2)
    load.set_waiting(0)
    assert not load.under_load()
    load.set_waiting(1)
    assert not load.under_load()
    load.set_waiting(2)
    assert load.under_load()
    load.set_waiting(-3)
    assert load.waiting() == 0 and not load.under_load()


def test_zero_turns_it_off(monkeypatch):
    monkeypatch.setattr(config, "FAST_WHEN_WAITING", 0)
    load.set_waiting(10)
    assert not load.under_load()
    load.set_waiting(0)
