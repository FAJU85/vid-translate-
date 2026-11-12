"""Download model weights at image build time so the Space starts fast."""
from faster_whisper.utils import download_model
from huggingface_hub import snapshot_download

from .shared import config

if __name__ == "__main__":
    download_model(config.WHISPER_MODEL)
    snapshot_download(config.NLLB_MODEL)
