"""HTTP to the Cloudflare Worker (progress callbacks, files relayed from Telegram).

A Space's container cannot reliably open connections over IPv6, but *.workers.dev resolves
to IPv6 addresses as well as IPv4 ones. Left to choose, httpx sometimes picks an IPv6 address
and the call fails with ConnectError or hangs until ConnectTimeout. So these calls bind to an
IPv4 local address, which forces IPv4. Connection failures are also retried by the transport.
"""
from __future__ import annotations

import httpx

from . import config


def client(timeout: httpx.Timeout | float) -> httpx.Client:
    transport = httpx.HTTPTransport(
        local_address="0.0.0.0" if config.WORKER_FORCE_IPV4 else None,
        retries=config.WORKER_CONNECT_RETRIES,
    )
    return httpx.Client(transport=transport, timeout=timeout, follow_redirects=True)
