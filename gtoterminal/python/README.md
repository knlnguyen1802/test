# gto_lookup — Python GTO Lookup API

A pure-Python, dependency-free lookup API over the pre-computed GTO solution
data in this repo. It implements the two APIs described in
[`gtoterminal/README.md`](../README.md): **preflop** range lookups and
**postflop** strategy lookups. The API works **only with pre-computed data** —
it never runs a solver. It wraps all the algorithm logic (matchup keying, seat
resolution, board generalization, game-tree navigation, hand-strength
classification); callers pass raw game state only.

## Install

```powershell
cd gtoterminal/python
pip install -e .
```

Cross-repo consumers can install it straight from git without publishing:

```powershell
pip install "git+https://github.com/<you>/gto-lab.git#subdirectory=gtoterminal/python"
```

## Quick start

```python
from gto_lookup import GTOLookup

gto = GTOLookup.from_config_file("gto_config.json").init()

# Preflop → [fold%, call%, raise%]
gto.preflop_lookup("BTN", None, spot="rfi", stack=100, hand="76s")
gto.preflop_lookup("MP", "UTG", spot="vs_raise", stack=100, hand="AQo")

# Postflop → mixed strategy over the node's legal actions + metadata
gto.postflop_lookup(
    hero_pos="BB", villain_pos="SB", aggressor_pos="SB",
    bet_level="srp", board=["Ah", "7d", "2c"],
    line=["X"], hand=["Ah", "Kh"],
)
```

See [`examples/smoke.py`](examples/smoke.py) for a runnable demo.

## API

### `preflop_lookup(hero_pos, villain_pos, spot, stack=100, hand=None)`

- `spot ∈ {rfi, vs_raise, vs_3bet, vs_4bet}`.
- With `hand` → `{actions: [fold%, call%, raise%], ...}`. Unlisted hands are
  pure fold. `raise_is_allin` is set when `spot == vs_4bet` or the stack is
  short.
- Without `hand` → `{range: {pure_raise, pure_call, mixed}, ...}`.

### `postflop_lookup(hero_pos, villain_pos, aggressor_pos, bet_level, board, line, hand)`

- `bet_level ∈ {srp, 3bet, 4bet}` — the pot type, passed directly (never
  inferred from SPR).
- `board` — 3/5 cards, e.g. `["Ah","7d","2c"]` (+ turn, + river). Street is
  derived from board length.
- `line` — postflop action path so far (see **Line notation** below).
- `hand` — hero hole cards, e.g. `["Ah","Kh"]`.
- Returns the mixed strategy for the hero's hand class at the resolved node,
  plus resolution metadata (`matchup`, `oop`/`ip`, `matched_board`,
  `hand_class`, `street`, `slot`, …), or `None` if no solved data covers the
  spot.

### Line notation

Cards live in `board`; `line` is actions only. Tokens (case-insensitive):

| Token | Meaning |
|---|---|
| `X` | check |
| `B` / `BS` | bet small (first configured size) |
| `BL` | bet large (second size) |
| `B33`, `B75`, … | bet N% pot → bucketed to small/large by the midpoint |
| `C` | call · `R` raise · `F` fold |

The data stores two bet sizes and a fixed vocabulary of decision nodes, so the
line is normalized into that vocabulary. For turn/river, the line is
`<flop-closing-line> [+ <turn-closing-line>] + <current-street decision path>`;
the parser splits it automatically.

## Configuration

`init()` reads a JSON config that says **where** the data is, so solution data
can be replaced without code changes. Copy
[`gto_config.example.json`](gto_config.example.json) and edit the paths:

- `data_root` — base dir (resolved relative to the config file).
- `preflop` — the ranges file (`.js` with a `var`, or `.json`).
- `bet_levels.<level>.flop|turn` — files loaded fully at `init()`.
- `bet_levels.<level>.river.dir` — directory of per-board river chunks, loaded
  lazily.
- `river_cache.max_chunks` — RAM bound (see below).

Both browser `.js` data (`GTO.Data.X = {…};`) and plain `.json` are supported;
the loader extracts the embedded object and tolerates the hand-written preflop
file's single quotes / bare keys / comments.

### Zero-copy setup for a consumer repo

A consumer only needs the **installed package** plus a way to point at the data
— it does **not** have to copy the data or a config file. Three equivalent ways:

