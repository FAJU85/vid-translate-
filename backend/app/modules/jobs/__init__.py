"""Jobs brick: the job queue and the pipeline that composes the other bricks.

Public interface: the ``Job`` record, the shared ``manager`` and the file/stage constants.
"""
from .manager import JobManager, manager
from .model import OUTPUT_FILES, TERMINAL, UPLOAD_NAME, Job

__all__ = ["Job", "JobManager", "OUTPUT_FILES", "TERMINAL", "UPLOAD_NAME", "manager"]
