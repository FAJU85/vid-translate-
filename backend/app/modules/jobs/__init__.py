"""Jobs brick: the job queue and the pipeline that composes the other bricks.

Public interface: the ``Job`` record, the shared ``manager`` and the file/stage constants.
"""
from .manager import JobManager, manager
from .model import KEPT_SOURCE, OUTPUT_FILES, TERMINAL, OUTRO_UPLOAD, UPLOAD_NAME, Job

__all__ = ["Job", "JobManager", "KEPT_SOURCE", "OUTPUT_FILES", "OUTRO_UPLOAD", "TERMINAL", "UPLOAD_NAME", "manager"]
