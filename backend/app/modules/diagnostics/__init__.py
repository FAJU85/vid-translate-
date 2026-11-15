"""Diagnostics brick (temporary): checks which sites this server can reach, and how.

Public interface: ``network_report``.
"""
from .network import network_report

__all__ = ["network_report"]
