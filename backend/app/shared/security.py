"""HMAC helpers shared (by convention) with the Cloudflare Worker, plus SSRF checks."""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import socket
import time
from urllib.parse import urlparse

from . import config


def sign(message: str, secret: str | None = None) -> str:
    key = (secret if secret is not None else config.SHARED_SECRET).encode()
    return hmac.new(key, message.encode(), hashlib.sha256).hexdigest()


def verify(message: str, signature: str) -> bool:
    if not config.SHARED_SECRET or not signature:
        return False
    return hmac.compare_digest(sign(message), signature)


def verify_bearer(header: str | None) -> bool:
    if not config.SHARED_SECRET or not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:].strip(), config.SHARED_SECRET)


def verify_signed_url(scope: str, exp: str | int | None, sig: str | None) -> bool:
    """Signed URL check. `scope` is e.g. "file:<job>:<name>" or "upload:<job>"."""
    try:
        exp_i = int(exp)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    if exp_i < time.time():
        return False
    return verify(f"{scope}:{exp_i}", sig or "")


def callback_signature(timestamp: int, body: str) -> str:
    return sign(f"{timestamp}.{body}")


class UnsafeUrl(ValueError):
    pass


def assert_public_url(url: str) -> None:
    """Reject anything that is not plain http(s) to a public address."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeUrl("Only http(s) URLs are supported.")
    if config.ALLOW_PRIVATE_URLS:
        return
    host = parsed.hostname
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnsafeUrl(f"Could not resolve host {host}.") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise UnsafeUrl("URL points to a non-public address.")
