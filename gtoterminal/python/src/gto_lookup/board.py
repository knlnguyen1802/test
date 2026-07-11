"""Card parsing and board generalization.

Ports the board texture / anchor / closest-board logic from
``js/solver/solver-cache.js`` so a real flop can be mapped to the nearest
solved sample board. See ``gtoterminal/BOARD.md``.
"""
from __future__ import annotations

from typing import List, Optional, Sequence

RANKS = "23456789TJQKA"   # index 0..12  (2=0 .. A=12)
SUITS = "cdhs"


def rank_index(card: str) -> int:
    """Rank of a 2-char card like 'Ah' -> 0..12 (2=0 .. A=12)."""
    return RANKS.index(card[0].upper())


def suit_index(card: str) -> int:
    return SUITS.index(card[1].lower())


def normalize_card(card: str) -> str:
    return card[0].upper() + card[1].lower()


# ---------------------------------------------------------------------------
# Texture classification (mirror of solver-cache.js classifyTexture)
# ---------------------------------------------------------------------------

def classify_texture(board: Sequence[str]) -> str:
    if not board or len(board) < 3:
        return "dry_rainbow"

    flop = list(board[:3])
    ranks = [rank_index(c) for c in flop]
    suits = [suit_index(c) for c in flop]

    suit_counts: dict = {}
    for s in suits:
        suit_counts[s] = suit_counts.get(s, 0) + 1
    max_suit = max(suit_counts.values())

    rank_counts: dict = {}
    for r in ranks:
        rank_counts[r] = rank_counts.get(r, 0) + 1
    is_paired = any(c >= 2 for c in rank_counts.values())

    unique: List[int] = []
    seen = set()
    for r in ranks:
        if r not in seen:
            unique.append(r)
            seen.add(r)
    unique.sort(reverse=True)

    connected = 0
    for i in range(len(unique) - 1):
        if unique[i] - unique[i + 1] <= 2:
            connected += 1
    # Wheel potential (Ace low): A present and some card <= 3 (rank index of 5 is 3)
    if 12 in seen and any(r <= 3 for r in unique):
        connected += 1

    span = unique[0] - unique[-1] if len(unique) >= 1 else 0
    is_wet = connected >= 2 or (len(unique) >= 3 and span <= 4)
    is_highly_connected = connected >= 3 or (
        len(unique) >= 3 and span <= 3 and not is_paired
    )

    if max_suit >= 3:
        return "monotone"
    if is_highly_connected and not is_paired:
        return "highly_connected"
    if is_paired:
        return "paired_wet" if is_wet else "paired_dry"
    is_two_tone = max_suit >= 2
    if is_wet:
        return "wet_twotone" if is_two_tone else "wet_rainbow"
    return "dry_twotone" if is_two_tone else "dry_rainbow"


def anchor_rank(board: Sequence[str]) -> int:
    """Strategically dominant rank: pair rank if paired, else the top card."""
    ranks = [rank_index(c) for c in board[:3]]
    counts: dict = {}
    for r in ranks:
        counts[r] = counts.get(r, 0) + 1
    pair_rank = -1
    for r, c in counts.items():
        if c >= 2 and r > pair_rank:
            pair_rank = r
    return pair_rank if pair_rank >= 0 else max(ranks)


# ---------------------------------------------------------------------------
# Solved sample boards (must stay in sync with solver-cache.js / BOARD.md §3)
# ---------------------------------------------------------------------------

TEXTURE_BOARDS = {
    "dry_rainbow":      ["A72r", "K83r", "Q62r", "J74r", "852r"],
    "dry_twotone":      ["A72tt", "K92tt", "Q74tt", "J83tt", "852tt"],
    "wet_rainbow":      ["QT8r", "J97r", "T86r", "864r"],
    "wet_twotone":      ["QT8tt", "J97tt", "T86tt", "864tt"],
    "monotone":         ["AT6sss", "KT4sss", "853sss"],
    "paired_dry":       ["AA8r", "KK4r", "992r", "772r"],
    "paired_wet":       ["JJ9r", "TT8r", "887r", "553r"],
    "highly_connected": ["AKQr", "KQTr", "JT9r", "T98r", "765r"],
}

TEXTURE_FALLBACK = {
    "paired_wet": "paired_dry",
    "wet_twotone": "wet_rainbow",
    "dry_twotone": "dry_rainbow",
    "highly_connected": "wet_rainbow",
    "monotone": "wet_twotone",
}

BOARD_ANCHOR = {
    "A72r": 12, "K83r": 11, "Q62r": 10, "J74r": 9, "852r": 6,
    "A72tt": 12, "K92tt": 11, "Q74tt": 10, "J83tt": 9, "852tt": 6,
    "QT8r": 10, "J97r": 9, "T86r": 8, "864r": 6,
    "QT8tt": 10, "J97tt": 9, "T86tt": 8, "864tt": 6,
    "AT6sss": 12, "KT4sss": 11, "853sss": 6,
    "AA8r": 12, "KK4r": 11, "992r": 7, "772r": 5,
    "JJ9r": 9, "TT8r": 8, "887r": 6, "553r": 3,
    "AKQr": 12, "KQTr": 11, "JT9r": 9, "T98r": 8, "765r": 5,
}


def find_closest_board(
    texture: str,
    board: Sequence[str],
    available: Optional[Sequence[str]] = None,
) -> Optional[str]:
    """Return the solved board label of ``texture`` nearest to ``board`` by
    anchor rank. If ``available`` is given, restrict candidates to labels that
    actually exist in the loaded data (so we never point at a missing board)."""
    candidates = TEXTURE_BOARDS.get(texture)
    if (not candidates) and texture in TEXTURE_FALLBACK:
        candidates = TEXTURE_BOARDS.get(TEXTURE_FALLBACK[texture])
    if not candidates:
        return None

    if available is not None:
        avail = set(available)
        filtered = [c for c in candidates if c in avail]
        # Fall back to any available board of a sibling texture, else anything.
        if not filtered:
            sib = TEXTURE_FALLBACK.get(texture)
            if sib:
                filtered = [c for c in TEXTURE_BOARDS.get(sib, []) if c in avail]
        if not filtered:
            filtered = list(avail)
        candidates = filtered

    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    a = anchor_rank(board)
    best = candidates[0]
    best_dist = 999
    for c in candidates:
        cand_anchor = BOARD_ANCHOR.get(c)
        if cand_anchor is None:
            continue
        dist = abs(cand_anchor - a)
        if dist < best_dist:
            best_dist = dist
            best = c
    return best
