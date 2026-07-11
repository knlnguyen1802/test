"""Configuration loading for the GTO lookup API.

The config is a JSON file that tells the API *where* the pre-computed solution
data lives, so the data can be swapped without touching code. See
``gto_config.example.json`` for the schema.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class SourceRef:
    """A single data source: a file (`path`) with an optional JS global `var`,
    or a directory (`dir`) for per-chunk river files."""

    path: Optional[str] = None
    var: Optional[str] = None
    dir: Optional[str] = None


@dataclass
class PreflopConfig:
    path: str
    var: Optional[str] = None
    case: str = "cash"
    stack: str = "100bb"


@dataclass
class BetLevelConfig:
    flop: Optional[SourceRef] = None
    turn: Optional[SourceRef] = None
    river: Optional[SourceRef] = None


@dataclass
class Config:
    data_root: str
    preflop: Optional[PreflopConfig]
    bet_levels: Dict[str, BetLevelConfig] = field(default_factory=dict)
    river_cache_max_chunks: int = 4

    def resolve(self, rel: str) -> str:
        """Resolve a config-relative path against ``data_root``."""
        if os.path.isabs(rel):
            return rel
        return os.path.normpath(os.path.join(self.data_root, rel))


def _drop_comment_keys(obj: dict) -> dict:
    """Ignore keys starting with '//' (used for inline documentation)."""
    return {k: v for k, v in obj.items() if not k.startswith("//")}


def _source_ref(obj: Optional[dict]) -> Optional[SourceRef]:
    if not obj:
        return None
    obj = _drop_comment_keys(obj)
    return SourceRef(path=obj.get("path"), var=obj.get("var"), dir=obj.get("dir"))


# Environment variable that overrides ``data_root`` for any config, so a
# consumer can install the package and point at the data with one env var
# instead of editing/copying a config file.
DATA_ROOT_ENV = "GTO_DATA_ROOT"


def _resolve_data_root(raw_data_root: str, base_dir: Optional[str]) -> str:
    """Resolve ``data_root``. Precedence: ``GTO_DATA_ROOT`` env var, then the
    given value. Relative values are resolved against ``base_dir`` (the config
    file's directory), or the current working directory if ``base_dir`` is
    None."""
    data_root = os.environ.get(DATA_ROOT_ENV) or raw_data_root or "."
    if os.path.isabs(data_root):
        return os.path.normpath(data_root)
    anchor = base_dir if base_dir is not None else os.getcwd()
    return os.path.normpath(os.path.join(anchor, data_root))


def config_from_dict(raw: dict, base_dir: Optional[str] = None) -> Config:
    """Build a :class:`Config` from a plain dict (no file needed).

    ``base_dir`` anchors relative ``data_root`` / paths; pass the directory the
    paths are relative to, or leave None to use the current working directory.
    The ``GTO_DATA_ROOT`` env var still overrides ``data_root`` if set.
    """
    raw = _drop_comment_keys(raw)
    data_root = _resolve_data_root(raw.get("data_root", "."), base_dir)

    preflop = None
    if raw.get("preflop"):
        p = _drop_comment_keys(raw["preflop"])
        preflop = PreflopConfig(
            path=p["path"],
            var=p.get("var"),
            case=p.get("case", "cash"),
            stack=p.get("stack", "100bb"),
        )

    bet_levels: Dict[str, BetLevelConfig] = {}
    for level, spec in _drop_comment_keys(raw.get("bet_levels", {})).items():
        spec = _drop_comment_keys(spec)
        bet_levels[level] = BetLevelConfig(
            flop=_source_ref(spec.get("flop")),
            turn=_source_ref(spec.get("turn")),
            river=_source_ref(spec.get("river")),
        )

    river_cache = _drop_comment_keys(raw.get("river_cache", {}))
    max_chunks = int(river_cache.get("max_chunks", 4))

    return Config(
        data_root=data_root,
        preflop=preflop,
        bet_levels=bet_levels,
        river_cache_max_chunks=max_chunks,
    )


def load_config(config_path: str) -> Config:
    """Load and validate a JSON config file.

    ``data_root`` is resolved relative to the config file's own directory, so a
    config can ship next to the data it points at. The ``GTO_DATA_ROOT`` env
    var overrides ``data_root`` when set.
    """
    config_path = os.path.abspath(config_path)
    with open(config_path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    return config_from_dict(raw, base_dir=os.path.dirname(config_path))
