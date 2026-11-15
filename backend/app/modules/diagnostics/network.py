"""Can this server reach a site, and at which level does it fail?

Temporary diagnostic: tells apart "the site rejects how we ask" (a browser could help) from
"the network connection itself is refused" (only another network address helps).
"""
from __future__ import annotations

import socket
import ssl
import time

import httpx

SITES = ["www.youtube.com", "www.google.com", "archive.org", "vimeo.com"]
YOUTUBE_VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # "Me at the zoo", the first upload


def _timed(fn) -> dict:
    start = time.monotonic()
    try:
        result = {"ok": True, **fn()}
    except Exception as exc:  # noqa: BLE001 - the error itself is the finding
        result = {"ok": False, "error": f"{exc.__class__.__name__}: {str(exc)[:200]}"}
    result["seconds"] = round(time.monotonic() - start, 2)
    return result


def _tls(host: str) -> dict:
    with socket.create_connection((host, 443), timeout=10) as raw:
        family = "IPv6" if raw.family == socket.AF_INET6 else "IPv4"
        with ssl.create_default_context().wrap_socket(raw, server_hostname=host) as tls:
            return {"ip": family, "tls": tls.version()}


def _https(host: str) -> dict:
    resp = httpx.get(f"https://{host}/", timeout=15, follow_redirects=True,
                     headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36"})
    return {"status": resp.status_code, "bytes": len(resp.content)}


def _browser(hosts: list[str]) -> dict:
    from playwright.sync_api import sync_playwright

    out: dict = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            for host in hosts:
                def visit(host=host) -> dict:
                    page = browser.new_page()
                    try:
                        resp = page.goto(f"https://{host}/", timeout=25_000, wait_until="domcontentloaded")
                        return {"status": resp.status if resp else None, "title": page.title()[:80]}
                    finally:
                        page.close()

                out[host] = _timed(visit)
        finally:
            browser.close()
    return out


def _ytdlp() -> dict:
    import yt_dlp

    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 20}) as ydl:
        info = ydl.extract_info(YOUTUBE_VIDEO, download=False)
    return {"title": info.get("title"), "formats": len(info.get("formats") or [])}


def network_report() -> dict:
    report: dict = {"sites": {}}
    for host in SITES:
        report["sites"][host] = {"tls_handshake": _timed(lambda h=host: _tls(h)), "https_get": _timed(lambda h=host: _https(h))}
    browser = _timed(lambda: {"pages": _browser(SITES)})
    if browser.get("ok"):
        for host, result in browser["pages"].items():
            report["sites"][host]["playwright_chromium"] = result
    else:
        report["playwright_chromium"] = browser
    report["yt_dlp_youtube_video"] = _timed(_ytdlp)
    return report
