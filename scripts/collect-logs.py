#!/usr/bin/env python3
"""Print a redacted snapshot of the live system: Hugging Face Space and Cloudflare Worker.

Run by .github/workflows/logs.yml. The repository is public, so its Actions logs are too:
everything printed goes through redact() first. Each section is optional and skipped when the
credentials it needs are missing; one failing section never stops the others.

Environment:
  SPACE_ID, HF_TOKEN                       Space status, build log, run log
  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID  Workers Builds, D1 jobs, live Worker log
  WORKER_NAME, D1_DATABASE_ID, WORKER_URL  what to look at
  TAIL_SECONDS                             how long to record the live Worker log (default 60)
  LOG_LINES                                Space log lines to print (default 300)
  SECRET_VALUES                            newline-separated secret values to mask
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ENV = os.environ
SPACE_ID = ENV.get("SPACE_ID", "")
HF_TOKEN = ENV.get("HF_TOKEN", "")
CF_TOKEN = ENV.get("CLOUDFLARE_API_TOKEN", "")
CF_ACCOUNT = ENV.get("CLOUDFLARE_ACCOUNT_ID", "")
WORKER = ENV.get("WORKER_NAME", "vid-translate")
D1_ID = ENV.get("D1_DATABASE_ID", "")
WORKER_URL = ENV.get("WORKER_URL", "").rstrip("/")
TAIL_SECONDS = int(ENV.get("TAIL_SECONDS") or 60)
LOG_LINES = int(ENV.get("LOG_LINES") or 300)

# ------------------------------------------------------------------ redaction

_SECRETS = sorted(
    {s.strip() for s in (ENV.get("SECRET_VALUES", "") + "\n" + HF_TOKEN + "\n" + CF_TOKEN).splitlines() if len(s.strip()) >= 6},
    key=len,
    reverse=True,
)
_PATTERNS = [
    (re.compile(r"(?i)\b(sig|signature|exp|token|key|secret|password)=([^&\s\"'<>]+)"), r"\1=[redacted]"),
    (re.compile(r"(?i)\b(bearer|bot)\s*[: ]\s*[A-Za-z0-9._:\-]{12,}"), r"\1 [redacted]"),
    (re.compile(r"\b\d{6,12}:[A-Za-z0-9_-]{30,}\b"), "[telegram-token]"),
    (re.compile(r"\bhf_[A-Za-z0-9]{20,}\b"), "[hf-token]"),
    (re.compile(r"\b[0-9a-fA-F]{40,}\b"), "[hex-redacted]"),
    (re.compile(r"(?i)\b(x-signature|x-telegram-bot-api-secret-token|authorization|cookie)([\"']?\s*[:=]\s*[\"']?)[^\"'\s,}]+"), r"\1\2[redacted]"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "[ip]"),
]


def redact(text: str) -> str:
    for value in _SECRETS:
        text = text.replace(value, "[secret]")
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text


def out(text: str = "") -> None:
    print(redact(text), flush=True)


def section(title: str) -> None:
    out("")
    out("=" * 78)
    out(f"== {title}")
    out("=" * 78)


# ------------------------------------------------------------------ http helpers


def http(url: str, token: str = "", method: str = "GET", body: dict | None = None, timeout: float = 30) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    # Cloudflare rejects urllib's default User-Agent (error 1010).
    req = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": "tarjim-logs/1.0"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def cf(path: str, method: str = "GET", body: dict | None = None) -> dict:
    status, text = http(f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}{path}", CF_TOKEN, method, body)
    try:
        data = json.loads(text)
    except ValueError:
        raise RuntimeError(f"HTTP {status}: {text[:200]}") from None
    if not data.get("success", status < 400):
        raise RuntimeError(f"HTTP {status}: {data.get('errors')}")
    return data


def sse_lines(url: str, token: str, seconds: float) -> list[str]:
    """Read a Server-Sent Events log stream for up to `seconds` and return its messages."""
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    lines: list[str] = []
    deadline = time.time() + seconds
    try:
        with urllib.request.urlopen(req, timeout=seconds) as resp:
            while time.time() < deadline:
                raw = resp.readline()
                if not raw:
                    break
                raw = raw.decode("utf-8", "replace").strip()
                if not raw.startswith("data:"):
                    continue
                payload = raw[5:].strip()
                try:
                    item = json.loads(payload)
                    stamp = str(item.get("timestamp", ""))[:19].replace("T", " ")
                    lines.append(f"{stamp}  {str(item.get('data', '')).rstrip()}")
                except ValueError:
                    lines.append(payload)
    except (TimeoutError, OSError):
        pass  # the stream stays open while the Space runs; the deadline ends it
    return lines


def guarded(fn):
    def run() -> None:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - report and carry on with the next section
            out(f"!! {fn.__name__} failed: {exc.__class__.__name__}: {exc}")

    return run


# ------------------------------------------------------------------ sections


@guarded
def health() -> None:
    section("Health")
    targets = [("Space", f"https://{SPACE_ID.replace('/', '-').lower()}.hf.space/health")] if SPACE_ID else []
    if WORKER_URL:
        targets.append(("Worker", f"{WORKER_URL}/api/health"))
    for name, url in targets:
        status, text = http(url, timeout=60)
        out(f"{name}: HTTP {status} {text[:600]}")


@guarded
def space() -> None:
    if not (SPACE_ID and HF_TOKEN):
        section("Hugging Face Space")
        out("skipped: SPACE_ID or HF_TOKEN is not set")
        return
    section(f"Hugging Face Space {SPACE_ID}: runtime")
    status, text = http(f"https://huggingface.co/api/spaces/{SPACE_ID}/runtime", HF_TOKEN)
    try:
        rt = json.loads(text)
        out(json.dumps({k: rt.get(k) for k in ("stage", "hardware", "errorMessage", "sha", "replicas")}, indent=1))
    except ValueError:
        out(f"HTTP {status}: {text[:300]}")

    for kind, seconds in (("build", 15), ("run", 20)):
        section(f"Hugging Face Space {SPACE_ID}: {kind} log (last {LOG_LINES} lines)")
        lines = sse_lines(f"https://huggingface.co/api/spaces/{SPACE_ID}/logs/{kind}", HF_TOKEN, seconds)
        if not lines:
            out("(empty)")
        for line in lines[-LOG_LINES:]:
            out(line)


def _worker_tag() -> str:
    for script in cf("/workers/scripts")["result"]:
        if script.get("id") == WORKER:
            return script.get("tag", "")
    raise RuntimeError(f"Worker {WORKER!r} not found")


@guarded
def builds() -> None:
    section(f"Cloudflare Workers Builds: {WORKER} (latest 6)")
    if not (CF_TOKEN and CF_ACCOUNT):
        out("skipped: CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set")
        return
    items = cf(f"/builds/workers/{_worker_tag()}/builds?per_page=6").get("result") or []
    for b in items:
        meta = b.get("build_trigger_metadata") or {}
        out(f"{b.get('created_on', '')[:19]}  {b.get('status'):8} {str(b.get('build_outcome')):8} "
            f"{meta.get('branch', '')} {str(meta.get('commit_hash', ''))[:7]}  {meta.get('commit_message', '')[:60]!r}")
    failed = next((b for b in items if b.get("build_outcome") == "fail"), None)
    if failed:
        section(f"Cloudflare build log of latest failure {failed.get('build_uuid')}")
        logs = cf(f"/builds/builds/{failed['build_uuid']}/logs").get("result") or {}
        for line in (logs.get("lines") or [])[-60:]:
            out(line[1] if isinstance(line, list) and len(line) > 1 else str(line))


@guarded
def jobs() -> None:
    section("Recent jobs (D1)")
    if not (CF_TOKEN and CF_ACCOUNT and D1_ID):
        out("skipped: Cloudflare credentials or D1_DATABASE_ID missing")
        return
    sql = (
        "SELECT substr(id,1,8) AS id, channel, source_kind AS kind, status, stage, progress, "
        "dispatched, dispatch_attempts AS tries, error_code, "
        "datetime(created_at,'unixepoch') AS created, datetime(updated_at,'unixepoch') AS updated "
        "FROM jobs ORDER BY created_at DESC LIMIT 15"
    )
    rows = cf(f"/d1/database/{D1_ID}/query", "POST", {"sql": sql})["result"][0]["results"]
    if not rows:
        out("(no jobs)")
        return
    cols = list(rows[0])
    widths = {c: max(len(c), *(len(str(r.get(c))) for r in rows)) for c in cols}
    out("  ".join(c.ljust(widths[c]) for c in cols))
    for r in rows:
        out("  ".join(str(r.get(c)).ljust(widths[c]) for c in cols))


@guarded
def tail() -> None:
    section(f"Cloudflare Worker live log: {WORKER} ({TAIL_SECONDS}s)")
    if not (CF_TOKEN and CF_ACCOUNT):
        out("skipped: Cloudflare credentials missing")
        return
    # npx starts wrangler as a child: run them in their own process group and stop the whole group,
    # otherwise the child keeps the output pipe open and this never returns.
    with tempfile.TemporaryFile("w+") as buf:
        proc = subprocess.Popen(
            ["npx", "--yes", "wrangler@4", "tail", WORKER, "--format", "json"],
            stdout=buf, stderr=subprocess.DEVNULL, text=True, start_new_session=True,
        )
        try:
            proc.wait(timeout=TAIL_SECONDS)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
        buf.seek(0)
        stdout = buf.read()
    decoder, i, count = json.JSONDecoder(), 0, 0
    while (j := stdout.find("{", i)) >= 0:
        try:
            event, i = decoder.raw_decode(stdout, j)
        except ValueError:
            i = j + 1
            continue
        count += 1
        ev = event.get("event") or {}
        req = ev.get("request") or {}
        resp = ev.get("response") or {}
        what = ev.get("cron") and f"cron {ev['cron']}" or f"{req.get('method', '')} {req.get('url', '')}"
        stamp = time.strftime("%H:%M:%S", time.gmtime((event.get("eventTimestamp") or 0) / 1000))
        out(f"{stamp}  {event.get('outcome')}  {resp.get('status', '')}  {what}")
        for log in event.get("logs") or []:
            message = " ".join(str(m) for m in log.get("message") or [])
            out(f"          {log.get('level')}: {message[:500]}")
        for exc in event.get("exceptions") or []:
            out(f"          EXCEPTION {exc.get('name')}: {str(exc.get('message'))[:500]}")
    out(f"({count} events)")


def main() -> int:
    out(f"Snapshot at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    for step in (health, space, builds, jobs, tail):
        step()
    return 0


if __name__ == "__main__":
    sys.exit(main())
