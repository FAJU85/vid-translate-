from app.modules.media import core
from app.modules.media.core import is_site_block


def _target(monkeypatch, value):
    monkeypatch.setattr(core.config, "YTDLP_IMPERSONATE", value)
    monkeypatch.setattr(core, "_impersonate_checked", None)
    return core._impersonate_target()


def test_impersonation_falls_back_when_target_unavailable(monkeypatch):
    # The target parses, but no installed handler provides it: download without it.
    assert _target(monkeypatch, "chrome-999999") is None


def test_impersonation_can_be_turned_off(monkeypatch):
    assert _target(monkeypatch, "") is None


def test_site_block_messages():
    assert is_site_block("[youtube] abc: Sign in to confirm you're not a bot.")
    assert is_site_block(
        "[youtube] wuSCssgYAz4: Unable to download API page: [SSL: UNEXPECTED_EOF_WHILE_READING] "
        "EOF occurred in violation of protocol (_ssl.c:1011)"
    )
    assert is_site_block("HTTP Error 429: Too Many Requests")


def test_other_download_errors_are_not_site_blocks():
    assert not is_site_block("[generic] Unsupported URL: https://example.com/page")
    assert not is_site_block("HTTP Error 404: Not Found")
