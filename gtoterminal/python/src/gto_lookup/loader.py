"""Data loading utilities.

The pre-computed data ships as browser ``.js`` files (``GTO.Data.X = {...};``)
and per-board river ``.json`` files. This module extracts the embedded JSON and
provides an LRU-bounded loader for the heavy river chunks so that not all river
data has to be resident in RAM at once.
"""
from __future__ import annotations

import json
import os
import re
from collections import OrderedDict
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Relaxed JS-object -> JSON normalization
# ---------------------------------------------------------------------------
# Auto-generated data files are strict JSON, but the hand-written preflop
# ranges use single-quoted strings, bare identifier keys and comments. When
# json.loads fails we normalize the literal to strict JSON and retry.


def _relaxed_to_json(text: str) -> str:
    out: List[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        # line comment
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        # block comment
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        # double-quoted string: copy verbatim
        if ch == '"':
            out.append(ch)
            i += 1
            while i < n:
                out.append(text[i])
                if text[i] == "\\":
                    i += 1
                    if i < n:
                        out.append(text[i])
                        i += 1
                    continue
                if text[i] == '"':
                    i += 1
                    break
                i += 1
            continue
        # single-quoted string -> double-quoted
        if ch == "'":
            i += 1
            buf: List[str] = []
            while i < n:
                c = text[i]
                if c == "\\":
                    buf.append(c)
                    i += 1
                    if i < n:
                        buf.append(text[i])
                        i += 1
                    continue
                if c == "'":
                    i += 1
                    break
                buf.append(c)
                i += 1
            s = "".join(buf).replace('"', '\\"')
            out.append('"' + s + '"')
            continue
        out.append(ch)
        i += 1

    result = "".join(out)
    # Quote bare identifier keys: {key:  or ,key:  ->  {"key":
    result = re.sub(r'([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)', r'\1"\2"\3', result)
    # Remove trailing commas before } or ]
    result = re.sub(r",(\s*[}\]])", r"\1", result)
    return result


def _loads(literal: str) -> Dict[str, Any]:
    try:
        return json.loads(literal)
    except json.JSONDecodeError:
        return json.loads(_relaxed_to_json(literal))


# ---------------------------------------------------------------------------
# JS -> JSON extraction
# ---------------------------------------------------------------------------


def _find_object_literal(text: str, start: int) -> str:
    """Return the balanced ``{...}`` object literal beginning at/after ``start``.

    Brace-counts while skipping over string literals and comments so braces
    inside strings don't break the match.
    """
    i = text.index("{", start)
    depth = 0
    in_str: Optional[str] = None
    escaped = False
    j = i
    n = len(text)
    while j < n:
        ch = text[j]
        if in_str is not None:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == in_str:
                in_str = None
        else:
            if ch in ('"', "'"):
                in_str = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[i : j + 1]
        j += 1
    raise ValueError("Unbalanced object literal in data file")


def load_js_object(path: str, var: Optional[str] = None) -> Dict[str, Any]:
    """Load a JSON object embedded in a ``.js`` assignment.

    If ``var`` (e.g. ``GTO.Data.PostflopSolutions_SRP``) is given, the object
    literal is taken from ``<var> = {...}``. Otherwise the last top-level
    assignment's object literal is used. Plain ``.json`` files are parsed
    directly.
    """
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()

    if path.endswith(".json"):
        return _loads(text)

    if var:
        marker = var + " ="
        idx = text.find(marker)
        if idx < 0:
            # tolerate arbitrary whitespace around '='
            marker2 = var
            idx = text.find(marker2)
            if idx < 0:
                raise KeyError(f"Variable '{var}' not found in {path}")
            idx = text.index("=", idx)
        else:
            idx += len(marker) - 1  # position at '='
        literal = _find_object_literal(text, idx)
        return _loads(literal)

    # No var: use the last '= {' assignment in the file.
    last = text.rfind("= {")
    if last < 0:
        last = text.rfind("={")
    if last < 0:
        raise ValueError(f"No object assignment found in {path}")
    literal = _find_object_literal(text, last)
    return _loads(literal)


# ---------------------------------------------------------------------------
# LRU river chunk cache
# ---------------------------------------------------------------------------


class RiverCache:
    """Bounded cache of river chunks. A *chunk* is one river file, i.e. all
    river nodes for a single (bet_level, matchup, board). At most ``max_chunks``
    are kept resident; the least-recently-used chunk is evicted on overflow.

    This is what keeps the (very large) river data from having to live in RAM
    all at once: only the boards you actually query stay loaded.
    """

    def __init__(self, max_chunks: int = 4):
        self.max_chunks = max(1, int(max_chunks))
        self._store: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self.loads = 0
        self.hits = 0
        self.evictions = 0

    @staticmethod
    def _key(bet_level: str, matchup: str, board: str) -> str:
        return f"{bet_level}/{matchup}/{board}"

    def get(self, bet_level: str, matchup: str, board: str) -> Optional[Dict[str, Any]]:
        key = self._key(bet_level, matchup, board)
        if key in self._store:
            self.hits += 1
            self._store.move_to_end(key)
            return self._store[key]
        return None

    def put(self, bet_level: str, matchup: str, board: str, data: Dict[str, Any]) -> None:
        key = self._key(bet_level, matchup, board)
        self._store[key] = data
        self._store.move_to_end(key)
        self.loads += 1
        while len(self._store) > self.max_chunks:
            self._store.popitem(last=False)
            self.evictions += 1

    def contains(self, bet_level: str, matchup: str, board: str) -> bool:
        return self._key(bet_level, matchup, board) in self._store

    def clear(self) -> None:
        self._store.clear()

    def resident(self) -> List[str]:
        return list(self._store.keys())

    def stats(self) -> Dict[str, int]:
        return {
            "resident": len(self._store),
            "max_chunks": self.max_chunks,
            "loads": self.loads,
            "hits": self.hits,
            "evictions": self.evictions,
        }


def load_river_file(river_dir: str, matchup: str, board: str) -> Optional[Dict[str, Any]]:
    """Load one river chunk file: ``<river_dir>/<matchup>/<board>.json``.

    Returns None if the file does not exist (so the caller can fall back).
    """
    path = os.path.join(river_dir, matchup, f"{board}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)
