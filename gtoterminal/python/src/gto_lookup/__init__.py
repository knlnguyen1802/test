"""gto_lookup — GTO poker lookup API over pre-computed solution data.

Two entry points, matching ``gtoterminal/README.md``:

    from gto_lookup import GTOLookup

    gto = GTOLookup.from_config_file("gto_config.json").init()

    # Preflop
    gto.preflop_lookup("BTN", "CO", spot="vs_raise", stack=100, hand="AJs")

    # Postflop (river chunk loads lazily on demand)
    gto.postflop_lookup(
        hero_pos="BB", villain_pos="SB", aggressor_pos="SB",
        bet_level="srp", board=["Ah", "7d", "2c"],
        line=["X", "B33", "C"], hand=["Ah", "Kh"],
    )
"""
from __future__ import annotations

from .api import GTOLookup
from .board import classify_texture, find_closest_board
from .config import Config, config_from_dict, load_config
from .hand_class import HAND_STRENGTHS, classify_hand

__all__ = [
    "GTOLookup",
    "Config",
    "load_config",
    "config_from_dict",
    "classify_texture",
    "find_closest_board",
    "classify_hand",
    "HAND_STRENGTHS",
]

__version__ = "0.1.0"