1. **Env var (simplest).** `GTO_DATA_ROOT` overrides `data_root` for any config,
   so the same call works on any machine by setting one variable:

   ```powershell
   $env:GTO_DATA_ROOT = "D:/gto-lab/gtoterminal/js/data"
   ```
   ```python
   gto = GTOLookup.from_config_dict({
       "preflop": {"path": "preflop-ranges.js", "var": "GTO.Data.PreflopRanges"},
       "bet_levels": {"srp": {
           "flop":  {"path": "postflop-solutions-srp.js",      "var": "GTO.Data.PostflopSolutions_SRP"},
           "turn":  {"path": "postflop-solutions-turn-srp.js", "var": "GTO.Data.PostflopSolutionsTurn_SRP"},
           "river": {"dir": "river/srp"},
       }},
   }).init()
   ```

2. **In-code dict with an absolute `data_root`.** No env var, no file:

   ```python
   gto = GTOLookup.from_config_dict({
       "data_root": "D:/gto-lab/gtoterminal/js/data",
       "preflop": {...}, "bet_levels": {...},
   }).init()
   ```

3. **A config file** (`from_config_file("gto_config.json")`) — best when you want
   the paths versioned in the consumer repo. `GTO_DATA_ROOT` still overrides
   `data_root` if set.

You only need to **copy the data** when the consumer runs where the gto-lab data
isn't reachable (another machine, CI, a container). Otherwise point at it
in place.

## Loading strategy (the RAM problem)

River data is huge (each `river/<level>/<matchup>/<board>.json` can exceed
50 MB), so it cannot all be resident. The design:

1. **`init()` loads the light tiers** — preflop ranges + **flop** + **turn**
   nodes for every configured bet level. These are small (aggregated,
   hand-class-bucketed) and stay in RAM.
2. **River loads lazily, one chunk at a time.** A *chunk* = one river file =
   all river nodes for a single `(bet_level, matchup, board)`. The first river
   lookup that needs a chunk loads it; you can also warm it explicitly with
   `load_river_chunk(bet_level, matchup, board)`.
3. **An LRU cache bounds RAM.** At most `river_cache.max_chunks` chunks stay
   resident; the least-recently-used one is evicted on overflow. Inspect it with
   `river_cache_stats()`.

Because a query only touches **one** matched board, at most one new river chunk
is loaded per lookup, and total river RAM is bounded by
`max_chunks × (chunk size)`.

### Recommended upgrades at scale

The chunked LRU approach is simple and correct but still loads a whole ~50 MB
file to answer one query. Better options, in rough order of payoff:

1. **SQLite index (best).** One-time preprocessing that flattens each river file
   into rows keyed by
   `(bet_level, matchup, board, flop_line, turn_card, turn_line, river_card, slot)`
   with the strategy blob as the value. A lookup becomes a single indexed row
   read (KB, not MB) with near-zero RAM — no per-file loading, no eviction. This
   is the recommended production path; the current `RiverCache` can be swapped
   for a `SqliteRiverStore` behind the same interface.
2. **Streaming extraction (`ijson`).** Pull just the needed subtree out of a
   river file without materializing the whole JSON (optional `stream` extra).
   Lower RAM than full-file load, but still re-parses per query — good as a
   drop-in when a build step isn't desired.
3. **Pre-split chunks.** Re-emit river data as smaller files (per turn card or
   per flop line) so each on-demand load is a few MB instead of 50+.
4. **On-disk compression (zstd).** Store river chunks compressed and decompress
   only the loaded chunk to cut disk and I/O.

## Module map

| Module | Responsibility |
|---|---|
| `config.py` | Parse the JSON config, resolve data paths |
| `loader.py` | JS→JSON extraction, relaxed parser, LRU `RiverCache` |
| `board.py` | Texture classification, anchor rank, closest-board matching |
| `hand_class.py` | 18-bucket hand-strength classifier |
| `tree.py` | Line normalization, street splitting, node-slot resolution |
| `api.py` | `GTOLookup` — `init`, `preflop_lookup`, `postflop_lookup`, river chunks |

The board, hand-class and node conventions mirror the JS/Rust pipeline; see
[`../BOARD.md`](../BOARD.md) and [`../TREES.md`](../TREES.md).
