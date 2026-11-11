import os
import sys
import tempfile
from pathlib import Path

os.environ["SHARED_SECRET"] = "test-secret"
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="tarjim-test-")
os.environ["ALLOW_PRIVATE_URLS"] = "0"
os.environ["PRELOAD_MODELS"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
