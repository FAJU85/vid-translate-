"""KAVOX backend on Modal: the same server as the Hugging Face Space, on a GPU that runs only while
there is work (paid by the second, nothing while idle).

Nothing in app/ changes: this file builds the Space's own Dockerfile, adds the GPU libraries and
serves app.main on a Modal web address. Switching is one setting in Cloudflare (BACKEND_URL);
switching back is the same setting. The steps are in README.md, "Run on Modal".

One container at a time (max_containers=1): jobs, uploads and result files live in that
container, so every request must reach it. A GPU makes each video several times faster, which is
where the extra capacity comes from.
"""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

import modal

APP_NAME = "kavox-backend"
HERE = Path(__file__).parent
SITE = "/home/user/.local/lib/python3.12/site-packages"  # where the Dockerfile installs the packages
NVIDIA = "/usr/local/lib/python3.12/site-packages/nvidia"

image = (
    modal.Image.from_dockerfile(HERE / "Dockerfile", context_dir=HERE)
    # CUDA 12 + cuDNN 9 for faster-whisper / CTranslate2 (they find the GPU by themselves).
    .dockerfile_commands(["USER root"])
    .pip_install("nvidia-cublas-cu12", "nvidia-cudnn-cu12==9.*")
    .env(
        {
            "PYTHONPATH": f"/home/user/app:{SITE}",
            "LD_LIBRARY_PATH": f"{NVIDIA}/cublas/lib:{NVIDIA}/cudnn/lib",
            "HF_HOME": "/home/user/.cache/huggingface",  # the models baked in by the Dockerfile
            "WORKER_FORCE_IPV4": "0",  # only the Space needs IPv4-only
        }
    )
)

app = modal.App(APP_NAME, image=image)

# Seconds between keep-alive calls while a video is in progress (Modal stops a container that
# receives no requests; a job runs in the background, after its request has been answered).
KEEP_ALIVE_EVERY = 60


def _own_url() -> str | None:
    url = os.environ.get("KAVOX_PUBLIC_URL")
    if url:
        return url.rstrip("/")
    try:
        return modal.Function.from_name(APP_NAME, "web").get_web_url().rstrip("/")
    except Exception:
        return None


def _keep_alive(manager) -> None:
    import httpx

    url = None
    while True:
        time.sleep(KEEP_ALIVE_EVERY)
        if manager.pending_count() == 0:
            continue
        url = url or _own_url()
        if not url:
            continue
        try:
            httpx.get(f"{url}/health", timeout=10)
        except Exception:
            pass  # next minute


@app.function(
    gpu=os.environ.get("KAVOX_GPU", "L4"),
    secrets=[modal.Secret.from_name("kavox-backend")],
    max_containers=1,
    scaledown_window=10 * 60,  # stay up 10 minutes after the last request (result downloads)
    timeout=60 * 60,
)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def web():
    os.chdir("/home/user/app")
    if "/home/user/app" not in sys.path:
        sys.path.insert(0, "/home/user/app")
    from app.main import app as server
    from app.modules.jobs import manager

    threading.Thread(target=_keep_alive, args=(manager,), name="keep-alive", daemon=True).start()
    return server
