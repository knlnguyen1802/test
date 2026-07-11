"""Game-tree line parsing: map an action ``line`` to solved nodes.

The pre-computed data stores only **two** bet sizes per street (small / large)
and a fixed vocabulary of decision nodes. This module normalizes an arbitrary
``line`` into that vocabulary.

Canonical action tokens (case-insensitive)::

    X            check
    B / BS       bet small        (first configured size)
    BL           bet large        (second configured size)
    B<pct>       bet <pct>% pot   -> bucketed to small/large by the midpoint
    C            call
    R            raise
    F            fold

Two structures are addressed:

* **Flop** decision nodes are *named* (``ip_cbet`` etc.).
* **Turn / river** decision nodes are the 10 indexed slots ``s[0..9]``.

A street "closes" (advances to the next chance card) via one of the 9
``ACTION_LINES``. A full turn/river line is therefore
``<flop-closing-line> [+ <turn-closing-line>] + <current-street-path>``.
"""
from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Normalized token constants
# ---------------------------------------------------------------------------
X = "X"       # check
BS = "BS"     # bet small
BL = "BL"     # bet large
C = "C"       # call
R = "R"       # raise
F = "F"       # fold

# Boundary between "small" and "large" bet buckets, in % of pot.
_SMALL_LARGE_MIDPOINT = 55


def normalize_token(tok: str) -> str:
    """Normalize a raw line token to the {X,BS,BL,C,R,F} vocabulary."""
    t = tok.strip().upper()
    if t in (X, "CHECK", "CH"):
        return X
    if t in (C, "CALL"):
        return C
    if t in (R, "RAISE"):
        return R
    if t in (F, "FOLD"):
        return F
    if t in (BS, "BETSMALL"):
        return BS
    if t in (BL, "BETLARGE"):
        return BL
    if t.startswith("B"):
        num = t[1:]
        if num == "" or num == "ET":  # bare 'B' / 'BET'
            return BS
        # strip a trailing % and any non-digits
        digits = "".join(ch for ch in num if ch.isdigit())
        if not digits:
            return BS
        pct = int(digits)
        return BS if pct < _SMALL_LARGE_MIDPOINT else BL
    # Unknown -> treat as check (safest no-op).
    return X


def normalize_line(line: Sequence[str]) -> List[str]:
    return [normalize_token(t) for t in (line or [])]


# ---------------------------------------------------------------------------
# 10 decision-node slots (index -> selector path from the street root).
# Matches solver-native StreetNodes / precompute extractStreetNodes ordering.
# ---------------------------------------------------------------------------
SLOT_PATHS: List[Tuple[str, ...]] = [
    (),                 # 0  OOP first to act
    (X,),               # 1  IP after OOP check
    (BS,),              # 2  IP facing OOP bet small
    (X, BS),            # 3  OOP facing IP probe small
    (BS, R),            # 4  OOP facing raise (bet small)
    (BL, R),            # 5  OOP facing raise (bet large)
    (X, BS, R),         # 6  IP facing check-raise (bet small)
    (X, BL, R),         # 7  IP facing check-raise (bet large)
    (BL,),              # 8  IP facing OOP bet large
    (X, BL),            # 9  OOP facing IP probe large
]
_SLOT_BY_PATH = {path: i for i, path in enumerate(SLOT_PATHS)}

# Flop uses named nodes instead of indices. Slot index -> flop node name.
# (Slot 0 has no named node: it is the flop root's aggregate strategy.)
FLOP_NODE_BY_SLOT = {
    1: "ip_cbet",
    2: "ip_facing_cbet",
    8: "ip_facing_cbet_large",
    3: "oop_facing_cbet",
    9: "oop_facing_cbet_large",
    4: "oop_facing_raise_small",
    5: "oop_facing_raise_large",
    6: "ip_facing_raise_small",
    7: "ip_facing_raise_large",
}

# ---------------------------------------------------------------------------
# 9 action lines that close a street (reach the next chance node).
# name -> normalized token sequence.
# ---------------------------------------------------------------------------
ACTION_LINES = {
    "check_check":           (X, X),
    "bet_small_call":        (BS, C),
    "bet_large_call":        (BL, C),
    "xbet_small_call":       (X, BS, C),
    "xbet_large_call":       (X, BL, C),
    "bet_small_raise_call":  (BS, R, C),
    "bet_large_raise_call":  (BL, R, C),
    "xbet_small_raise_call": (X, BS, R, C),
    "xbet_large_raise_call": (X, BL, R, C),
}
# Longest first, so greedy matching prefers the most specific closing line.
_CLOSING_ORDER = sorted(ACTION_LINES.items(), key=lambda kv: -len(kv[1]))


def match_slot(path: Sequence[str]) -> Optional[int]:
    """Resolve a within-street decision path to a slot index (0..9), or None."""
    return _SLOT_BY_PATH.get(tuple(path))


def _consume_closing_line(tokens: Sequence[str]) -> Optional[Tuple[str, int]]:
    """If ``tokens`` starts with a street-closing line, return (line_name,
    length_consumed). Longest match wins."""
    for name, seq in _CLOSING_ORDER:
        n = len(seq)
        if tuple(tokens[:n]) == seq:
            return name, n
    return None


class ParsedLine:
    """The result of splitting a line across streets.

    Attributes
    ----------
    street : 'flop' | 'turn' | 'river'   (derived from board length)
    flop_line, turn_line : str | None     closing-line names for prior streets
    slot : int | None                     current-street decision slot (0..9)
    tokens : list                         normalized tokens
    """

    __slots__ = ("street", "flop_line", "turn_line", "slot", "tokens")

    def __init__(self, street, flop_line, turn_line, slot, tokens):
        self.street = street
        self.flop_line = flop_line
        self.turn_line = turn_line
        self.slot = slot
        self.tokens = tokens

    def __repr__(self):  # pragma: no cover - debug aid
        return (
            f"ParsedLine(street={self.street!r}, flop_line={self.flop_line!r}, "
            f"turn_line={self.turn_line!r}, slot={self.slot!r})"
        )


def parse_line(line: Sequence[str], board_len: int) -> ParsedLine:
    """Split a raw action ``line`` into per-street segments given the board size.

    - board_len == 3 -> flop:  whole line is the flop decision path.
    - board_len == 4 -> turn:  <flop-closing-line> + turn decision path.
    - board_len == 5 -> river: <flop-closing-line> + <turn-closing-line> + path.
    """
    tokens = normalize_line(line)

    if board_len <= 3:
        return ParsedLine("flop", None, None, match_slot(tokens), tokens)

    pos = 0
    flop_line = None
    turn_line = None

    closing = _consume_closing_line(tokens[pos:])
    if closing:
        flop_line, n = closing
        pos += n

    if board_len == 4:
        slot = match_slot(tokens[pos:])
        return ParsedLine("turn", flop_line, None, slot, tokens)

    # river
    closing = _consume_closing_line(tokens[pos:])
    if closing:
        turn_line, n = closing
        pos += n
    slot = match_slot(tokens[pos:])
    return ParsedLine("river", flop_line, turn_line, slot, tokens)
