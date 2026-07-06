# GTOTerminal — Postflop Solution: Full Usage Guide

> Covers both the **Python API** (`gto_advisor.py`) and the underlying **JS engine** (`GTO.Engine.PostflopLookup`).

---

## Table of Contents

- [Setup](#setup)
- [Postflop API](#postflop-api)
  - [1. Load Postflop Data](#1-load-postflop-data)
  - [2. Resolve a Matchup](#2-resolve-a-matchup)
  - [3. Classify the Board & Hand](#3-classify-the-board--hand)
  - [4. Run Postflop Lookup](#4-run-postflop-lookup)
  - [5. Run Turn Lookup](#5-run-turn-lookup)
  - [6. Run River Lookup](#6-run-river-lookup)
  - [7. Get Recommendation](#7-get-recommendation)
  - [8. Full Integration Example](#8-full-integration-example)
- [Reference Tables](#reference-tables)
  - [Spot Types](#spot-types-all-12)
  - [Board Textures](#board-textures-all-8)
  - [Hand Strengths](#hand-strengths-all-18)
  - [Matchup Keys](#matchup-keys)
  - [SPR → Depth Mapping](#spr--depth-mapping)
  - [Action Keys](#action-keys)
- [Solver vs. Heuristic Coverage](#solver-vs-heuristic-coverage)
- [Heuristic Fallback](#heuristic-fallback-postflop_heuristicpy)

---

## Setup

### 1. Clone the Repo

```bash
git clone https://github.com/longvatrong111/medusa-poker.git
cd medusa-poker/gtoterminal
```

### 2. (Optional) Set Up AI Coaching

Copy the env example and fill in your Groq API key (free at [console.groq.com](https://console.groq.com)):

```bash
cp .env.example .env
# Then edit .env:
# GROQ_API_KEY=gsk_your_api_key_here
```

> The app works fully without this — AI features are optional.

### 3. Serve Locally (Required for Live WASM Solver)

Pre-computed solutions work by opening `index.html` directly. The live WASM solver requires an HTTP server:

```bash
# Option A: built-in script
bash serve.sh          # serves at http://localhost:8080
bash serve.sh 3000     # custom port

# Option B: manual
python3 -m http.server 8080
```

### 4. (Optional) Re-Compute Postflop Solutions

**Prerequisites:** Node.js 18+ (`node --version` to check). No `npm install` needed — the WASM solver pkg is already committed.

#### Flop only (default)

```bash
# 115 spots (5 matchups × 23 boards) per depth level, ~2-5 min each
node scripts/precompute-postflop.mjs                     # srp (default)
node scripts/precompute-postflop.mjs --depth 3bet
node scripts/precompute-postflop.mjs --depth 4bet
```

#### Flop + Turn + River (default)

```bash
node scripts/precompute-postflop.mjs                     # flop + turn + river (default)
node scripts/precompute-postflop.mjs --depth 3bet        # 3bet pot, all streets
node scripts/precompute-postflop.mjs --no-river          # flop + turn only
node scripts/precompute-postflop.mjs --no-turn           # flop only (also drops river)
```

> Turn + river are extracted by default (no separate solve — just reading
> pre-computed nodes). River always requires turn, so `--no-turn` is ignored
> while river is enabled.

> **Incremental build** — the script loads existing data files on startup, skips already-solved spots, and merges new results. Re-running is safe and only computes missing entries.

#### Output files

| Flag(s) | Output file | JS variable |
|---|---|---|
| *(always)* | `js/data/postflop-solutions.js` | `PostflopSolutions` |
| *(default, disable with `--no-turn`)* | `js/data/postflop-solutions-turn.js` | `PostflopSolutionsTurn` |
| *(default, disable with `--no-river`)* | `js/data/postflop-solutions-river.js` | `PostflopSolutionsRiver` |

Case-specific flop files: `postflop-solutions-srp.js`, `postflop-solutions-3bet.js`, `postflop-solutions-4bet.js`.

#### Quick test (single spot)

```bash
# Solve just one matchup/board — useful for verifying the setup
node scripts/precompute-postflop.mjs 2>&1 | head -40
```

### 5. Python Environment

No external dependencies required for the Python wrappers. They parse the JS data files directly.

```bash
cd gtoterminal/python    # or apollo/python/
python get_gto_action.py
```

---

## Postflop API

### 1. Load Postflop Data

Load once at startup — this reads all `js/data/postflop-solutions*.js` files:

```python
from gto_advisor import load_postflop_data

pf_data = load_postflop_data()
# Returns:
# {
#   'solutions':       { depth_key → { matchup_key → { board_label → node_dict } } },
#   'matchups':        { matchup_key → { label, oop, ip } },
#   'boards':          [ { board: [...], texture: str, label: str } ],
#   'turn_solutions':  { matchup_key → { board_label → { lines: { ... } } } },
#   'river_solutions': { matchup_key → { board_label → { lines: { ... } } } },
# }
```

> `data_dir` defaults to `js/data/` relative to the repo root. Unavailable files (flop, turn, or river) are skipped with a warning.

---

### 2. Resolve a Matchup

Convert hero position + IP/OOP status to a matchup key:

```python
from gto_advisor import resolve_matchup

matchup = resolve_matchup(
    hero_position = 'BTN',
    is_oop        = False,   # True = hero is first to act (out of position)
    matchups      = pf_data['matchups'],
)
# → 'BTN_vs_BB'  (or None if no match)
```

---

### 3. Classify the Board & Hand

```python
from gto_advisor import BoardCategories

# Board texture (8 possible values)
texture = BoardCategories.classify(['Ac', '7d', '2h'])
# → 'dry_rainbow'

# Hand strength (18 possible values)
strength = BoardCategories.classify_hand_strength(
    hole_cards  = ['Ac', 'Kd'],
    board_cards = ['Ah', '7c', '2s'],
)
# → 'top_pair_strong'
```

**Card format:** strings like `'Ac'`, `'Td'`, `'2h'`
> ⚠️ Use `T` for Ten, **not** `10`. Higher rank always comes first.

---

### 4. Run Postflop Lookup

```python
from gto_advisor import postflop_lookup

result = postflop_lookup(
    spot_type     = 'OOP_cbet_flop',      # see Spot Types table
    board_texture = 'dry_rainbow',         # from BoardCategories.classify()
    hand_strength = 'top_pair_strong',     # from BoardCategories.classify_hand_strength()
    spr           = 4.2,                   # stack-to-pot ratio (None if pot == 0)
    board_cards   = ['Ac', '7d', '2h'],   # community cards as raw strings
    matchup       = 'BTN_vs_BB',          # from resolve_matchup()
    pf_data       = pf_data,              # from load_postflop_data()
    # depth       = '100bb',              # optional override — auto-derived from spr
)
```

**Return value:**

| Key | Type | Description |
|---|---|---|
| `freqs` | `dict` | `{ action_key: float }` — frequencies per action |
| `source` | `str` | `'solver'` or `'heuristic'` |
| `node_data` | `dict \| None` | Raw solver node (for debugging) |
| `matchup_used` | `str \| None` | Matchup key used (solver path only) |
| `depth_used` | `str \| None` | Depth bucket used (solver path only) |

---

### 5. Run Turn Lookup

Requires turn data (extracted by default; only absent if run with `--no-turn`):

```python
from gto_advisor import turn_lookup

result = turn_lookup(
    spot_type     = 'OOP_turn_barrel',        # see Spot Types table
    board_texture = 'dry_rainbow',            # flop texture
    hand_strength = 'overpair',               # from BoardCategories.classify_hand_strength()
    spr           = 2.5,                      # stack-to-pot ratio
    board_cards   = ['Ac', '7d', '2h', 'Jc'],# 4 cards (flop + turn)
    matchup       = 'BTN_vs_BB',             # from resolve_matchup()
    pf_data       = pf_data,                  # from load_postflop_data()
    turn_card     = None,                     # auto-extracted from board_cards[3]
    flop_line     = None,                     # auto-inferred from pot ratio
)
```

| Key | Type | Description |
|---|---|---|
| `freqs` | `dict` | `{ action_key: float }` — frequencies per action |
| `source` | `str` | `'solver_turn'` or `'heuristic'` |
| `matchup_used` | `str \| None` | Matchup key used |

> Falls back to heuristic if turn data is unavailable or the specific spot is missing.

---

### 6. Run River Lookup

Requires river data (extracted by default; only absent if run with `--no-river`):

```python
from gto_advisor import river_lookup

result = river_lookup(
    spot_type     = 'IP_river_bet',               # see Spot Types table
    board_texture = 'dry_rainbow',                 # flop texture
    hand_strength = 'top_pair_strong',             # from BoardCategories.classify_hand_strength()
    spr           = 1.0,                           # stack-to-pot ratio
    board_cards   = ['Ac', '7d', '2h', 'Jc', '5s'],  # 5 cards
    matchup       = 'BTN_vs_BB',                  # from resolve_matchup()
    pf_data       = pf_data,                       # from load_postflop_data()
    flop_line     = None,                          # auto-inferred
    turn_line     = None,                          # auto-inferred
)
```

| Key | Type | Description |
|---|---|---|
| `freqs` | `dict` | `{ action_key: float }` — frequencies per action |
| `source` | `str` | `'solver_river'` or `'heuristic'` |
| `matchup_used` | `str \| None` | Matchup key used |

> Falls back to heuristic if river data is unavailable or the specific spot is missing.

---

### 7. Get Recommendation

```python
from postflop_heuristic import recommendation

action = recommendation(result['freqs'])
# → e.g. 'bet_67', 'check', 'fold', 'call', 'raise', 'allin'
```

---

### 8. Full Integration Example

```python
from gto_advisor import (
    load_postflop_data,
    resolve_matchup,
    BoardCategories,
    postflop_lookup,
)
from postflop_heuristic import recommendation

# ── Startup (once) ──────────────────────────────────────────────
pf_data = load_postflop_data()

# ── Per hand / street ───────────────────────────────────────────
hero_position  = 'BTN'
is_oop         = False
community_cards = ['Ac', '7d', '2h']   # flop
hole_cards     = ['Kd', 'As']
spr            = 4.2                   # (bb_unit * 100) / pot
spot           = 'OOP_cbet_flop'       # derived from game state

# Classify
board_texture = BoardCategories.classify(community_cards)
hand_strength = BoardCategories.classify_hand_strength(hole_cards, community_cards)
matchup       = resolve_matchup(hero_position, is_oop, pf_data['matchups'])

# Lookup
result = postflop_lookup(
    spot_type     = spot,
    board_texture = board_texture,
    hand_strength = hand_strength,
    spr           = spr,
    board_cards   = community_cards,
    matchup       = matchup,
    pf_data       = pf_data,
)

# Guard against None
if result is None or result.get('freqs') is None:
    action = 'fold'
else:
    action = recommendation(result['freqs'])

print(f"GTO action: {action}  (source: {result['source']})")
```

---

## Reference Tables

### Spot Types (all 12)

| Value | Street | Situation |
|---|---|---|
| `IP_cbet_flop` | Flop | Hero in position, first to act (c-bet) |
| `OOP_cbet_flop` | Flop | Hero out of position, first to act (c-bet) |
| `IP_facing_cbet` | Flop | Hero in position, facing villain bet |
| `OOP_facing_cbet` | Flop | Hero out of position, facing villain bet |
| `IP_turn_barrel` | Turn | Hero in position, first to act |
| `OOP_turn_barrel` | Turn | Hero out of position, first to act |
| `IP_facing_turn_bet` | Turn | Hero in position, facing villain bet |
| `OOP_facing_turn_bet` | Turn | Hero out of position, facing villain bet |
| `IP_river_bet` | River | Hero in position, first to act |
| `OOP_river_bet` | River | Hero out of position, first to act |
| `IP_facing_river_bet` | River | Hero in position, facing villain bet |
| `OOP_facing_river_bet` | River | Hero out of position, facing villain bet |

---

### Board Textures (all 8)

| Value | Description |
|---|---|
| `dry_rainbow` | No flush draw, unpaired, disconnected |
| `dry_twotone` | Two-tone (flush draw possible), unpaired, disconnected |
| `wet_rainbow` | Rainbow but connected / straight draws present |
| `wet_twotone` | Two-tone and connected |
| `monotone` | All three cards same suit |
| `paired_dry` | Board has a pair, no significant draws |
| `paired_wet` | Board has a pair, draws present |
| `highly_connected` | Three or more consecutive ranks with flush draw |

---

### Hand Strengths (all 18)

Ordered weakest → strongest:

| Value | Description |
|---|---|
| `air` | No pair, no draw, no overcard |
| `overcards` | Both hole cards above board max, no draw |
| `weak_draw` | Backdoor draw only (3 to flush or 3 to straight) |
| `gutshot` | Inside straight draw (4 outs) |
| `oesd_or_fd` | Open-ended straight draw (8 outs) or flush draw (9 outs) |
| `combo_draw` | Flush draw + any straight draw (12–15 outs) |
| `underpair` | Pocket pair below all board cards |
| `weak_pair` | Paired a board card below top two |
| `second_pair` | Paired the 2nd highest board card |
| `top_pair_weak` | Top pair, kicker < J |
| `top_pair_strong` | Top pair, kicker ≥ J |
| `overpair` | Pocket pair above all board cards |
| `two_pair` | Two pair |
| `trips` | Three of a kind using one hole card on a paired board |
| `set` | Three of a kind using pocket pair |
| `straight` | Straight |
| `flush` | Flush |
| `full_house` | Full house, quads, straight flush, or royal flush |

> `'overcards'` requires **both** hole cards to be above the board's max rank.

---

### Matchup Keys

| Key | Description |
|---|---|
| `SB_vs_BB` | Small blind vs Big blind |
| `BTN_vs_BB` | Button vs Big blind |
| `CO_vs_BB` | Cutoff vs Big blind |
| `UTG_vs_BB` | UTG vs Big blind |
| `BTN_vs_SB` | Button vs Small blind |

---

### SPR → Case Mapping

Auto-derived from `spr` when `depth` is not explicitly passed:

| SPR | Case bucket |
|---|---|
| `> 10.7` | `srp` |
| `> 3.55` | `3bet` |
| `≤ 3.55` | `4bet` |

---

### Action Keys

| Situation | Possible keys |
|---|---|
| Hero bets | `check` · `bet_33` · `bet_50` · `bet_67` · `bet_100` · `allin` |
| Hero faces a bet | `fold` · `call` · `raise` · `allin` |

> `bet_50` only appears in **solver** output. The heuristic fallback only returns `bet_33` / `bet_67` / `bet_100`.

---

## Solver vs. Heuristic Coverage

The full postflop solution uses **solver data** when pre-computed files exist, and falls back to **heuristic tables** otherwise.

| Spot type | Source | Requires |
|---|---|---|
| `OOP_cbet_flop` | ✅ Solver | flop data (always generated) |
| `IP_cbet_flop` | ✅ Solver | flop data |
| `IP_facing_cbet` | ✅ Solver | flop data |
| `OOP_facing_cbet` | ✅ Solver | flop data |
| `OOP_turn_barrel` | ✅ Solver | turn data (default) |
| `IP_turn_barrel` | ✅ Solver | turn data (default) |
| `IP_facing_turn_bet` | ✅ Solver | turn data (default) |
| `OOP_facing_turn_bet` | ✅ Solver | turn data (default) |
| `OOP_river_bet` | ✅ Solver | river data (default) |
| `IP_river_bet` | ✅ Solver | river data (default) |
| `IP_facing_river_bet` | ✅ Solver | river data (default) |
| `OOP_facing_river_bet` | ✅ Solver | river data (default) |
| `{OOP,IP}_flop_bet_{small,large}_vs_raise` | ✅ Solver | flop data |
| `{OOP,IP}_turn_bet_{small,large}_vs_raise` | ✅ Solver | turn data (default) |
| `{OOP,IP}_river_bet_{small,large}_vs_raise` | ✅ Solver | river data (default) |

> All 12 spot types fall back to the **heuristic** if the corresponding data file was not generated.

**Board match priority** (solver path):
1. **Exact** — board cards string matches an entry in the board registry
2. **Texture** — any board with the same texture in this matchup
3. **Fuzzy** — `paired_wet` → `paired_dry`, `highly_connected` → `wet_rainbow`
4. **Fallback** — first non-error solution in the matchup

---

## Heuristic Fallback (`postflop_heuristic.py`)

Used automatically when solver data is unavailable for a given spot (e.g. turn/river files not generated, or specific board/card not found).

```python
from postflop_heuristic import lookup, recommendation

freqs = lookup(
    spot_type     = 'IP_turn_barrel',
    board_texture = 'wet_twotone',
    hand_strength = 'overpair',
    spr           = 2.5,              # optional
)

if freqs is None:
    # Always guard — log warning and default to fold
    action = 'fold'
else:
    action = recommendation(freqs)
```

> ⚠️ **Always guard** the return value of `lookup()` — it returns `None` for unknown spot/hand combinations. Log a warning and default to `'fold'`.