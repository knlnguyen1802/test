"""Hand-strength classification into the 18 solver buckets.

Faithful port of ``GTO.Data.BoardCategories.classifyHandStrength`` from
``js/data/board-categories.js``. Ranks here use poker values 2..14 (Ace = 14),
which differ from the 0..12 indices in :mod:`gto_lookup.board`.
"""
from __future__ import annotations

from typing import List, Sequence

HAND_STRENGTHS = [
    "air", "overcards", "weak_draw", "gutshot", "combo_draw", "oesd_or_fd",
    "underpair", "weak_pair", "second_pair", "top_pair_weak", "top_pair_strong",
    "overpair", "two_pair", "trips", "set", "straight", "flush", "full_house",
]

_RANK_VALUE = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
}


def _rv(card: str) -> int:
    return _RANK_VALUE[card[0].upper()]


def _suit(card: str) -> str:
    return card[1].lower()


def _has_straight(all_ranks: Sequence[int], hole_ranks: Sequence[int]) -> bool:
    unique = sorted(set(all_ranks))
    if 14 in unique:
        unique = [1] + unique
    for i in range(len(unique) - 4):
        window = unique[i:i + 5]
        if window[4] - window[0] == 4 and all(
            window[j] - window[j - 1] == 1 for j in range(1, 5)
        ):
            uses_hole = any(
                (hr in window) or (hr == 14 and 1 in window) for hr in hole_ranks
            )
            if uses_hole:
                return True
    return False


def _straight_draw_info(all_ranks: Sequence[int], hole_ranks: Sequence[int]):
    unique = sorted(set(all_ranks))
    if 14 in unique:
        unique = [1] + unique
    has_oesd = False
    has_gutshot = False
    for i in range(len(unique) - 3):
        window = unique[i:i + 4]
        span = window[3] - window[0]
        if span == 3 and all(window[j] - window[j - 1] == 1 for j in range(1, 4)):
            uses_hole = any(
                (hr in window) or (hr == 14 and 1 in window) for hr in hole_ranks
            )
            if uses_hole:
                low_end, high_end = window[0], window[3]
                if low_end > 1 and high_end < 14:
                    has_oesd = True
                else:
                    has_gutshot = True
        if span == 4 and not has_oesd:
            gaps = 0
            for j in range(1, 4):
                d = window[j] - window[j - 1]
                if d == 2:
                    gaps += 1
                elif d > 2:
                    gaps += 2
            if gaps == 1:
                uses_hole = any(
                    (hr in window) or (hr == 14 and 1 in window) for hr in hole_ranks
                )
                if uses_hole:
                    has_gutshot = True
    return has_oesd, has_gutshot


def classify_hand(hole: Sequence[str], board: Sequence[str]) -> str:
    """Return one of the 18 :data:`HAND_STRENGTHS` for ``hole`` on ``board``."""
    if not hole or len(hole) < 2 or not board or len(board) < 3:
        return "air"

    hole_ranks = [_rv(c) for c in hole]
    board_ranks = [_rv(c) for c in board]
    hole_suits = [_suit(c) for c in hole]
    board_suits = [_suit(c) for c in board]
    all_ranks = hole_ranks + board_ranks
    all_suits = hole_suits + board_suits
    board_max = max(board_ranks)
    board_sorted = sorted(board_ranks, reverse=True)

    # --- Flush ---
    suit_counts: dict = {}
    for s in all_suits:
        suit_counts[s] = suit_counts.get(s, 0) + 1
    has_flush = any(
        cnt >= 5 and suit in hole_suits for suit, cnt in suit_counts.items()
    )

    has_straight = _has_straight(all_ranks, hole_ranks)

    all_rank_counts: dict = {}
    for r in all_ranks:
        all_rank_counts[r] = all_rank_counts.get(r, 0) + 1
    board_rank_counts: dict = {}
    for r in board_ranks:
        board_rank_counts[r] = board_rank_counts.get(r, 0) + 1

    is_pocket_pair = hole_ranks[0] == hole_ranks[1]

    # --- Full house ---
    three_of_a_kind = [r for r, c in all_rank_counts.items() if c >= 3]
    pairs_all = [r for r, c in all_rank_counts.items() if c >= 2]
    has_full_house = False
    if len(three_of_a_kind) >= 1 and len(pairs_all) >= 2:
        if any(hr in three_of_a_kind or hr in pairs_all for hr in hole_ranks):
            has_full_house = True
    if len(three_of_a_kind) >= 2:
        has_full_house = True

    if has_full_house:
        return "full_house"
    if has_flush:
        return "flush"
    if has_straight:
        return "straight"

    # --- Set ---
    if is_pocket_pair and hole_ranks[0] in board_ranks:
        return "set"

    # --- Trips ---
    if any(board_rank_counts.get(hr, 0) >= 2 for hr in hole_ranks):
        return "trips"

    # --- Two pair ---
    pair_count = 0
    paired_ranks: List[int] = []
    for hr in hole_ranks:
        if hr in board_ranks:
            pair_count += 1
            paired_ranks.append(hr)
    if pair_count >= 2:
        return "two_pair"
    if is_pocket_pair and pair_count >= 1 and hole_ranks[0] not in paired_ranks:
        return "two_pair"

    # --- Made pairs ---
    if is_pocket_pair and hole_ranks[0] > board_max:
        return "overpair"

    if pair_count >= 1:
        paired_rank = paired_ranks[0]
        if paired_rank == board_max:
            kicker = hole_ranks[1] if hole_ranks[0] == paired_rank else hole_ranks[0]
            return "top_pair_strong" if kicker >= 11 else "top_pair_weak"
        if len(board_sorted) >= 2 and paired_rank == board_sorted[1]:
            return "second_pair"
        return "weak_pair"

    if is_pocket_pair and hole_ranks[0] < min(board_ranks):
        return "underpair"
    if is_pocket_pair:
        return "weak_pair"

    # --- Draws ---
    has_flush_draw = any(
        cnt == 4 and suit in hole_suits for suit, cnt in suit_counts.items()
    )
    has_oesd, has_gutshot = _straight_draw_info(all_ranks, hole_ranks)

    if has_flush_draw and (has_oesd or has_gutshot):
        return "combo_draw"
    if has_flush_draw or has_oesd:
        return "oesd_or_fd"
    if has_gutshot:
        return "gutshot"

    # Backdoor flush (flop only)
    if len(board) == 3:
        has_backdoor_flush = any(
            cnt == 3 and suit in hole_suits for suit, cnt in suit_counts.items()
        )
        if has_backdoor_flush:
            return "weak_draw"

    if hole_ranks[0] > board_max and hole_ranks[1] > board_max:
        return "overcards"

    return "air"
