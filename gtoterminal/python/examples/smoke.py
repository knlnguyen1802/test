"""Smoke test / usage demo for the gto_lookup package.

Run from the package root:  python -m examples.smoke   (or  python examples/smoke.py)
Requires the repo's js/data to be present (default config points there).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from gto_lookup import GTOLookup  # noqa: E402

CONFIG = os.path.join(os.path.dirname(__file__), "..", "gto_config.json")


def main() -> None:
    gto = GTOLookup.from_config_file(CONFIG).init()
    print("initialized. bet levels:", list(gto.config.bet_levels))

    print("\n--- preflop ---")
    print("BTN RFI 76s:", gto.preflop_lookup("BTN", None, "rfi", 100, "76s"))
    print("MP vs UTG raise, AQo:", gto.preflop_lookup("MP", "UTG", "vs_raise", 100, "AQo"))
    print("UTG vs MP 3bet, KK:", gto.preflop_lookup("UTG", "MP", "vs_3bet", 100, "KK"))

    print("\n--- postflop flop ---")
    r = gto.postflop_lookup(
        hero_pos="BB", villain_pos="SB", aggressor_pos="SB",
        bet_level="srp", board=["Ah", "7d", "2c"],
        line=["X"], hand=["Ah", "Kh"],
    )
    print("BB vs SB, A72r, line=[X] (IP cbet), AK:", r)

    print("\n--- postflop turn ---")
    r = gto.postflop_lookup(
        hero_pos="BB", villain_pos="SB", aggressor_pos="SB",
        bet_level="srp", board=["Ah", "7d", "2c", "Kd"],
        line=["X", "BL", "C"], hand=["Ah", "Kh"],
    )
    print("turn Kd, line=[X,BL,C] then OOP first:", r)

    print("\n--- postflop river (lazy chunk load) ---")
    r = gto.postflop_lookup(
        hero_pos="BB", villain_pos="SB", aggressor_pos="SB",
        bet_level="srp", board=["Ah", "7d", "2c", "Kd", "3s"],
        line=["X", "BL", "C"], hand=["Ah", "Kh"],
    )
    print("river 3s:", r)
    print("river cache stats:", gto.river_cache_stats())


if __name__ == "__main__":
    main()
