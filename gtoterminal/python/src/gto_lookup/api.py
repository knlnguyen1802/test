"""Public lookup API.

``GTOLookup`` wraps all the algorithm logic described in
``gtoterminal/README.md``: matchup keying, seat resolution, board
generalization, game-tree navigation and hand-strength classification. Callers
pass raw game state only.

Loading strategy
----------------
``init()`` loads the light data (preflop ranges + flop + turn nodes for each
configured bet level) fully into RAM. The heavy **river** data is loaded lazily,
one chunk (= one matchup+board file) at a time, through an LRU cache bounded by
``river_cache.max_chunks`` in the config. See the package README for the
rationale and larger-scale alternatives (SQLite index / streaming).
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Sequence

from . import board as board_mod
from . import tree
from .config import Config, config_from_dict, load_config
from .hand_class import classify_hand
from .loader import RiverCache, load_js_object, load_river_file

# Postflop acting order: the player closer to the SB acts first (is OOP).
_POSTFLOP_ORDER = {"SB": 0, "BB": 1, "UTG": 2, "MP": 3, "LJ": 3, "CO": 4, "HJ": 4, "BTN": 5}

# 9-max -> 6-max position aliases (mirror solver-cache.js POSITION_ALIASES).
_POS_ALIAS = {
    "SB": "SB", "BB": "BB", "BTN": "BTN", "BU": "BTN", "BUTTON": "BTN",
    "CO": "CO", "CUTOFF": "CO", "HJ": "CO",
    "UTG": "UTG", "MP": "MP", "LJ": "UTG",
}


def _norm_pos(pos: str) -> str:
    return _POS_ALIAS.get(pos.upper(), pos.upper())


def _parse_actions(actions_str: Optional[str], strategy: Optional[Sequence[float]]) -> List[Dict[str, Any]]:
    """Turn ``"Check:0/Bet:33/Bet:75"`` + ``[0.8,0.13,0.06]`` into structured
    ``[{action, size, freq}, ...]``."""
    if not actions_str:
        return []
    out: List[Dict[str, Any]] = []
    parts = actions_str.split("/")
    strategy = list(strategy or [])
    for i, part in enumerate(parts):
        name, _, size = part.partition(":")
        try:
            size_val = int(size) if size else 0
        except ValueError:
            size_val = 0
        freq = strategy[i] if i < len(strategy) else 0.0
        out.append({"action": name, "size": size_val, "freq": round(float(freq), 4)})
    return out


def _deep_merge(base: Any, extra: Any) -> Any:
    """Recursively merge ``extra`` into ``base`` (dict-only recursion)."""
    if not isinstance(base, dict) or not isinstance(extra, dict):
        return extra
    out = dict(base)
    for k, v in extra.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


class GTOLookup:
    """Entry point for preflop and postflop GTO lookups."""

    def __init__(self, config: Config):
        self.config = config
        self._preflop: Optional[Dict[str, Any]] = None
        # bet_level -> matchup -> board -> flop entry
        self._flop: Dict[str, Dict[str, Any]] = {}
        # bet_level -> matchup -> board -> turn entry
        self._turn: Dict[str, Dict[str, Any]] = {}
        self._river_cache = RiverCache(config.river_cache_max_chunks)
        self._initialized = False

    # ------------------------------------------------------------------ #
    # Construction helpers
    # ------------------------------------------------------------------ #
    @classmethod
    def from_config_file(cls, config_path: str) -> "GTOLookup":
        return cls(load_config(config_path))

    @classmethod
    def from_config_dict(cls, raw: Dict[str, Any], base_dir: Optional[str] = None) -> "GTOLookup":
        """Build from a plain config dict — no config file needed.

        ``base_dir`` anchors relative paths (defaults to the current working
        directory). The ``GTO_DATA_ROOT`` env var overrides ``data_root`` when
        set, so a consumer can just ``pip install`` and point at the data with
        one env var or an in-code dict.

        Example::

            gto = GTOLookup.from_config_dict({
                "data_root": os.environ["GTO_DATA_ROOT"],
                "preflop": {"path": "preflop-ranges.js", "var": "GTO.Data.PreflopRanges"},
                "bet_levels": {"srp": {
                    "flop":  {"path": "postflop-solutions-srp.js",      "var": "GTO.Data.PostflopSolutions_SRP"},
                    "turn":  {"path": "postflop-solutions-turn-srp.js", "var": "GTO.Data.PostflopSolutionsTurn_SRP"},
                    "river": {"dir": "river/srp"},
                }},
            }).init()
        """
        return cls(config_from_dict(raw, base_dir=base_dir))

    # ------------------------------------------------------------------ #
    # init — load light data (preflop + flop + turn) into RAM
    # ------------------------------------------------------------------ #
    def init(self, bet_levels: Optional[Sequence[str]] = None) -> "GTOLookup":
        """Load preflop ranges and, for each bet level, the flop + turn data.

        River data is **not** loaded here — it is fetched per chunk on demand.
        Pass ``bet_levels`` to load only a subset.
        """
        cfg = self.config

        if cfg.preflop:
            path = cfg.resolve(cfg.preflop.path)
            self._preflop = load_js_object(path, cfg.preflop.var)
            # Heuristic add-on ranges are an overlay, not a replacement.
            heuristic_path = os.path.join(
                os.path.dirname(path),
                "preflop-ranges-heuristic-for-solution.js",
            )
            if os.path.exists(heuristic_path):
                heuristic = load_js_object(
                    heuristic_path, "GTO.Data.PreflopRangesHeuristicSolution"
                )
                self._preflop = _deep_merge(self._preflop, heuristic)

        levels = list(bet_levels) if bet_levels else list(cfg.bet_levels.keys())
        for level in levels:
            spec = cfg.bet_levels.get(level)
            if not spec:
                continue
            if spec.flop and spec.flop.path:
                self._flop[level] = load_js_object(
                    cfg.resolve(spec.flop.path), spec.flop.var
                )
            if spec.turn and spec.turn.path:
                self._turn[level] = load_js_object(
                    cfg.resolve(spec.turn.path), spec.turn.var
                )
        self._initialized = True
        return self

    # ------------------------------------------------------------------ #
    # River chunk management (heavy data, lazy)
    # ------------------------------------------------------------------ #
    def _river_dir(self, bet_level: str) -> Optional[str]:
        spec = self.config.bet_levels.get(bet_level)
        if not spec or not spec.river or not spec.river.dir:
            return None
        return self.config.resolve(spec.river.dir)

    def load_river_chunk(self, bet_level: str, matchup: str, board: str) -> bool:
        """Explicitly load one river chunk (matchup+board) into the LRU cache.

        Returns True if loaded (or already resident), False if no file exists.
        Use this to warm the cache ahead of time; otherwise the chunk loads
        automatically on the first river lookup that needs it.
        """
        if self._river_cache.contains(bet_level, matchup, board):
            return True
        river_dir = self._river_dir(bet_level)
        if not river_dir:
            return False
        data = load_river_file(river_dir, matchup, board)
        if data is None:
            return False
        self._river_cache.put(bet_level, matchup, board, data)
        return True

    def _available_river_boards(self, bet_level: str, matchup: str) -> List[str]:
        river_dir = self._river_dir(bet_level)
        if not river_dir:
            return []
        d = os.path.join(river_dir, matchup)
        if not os.path.isdir(d):
            return []
        return [f[:-5] for f in os.listdir(d) if f.endswith(".json")]

    def river_cache_stats(self) -> Dict[str, int]:
        return self._river_cache.stats()

    # ------------------------------------------------------------------ #
    # Preflop lookup
    # ------------------------------------------------------------------ #
    def _preflop_table(self, spot: str, case: str, stack: str) -> Optional[Dict[str, Any]]:
        if not self._preflop:
            return None
        root = self._preflop
        # Data shape: PreflopRanges[case][stack][spot][posKey]
        try:
            return root[case][stack][spot]
        except (KeyError, TypeError):
            # Some exports omit the case/stack wrappers.
            for candidate in (root.get(spot), root.get(stack, {}).get(spot) if isinstance(root.get(stack), dict) else None):
                if candidate:
                    return candidate
            return None

    def preflop_lookup(
        self,
        hero_pos: str,
        villain_pos: Optional[str],
        spot: str,
        stack: int = 100,
        hand: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Look up a preflop decision.

        Returns ``{actions: [fold%, call%, raise%], ...}`` when ``hand`` is
        given, or ``{range: {pure_raise, pure_call, mixed}, ...}`` when it is
        omitted. ``None`` if no matching table/key exists.
        """
        if not self._preflop:
            raise RuntimeError("preflop data not loaded; call init() first")

        hero = _norm_pos(hero_pos)
        villain = _norm_pos(villain_pos) if villain_pos else None
        case = self.config.preflop.case if self.config.preflop else "cash"
        stack_key = self.config.preflop.stack if self.config.preflop else "100bb"

        table = self._preflop_table(spot, case, stack_key)
        if table is None:
            return None

        # Build the position key. Keys are hero_villain (hero = the seat whose
        # range is stored, i.e. the one facing the action). RFI keys on hero alone.
        if spot == "rfi" or villain is None:
            candidates = [hero]
        else:
            candidates = [f"{hero}_{villain}"]

        entry = None
        used_key = None
        for key in candidates:
            if key in table:
                entry = table[key]
                used_key = key
                break
        if entry is None:
            return None

        raise_is_allin = spot == "vs_4bet" or stack <= 25

        meta = {
            "spot": spot,
            "key": used_key,
            "raise_is_allin": raise_is_allin,
        }

        if hand is None:
            return {
                "range": {
                    "pure_raise": entry.get("pure_raise", []),
                    "pure_call": entry.get("pure_call", []),
                    "mixed": entry.get("mixed", {}),
                },
                **meta,
            }

        actions = self._preflop_hand_actions(entry, hand)
        return {"actions": actions, "hand": hand, **meta}

    @staticmethod
    def _preflop_hand_actions(entry: Dict[str, Any], hand: str) -> List[float]:
        if hand in entry.get("pure_raise", []):
            return [0.0, 0.0, 1.0]
        if hand in entry.get("pure_call", []):
            return [0.0, 1.0, 0.0]
        mixed = entry.get("mixed", {})
        if hand in mixed:
            return list(mixed[hand])
        # Unlisted hand -> pure fold.
        return [1.0, 0.0, 0.0]

    # ------------------------------------------------------------------ #
    # Postflop lookup
    # ------------------------------------------------------------------ #
    def _seats(self, hero_pos: str, villain_pos: str):
        hero = _norm_pos(hero_pos)
        villain = _norm_pos(villain_pos)
        h = _POSTFLOP_ORDER.get(hero, 99)
        v = _POSTFLOP_ORDER.get(villain, 99)
        if h <= v:
            return hero, villain  # hero OOP
        return villain, hero

    def _matchup_key(self, bet_level: str, oop: str, ip: str) -> Optional[str]:
        forward = f"{oop}_vs_{ip}"
        reverse = f"{ip}_vs_{oop}"
        flop = self._flop.get(bet_level, {})
        if forward in flop:
            return forward
        if reverse in flop:
            return reverse
        # River-only availability (flop may be missing for that matchup).
        for key in (forward, reverse):
            if self._available_river_boards(bet_level, key):
                return key
        return forward

    def postflop_lookup(
        self,
        hero_pos: str,
        villain_pos: str,
        aggressor_pos: Optional[str],
        bet_level: str,
        board: Sequence[str],
        line: Sequence[str],
        hand: Sequence[str],
    ) -> Optional[Dict[str, Any]]:
        """Look up a postflop decision. See ``gtoterminal/README.md``.

        Returns a dict with ``actions`` (mixed strategy over the node's legal
        actions), ``hand_class`` and resolution metadata, or ``None`` when no
        solved data covers the spot.
        """
        if not self._initialized:
            raise RuntimeError("data not loaded; call init() first")
        if not board or len(board) < 3:
            return None

        board = [board_mod.normalize_card(c) for c in board]
        oop, ip = self._seats(hero_pos, villain_pos)
        matchup = self._matchup_key(bet_level, oop, ip)

        texture = board_mod.classify_texture(board)
        hand_class = classify_hand([board_mod.normalize_card(c) for c in hand], board)
        parsed = tree.parse_line(line, len(board))

        base_meta = {
            "matchup": matchup,
            "bet_level": bet_level,
            "oop": oop,
            "ip": ip,
            "aggressor": _norm_pos(aggressor_pos) if aggressor_pos else None,
            "texture": texture,
            "hand_class": hand_class,
            "street": parsed.street,
            "slot": parsed.slot,
        }

        if parsed.street == "flop":
            return self._lookup_flop(bet_level, matchup, board, parsed, hand_class, base_meta)
        if parsed.street == "turn":
            return self._lookup_turn(bet_level, matchup, board, parsed, hand_class, base_meta)
        return self._lookup_river(bet_level, matchup, board, parsed, hand_class, base_meta)

    # ---- flop ---- #
    def _lookup_flop(self, bet_level, matchup, board, parsed, hand_class, meta):
        flop = self._flop.get(bet_level, {}).get(matchup)
        if not flop:
            return None
        matched = board_mod.find_closest_board(
            board_mod.classify_texture(board), board, available=list(flop.keys())
        )
        if not matched or matched not in flop:
            return None
        entry = flop[matched]
        meta = {**meta, "matched_board": matched, "exploitability": entry.get("exploitability")}

        slot = parsed.slot
        if slot in (None, 0):
            # Flop root = OOP first to act (aggregate only, no per-class split).
            actions = _parse_actions(entry.get("actions"), entry.get("strategy"))
            return {"actions": actions, "by_class": False, **meta}

        node_name = tree.FLOP_NODE_BY_SLOT.get(slot)
        node = (entry.get("nodes") or {}).get(node_name) if node_name else None
        if not node:
            actions = _parse_actions(entry.get("actions"), entry.get("strategy"))
            return {"actions": actions, "by_class": False, "note": "node_fallback_root", **meta}

        strat = (node.get("strategyByClass") or {}).get(hand_class) or node.get("strategy")
        actions = _parse_actions(node.get("actions"), strat)
        return {"actions": actions, "by_class": hand_class in (node.get("strategyByClass") or {}), **meta}

    # ---- turn ---- #
    def _lookup_turn(self, bet_level, matchup, board, parsed, hand_class, meta):
        turn = self._turn.get(bet_level, {}).get(matchup)
        if not turn:
            return None
        matched = board_mod.find_closest_board(
            board_mod.classify_texture(board), board, available=list(turn.keys())
        )
        if not matched or matched not in turn:
            return None
        entry = turn[matched]
        lines = entry.get("lines", {})
        flop_line = parsed.flop_line or "check_check"
        line_obj = lines.get(flop_line) or _first_value(lines)
        if not line_obj:
            return None

        turn_card = board_mod.normalize_card(board[3])
        cards = line_obj.get("cards", {})
        card_obj = cards.get(turn_card) or _first_value(cards)
        if not card_obj:
            return None

        slot = parsed.slot if parsed.slot is not None else 0
        actions_list = line_obj.get("actions") or []
        actions_str = actions_list[slot] if slot < len(actions_list) else None
        strat = _slot_strategy(card_obj, slot, hand_class)
        actions = _parse_actions(actions_str, strat.get("freqs"))
        return {
            "actions": actions,
            "by_class": strat.get("by_class", False),
            "matched_board": matched,
            "flop_line": flop_line,
            "turn_card": turn_card,
            **meta,
        }

    # ---- river ---- #
    def _lookup_river(self, bet_level, matchup, board, parsed, hand_class, meta):
        matched = board_mod.find_closest_board(
            board_mod.classify_texture(board),
            board,
            available=self._available_river_boards(bet_level, matchup),
        )
        if not matched:
            return None

        chunk = self._river_cache.get(bet_level, matchup, matched)
        if chunk is None:
            if not self.load_river_chunk(bet_level, matchup, matched):
                return None
            chunk = self._river_cache.get(bet_level, matchup, matched)
        if not chunk:
            return None

        lines = chunk.get("lines", {})
        flop_line = parsed.flop_line or "check_check"
        turn_line = parsed.turn_line or "check_check"
        turn_card = board_mod.normalize_card(board[3])
        river_card = board_mod.normalize_card(board[4])

        by_turn_card = lines.get(flop_line) or _first_value(lines)
        if not by_turn_card:
            return None
        by_turn_line = by_turn_card.get(turn_card) or _first_value(by_turn_card)
        if not by_turn_line:
            return None
        line_obj = by_turn_line.get(turn_line) or _first_value(by_turn_line)
        if not line_obj:
            return None
        cards = line_obj.get("cards", {})
        card_obj = cards.get(river_card) or _first_value(cards)
        if not card_obj:
            return None

        slot = parsed.slot if parsed.slot is not None else 0
        actions_list = line_obj.get("actions") or []
        actions_str = actions_list[slot] if slot < len(actions_list) else None
        strat = _slot_strategy(card_obj, slot, hand_class)
        actions = _parse_actions(actions_str, strat.get("freqs"))
        return {
            "actions": actions,
            "by_class": strat.get("by_class", False),
            "matched_board": matched,
            "flop_line": flop_line,
            "turn_card": turn_card,
            "turn_line": turn_line,
            "river_card": river_card,
            **meta,
        }


def _first_value(d: Optional[Dict[str, Any]]):
    if not d:
        return None
    return next(iter(d.values()), None)


def _slot_strategy(card_obj: Dict[str, Any], slot: int, hand_class: str) -> Dict[str, Any]:
    """Extract the strategy for a decision slot from a turn/river card object
    ``{s:[10], bc:[10 maps]}``. Prefers the per-hand-class breakdown."""
    bc = card_obj.get("bc") or []
    s = card_obj.get("s") or []
    if slot < len(bc) and isinstance(bc[slot], dict) and hand_class in bc[slot]:
        return {"freqs": bc[slot][hand_class], "by_class": True}
    if slot < len(s) and s[slot] is not None:
        return {"freqs": s[slot], "by_class": False}
    return {"freqs": None, "by_class": False}
