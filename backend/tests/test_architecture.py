"""Enforces the brick rules (see ARCHITECTURE.md).

* ``app.shared`` (baseplate) never imports a brick or a base.
* A brick reaches another brick only through its package (``app.modules.<brick>``),
  never through one of its internal files, and never imports a base.
* A base (``app.main``, ``app.preload``) also uses bricks only through their packages.
"""
from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
BASES = {"app.main", "app.preload"}


def module_name(path: Path) -> str:
    rel = path.relative_to(APP.parent).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def imported_names(path: Path) -> list[str]:
    """Absolute names of everything a file imports (``from a import b`` yields ``a.b``)."""
    mod = module_name(path)
    package = mod if path.name == "__init__.py" else mod.rsplit(".", 1)[0]
    names: list[str] = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base_parts = package.split(".")
                base_parts = base_parts[: len(base_parts) - (node.level - 1)]
                base = ".".join(base_parts + ([node.module] if node.module else []))
            else:
                base = node.module or ""
            names += [f"{base}.{a.name}" for a in node.names]
    return [n for n in names if n == "app" or n.startswith("app.")]


def brick_of(name: str) -> str | None:
    parts = name.split(".")
    return parts[2] if len(parts) > 2 and parts[:2] == ["app", "modules"] else None


def violations() -> list[str]:
    found = []
    for path in sorted(APP.rglob("*.py")):
        mod = module_name(path)
        own = brick_of(mod)
        for name in imported_names(path):
            target = brick_of(name)
            if mod.startswith("app.shared") and (target or name.split(".")[:2] == ["app", "modules"]
                                                 or any(name.startswith(b) for b in BASES)):
                found.append(f"{mod}: the baseplate must not import {name}")
            elif own and any(name == b or name.startswith(b + ".") for b in BASES):
                found.append(f"{mod}: a brick must not import the base {name}")
            elif target and target != own:
                depth = len(name.split("."))
                # app.modules.<brick> or app.modules.<brick>.<public name> imported from the package
                exported = _exports(target)
                if depth > 4 or (depth == 4 and name.split(".")[3] not in exported):
                    found.append(f"{mod}: imports {name}, an internal of brick '{target}'")
    return found


def _exports(brick: str) -> set[str]:
    tree = ast.parse((APP / "modules" / brick / "__init__.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "__all__" for t in node.targets):
            return {elt.value for elt in node.value.elts}
    return set()


def test_bricks_only_use_each_other_through_their_public_interface():
    assert violations() == []


def test_the_rule_catches_a_reach_into_another_brick(tmp_path, monkeypatch):
    bad = APP / "modules" / "subtitles" / "_boundary_probe.py"
    bad.write_text("from ..media.core import probe\n", encoding="utf-8")
    try:
        assert any("internal of brick 'media'" in v for v in violations())
    finally:
        bad.unlink()


def test_every_brick_declares_its_public_interface():
    for brick in (APP / "modules").iterdir():
        if brick.is_dir() and not brick.name.startswith("_"):
            assert _exports(brick.name), f"brick '{brick.name}' has no __all__ in its __init__.py"
