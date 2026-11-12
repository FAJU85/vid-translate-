"""Bricks (components). Each brick is a package whose ``__init__`` is its only public interface.

Rule: code outside a brick imports ``app.modules.<brick>`` and nothing deeper.
"""
