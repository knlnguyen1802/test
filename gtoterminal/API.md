# GTOTerminal API Reference

> **Last updated:** 2026-03-07  
> Two layers: the **real JS engine** (what the browser runs) and **Python wrappers** that make it
> callable from `apollo/python/`.

---

## Table of Contents

- [Real JS API](#real-js-api)
  - [§1 Hand / Card Constants](#1-hand--card-constants)
  - [§2 Board / Hand Classification](#2-board--hand-classification)
  - [§3 Preflop Static Cache](#3-preflop-static-cache)
  - [§4 Preflop Live WASM Solver](#4-preflop-live-wasm-solver)
  - [§5 Postflop Matchups & Solution Data](#5-postflop-matchups--solution-data)
  - [§6 Postflop Lookup Engine](#6-postflop-lookup-engine)
  - [§7 Postflop Live WASM Solver](#7-postflop-live-wasm-solver)
- [Python Wrappers — `gto_advisor.py`](#python-wrappers--gto_advisorpy)
  - [Data Files](#data-files)
  - [Card & Hand Format](#card--hand-format)
  - [BoardCategories](#boardcategories)
  - [Preflop API](#preflop-api)
  - [Postflop Data Loader](#postflop-data-loader)
  - [Postflop Lookup](#postflop-lookup)
  - [Postflop Heuristic Fallback](#postflop-heuristic-fallback-postflop_heuristicpy)
- [How `get_gto_action.py` Uses These APIs](#how-get_gto_actionpy-uses-these-apis)
- [Compliance Notes](#compliance-notes)

---

## Real JS API

### §1 Hand / Card Constants

**Source:** `js/data/hand-constants.js`

| Export | Type | Description |
|---|---|---|
| `GTO.Data.RANKS` | `string[]` | `['2','3',...,'K','A']` |
| `GTO.Data.SUITS` | `string[]` | `['s','h','d','c']` |
| `GTO.Data.RANK_VALUES` | `{[rank]: number}` | `{'2':2, ..., 'T':10, 'J':11, 'Q':12, 'K':13, 'A':14}` |
| `GTO.Data.POSITIONS` | `string[]` | `['UTG','MP','CO','BTN','SB','BB']` |
| `GTO.Data.STACK_DEPTHS` | `string[]` | `['100bb','40bb','25bb','15bb']` |
| `GTO.Data.ALL_HANDS` | `string[]` | All 169 canonical hand strings |
| `GTO.Data.COMBOS` | `{[hand]: number}` | Combo count per hand |

**Hand notation:**

| Format | Example | Meaning |
|---|---|---|
| Pair | `'AA'` | Pocket aces |
| Suited | `'AKs'` | Ace-King suited |
| Offsuit | `'AKo'` | Ace-King offsuit |
| Ten | `'T'` | Use `T` not `10` |

> **Rule:** Higher rank always comes first. `'AK'`, never `'KA'`.

**Card object format:**

```js
{ rank: 'A', suit: 's' }   // Ace of spades
```

---

### §2 Board / Hand Classification

**Source:** `js/data/board-categories.js`

#### Textures — `GTO.Data.BoardCategories.TEXTURES`

| # | Key |
|---|---|
| 1 | `dry_rainbow` |
| 2 | `dry_twotone` |
| 3 | `wet_rainbow` |
| 4 | `wet_twotone` |
| 5 | `monotone` |
| 6 | `paired_dry` |
| 7 | `paired_wet` |
| 8 | `highly_connected` |

#### Hand Strengths — `GTO.Data.BoardCategories.HAND_STRENGTHS`

`air` → `overcards` → `weak_draw` → `gutshot` → `oesd_or_fd` → `combo_draw` →
`underpair` → `weak_pair` → `second_pair` → `top_pair_weak` → `top_pair_strong` →
`overpair` → `two_pair` → `trips` → `set` → `straight` → `flush` → `full_house`

#### Methods

```js
GTO.Data.BoardCategories.classify(boardCards)
// boardCards: array of card objects
// Returns: one of 8 TEXTURES strings

GTO.Data.BoardCategories.classifyHandStrength(holeCards, boardCards)
// holeCards: [card, card]
// boardCards: 3–5 card objects
// Returns: one of 18 HAND_STRENGTHS strings
```

**Strength priority (highest → lowest):**
`full_house > flush > straight > set > trips > two_pair > overpair > top_pair > ... > air`

> **Note:** `'overcards'` requires **both** hole cards to be above the board's max rank.

---

### §3 Preflop Static Cache

**Source:** `js/solver/preflop-solver-cache.js`

```js
GTO.PreflopSolverCache.lookup(format, depth, context, positionKey)
// Returns: { pure_raise, pure_call, mixed, _source }  or  null
```

**Context table:**

| Context | Position Key Format | Example |
|---|---|---|
| `rfi` | `HERO_POS` | `'BTN'` |
| `vs_raise` | `OPENER_HERO` | `'UTG_BTN'` |
| `vs_3bet` | `HERO_3BETTOR` | `'BTN_BB'` |
| `vs_4bet` | `HERO_4BETTOR` | `'CO_BB'` |

> ⚠️ **BB has no `rfi` entry** — skip the lookup for BB open.

---

### §4 Preflop Live WASM Solver

**Source:** `js/solver/preflop-solver-api.js`

```js
GTO.PreflopSolver.solve(config)          // → Promise
GTO.PreflopSolver.solveWithCache(config) // → Promise (checks cache first)
```

**`POSITION → numOpponents` mapping:**

| Position | Opponents |
|---|---|
| `UTG` | 5 |
| `MP` | 4 |
| `CO` | 3 |
| `BTN` | 2 |
| `SB` | 1 |
| `BB` | 0 |

> 📌 Python wrappers do **not** call the live WASM solver.

---

### §5 Postflop Matchups & Solution Data

**Sources:** `js/data/postflop-matchups.js`, `js/data/postflop-solutions*.js`

#### Matchup Keys — `GTO.Data.PostflopMatchups`

`SB_vs_BB` · `BTN_vs_BB` · `CO_vs_BB` · `UTG_vs_BB` · `BTN_vs_SB`

#### Board Registry — `GTO.Data.PostflopBoards`

23 entries, each:

```js
{ board: [...cards], texture: 'dry_rainbow', label: 'A72r' }
```

#### Solution Structure — `GTO.Data.PostflopSolutions[matchup][board_label]`

```js
{
  board:    [...cards],
  texture:  'dry_rainbow',
  actions:  ['Check:0', 'Bet:33', 'Bet:67'],
  player:   'OOP',
  strategy: [...],   // per-hand frequencies, root node
  nodes: {
    ip_cbet:         { ... },   // IP opens
    ip_facing_cbet:  { ... },   // IP faces OOP bet
    oop_facing_cbet: { ... },   // OOP faces IP bet
  }
}
```

**Case variants:** `_SRP` · `_3BET` · `_4BET` (default is `100bb`)

**Action string → key mapping:**

| Action string | Key |
|---|---|
| `'Check:0'` | `check` |
| `'Bet:33'` | `bet_33` |
| `'Bet:50'` | `bet_50` |
| `'Bet:67'` | `bet_67` |
| `'Bet:100'` | `bet_100` |
| `'Raise:133'` | `raise` |
| `'Allin:...'` | `allin` |

---

### §6 Postflop Lookup Engine

**Source:** `js/engine/postflop-lookup.js`

```js
GTO.Engine.PostflopLookup.lookup(p)
// p: { spotType, boardTexture, handStrength, spr, boardCards, matchup, depth }
// Returns: { freqs, source, solverData, actions }
```

#### Spots with Solver Coverage

| Spot type | Node used |
|---|---|
| `OOP_cbet_flop` | root `strategy` |
| `IP_cbet_flop` | `nodes.ip_cbet` |
| `IP_facing_cbet` | `nodes.ip_facing_cbet` |
| `OOP_facing_cbet` | `nodes.oop_facing_cbet` |

> All other spots fall back to heuristic tables.

#### Board Match Priority

1. **Exact** — `board_cards` string matches an entry in `PostflopBoards`
2. **Texture** — any board with the same texture in this matchup
3. **Fuzzy** — `paired_wet` → `paired_dry`, `highly_connected` → `wet_rainbow`
4. **Fallback** — first non-error solution in the matchup

#### SPR → Case Mapping

| SPR | Case |
|---|---|
| `> 10.7` | `srp` |
| `> 3.55` | `3bet` |
| `≤ 3.55` | `4bet` |

#### Additional Methods

```js
GTO.Engine.PostflopLookup.resolveMatchup(heroPosition, isOOP) → key | null
GTO.Engine.PostflopLookup.solveLive(p, onResult, onProgress)  // WASM only — no Python equivalent
```

---

### §7 Postflop Live WASM Solver

**Source:** `js/solver/solver-api.js`

```js
GTO.Solver.solve(config)               // → Promise
GTO.Solver.getNodeResults(history)     // history: [] | [0] | [1] | [0,1]
GTO.Solver.parseRange(text)            // → range array
GTO.Solver.parseBoard(cards)           // → card array
```

**Spot → history mapping:**

| Spot | History |
|---|---|
| `OOP_cbet_flop` | `[]` |
| `IP_cbet_flop` | `[0]` |
| `IP_facing_cbet` | `[1]` |
| `OOP_facing_cbet` | `[0, 1]` |

> 📌 Python wrappers do **not** call the live WASM solver.

---

## Python Wrappers — `gto_advisor.py`

### Data Files

| JS file | Contains |
|---|---|
| `js/data/preflop-solutions.js` | Preflop CFR+ solutions (cash + MTT) |
| `js/data/postflop-solutions.js` | Postflop solutions — 100bb |
| `js/data/postflop-solutions-srp.js` | Postflop solutions — single-raised pot |
| `js/data/postflop-matchups.js` | Matchup definitions + board registry |
| `js/data/postflop-strategy.js` | Heuristic fallback tables |

---

### Card & Hand Format

```python
RANK_VALUES = {'2':2, '3':3, ..., 'T':10, 'J':11, 'Q':12, 'K':13, 'A':14}

_parse_card('Ac')   # → {'rank': 'A', 'suit': 'c'}
_parse_card('Td')   # → {'rank': 'T', 'suit': 'd'}
```

> **Ten = `'T'`, not `'10'`.**  Higher rank always comes first.

---

### BoardCategories

Full Python port of `GTO.Data.BoardCategories` (`js/data/board-categories.js`).

```python
BoardCategories.TEXTURES         # list[str] — 8 texture strings
BoardCategories.HAND_STRENGTHS   # list[str] — 18 strength strings
```

#### `classify(board_cards) → str`

```python
BoardCategories.classify(['Ac', '7d', '2h'])
# or with dicts: [{'rank': 'A', 'suit': 'c'}, ...]
# → one of TEXTURES
```

#### `classify_hand_strength(hole_cards, board_cards) → str`

```python
BoardCategories.classify_hand_strength(['Ac', 'Kd'], ['Ah', '7c', '2s'])
# hole_cards:  2-element list (strings or dicts)
# board_cards: 3–5 element list (strings or dicts)
# → one of HAND_STRENGTHS
```

**Strength priority (high → low):**

`full_house` › `flush` › `straight` › `set` › `trips` › `two_pair` › `overpair` ›
`top_pair_strong` › `top_pair_weak` › `second_pair` › `weak_pair` › `underpair` ›
`combo_draw` › `oesd_or_fd` › `gutshot` › `weak_draw` › `overcards` › `air`

> **Note:** `'overcards'` requires **both** hole cards above the board's max rank.

---

### Preflop API

#### `load_solutions(path) → dict`

```python
solutions = load_solutions(DATA_FILE)
# Returns: solutions[fmt][depth][context][position_key]
#          where position_key → { pure_raise, pure_call, mixed }
```

#### `get_action(solutions, fmt, depth, context, position_key, hand) → dict | None`

```python
result = get_action(solutions, 'cash', '100bb', 'rfi', 'BTN', 'AKs')
# Returns: { fold, call, raise, recommendation, source }
# Returns: None if position_key not found
# Unknown hand → pure fold dict (NOT None)
# source: 'pure' | 'mixed'
```

**Parameter sources:**

| Param | Source |
|---|---|
| `solutions` | Startup load — `load_solutions(DATA_FILE)` |
| `fmt` | Config / user input — `'cash'` or `'mtt'` (default: `'cash'`) |
| `depth` | Config / user input — effective stack in BB (default: `'100bb'`) |
| `context` | **Game state** — betting action level (see table below) |
| `position_key` | **Game state** — hero seat or `OPENER_HERO` pair |
| `hand` | **Game state** — from `gs.hand_key` (e.g. `'AKs'`, `'QQ'`) |

**Context derivation:**

| Betting situation | `context` value |
|---|---|
| No prior raise | `'rfi'` |
| Facing 1 raise | `'vs_raise'` |
| Opened, facing 3-bet | `'vs_3bet'` |
| 3-bet, facing 4-bet | `'vs_4bet'` |

**Position key format by context:**

| Context | Key format | Example |
|---|---|---|
| `rfi` | `HERO_POS` | `'BTN'` |
| `vs_raise` | `OPENER_HERO` | `'UTG_BTN'` |
| `vs_3bet` | `HERO_3BETTOR` | `'BTN_BB'` |
| `vs_4bet` | `HERO_4BETTOR` | `'CO_BB'` |

> ⚠️ **BB has no `rfi` entry** — skip the GTO lookup for BB open.

#### `list_position_keys(solutions, fmt, depth, context) → list[str]`

Returns sorted list of valid position keys for the given spot.

#### `norm_hand(hand_str) → str`

Normalise user input to canonical form (`10` → `T`, lowercase suits, etc.).

---

### Postflop Data Loader

#### `load_postflop_data(data_dir=None) → dict`

```python
pf_data = load_postflop_data()
# Returns:
# {
#   'solutions': { depth_key → { matchup_key → { board_label → node_dict } } },
#   'matchups':  { matchup_key → { label, oop, ip } },
#   'boards':    [ { board: [...], texture: str, label: str } ],
# }
```

`data_dir` defaults to `js/data/` relative to the repo root.
Silently skips unavailable depth files (prints a dim warning).

---

### Postflop Lookup

#### `postflop_lookup(...) → dict`

Full Python port of `GTO.Engine.PostflopLookup.lookup()`.

```python
result = postflop_lookup(
    spot_type     = 'OOP_cbet_flop',
    board_texture = 'dry_rainbow',
    hand_strength = 'top_pair_strong',
    spr           = 4.2,
    board_cards   = ['Ac', '7d', '2h'],
    matchup       = 'BTN_vs_BB',
    pf_data       = pf_data,
)
```

**Parameter sources:**

| Param | Source | Valid values |
|---|---|---|
| `spot_type` | **Game state** — street + IP/OOP + cbet or facing | See table below |
| `board_texture` | **Engine** — `BoardCategories.classify(gs.community_cards)` | See table below |
| `hand_strength` | **Engine** — `BoardCategories.classify_hand_strength(gs.hole_cards, gs.community_cards)` | See table below |
| `spr` | **Game state calc** — `(bb_unit * 100) / pot` (use `None` when `pot == 0`) | float or `None` |
| `board_cards` | **Game state** — `gs.community_cards` as raw card list | `['Ac','7d','2h']` |
| `matchup` | **Engine** — `resolve_matchup(gs.hero_position, gs.hero_is_oop, pf_data['matchups'])` — **required for solver data** | See matchup keys |
| `depth` | Config — optional override; auto-derived from `spr` when omitted | `'srp'` `'3bet'` `'4bet'` |
| `pf_data` | Startup load — `load_postflop_data()` — **required for solver data** | dict from loader |

**`spot_type` — all 12 valid values:**

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

> Flop spots (`*_cbet_flop`, `*_facing_cbet`) use **solver data** when `matchup` + `pf_data` are provided.  
> All turn / river spots fall back to **heuristic tables**.

**`board_texture` — all 8 valid values:**

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

**`hand_strength` — all 18 valid values** (weakest → strongest):

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
| `trips` | Three of a kind using one hole card on paired board |
| `set` | Three of a kind using pocket pair |
| `straight` | Straight |
| `flush` | Flush |
| `full_house` | Full house, quads, straight flush, or royal flush |

**Return value:**

| Key | Type | Description |
|---|---|---|
| `freqs` | `dict` | `{ action_key: float }` |
| `source` | `str` | `'solver'` or `'heuristic'` |
| `node_data` | `dict \| None` | Raw solver node (debugging) |
| `matchup_used` | `str \| None` | Matchup key used (solver path only) |
| `depth_used` | `str \| None` | Depth bucket used (solver path only) |

**Spot types with solver coverage:**

| Spot type | Node |
|---|---|
| `OOP_cbet_flop` | root `strategy` |
| `IP_cbet_flop` | `nodes.ip_cbet` |
| `IP_facing_cbet` | `nodes.ip_facing_cbet` |
| `OOP_facing_cbet` | `nodes.oop_facing_cbet` |

> All other spots (turn/river) fall back to heuristic.

**SPR → case mapping:**

| SPR | Case bucket |
|---|---|
| `> 10.7` | `srp` |
| `> 3.55` | `3bet` |
| `≤ 3.55` | `4bet` |

**Action keys:**

| Situation | Keys |
|---|---|
| Hero bets | `check` · `bet_33` · `bet_50` · `bet_67` · `bet_100` · `allin` |
| Hero faces bet | `fold` · `call` · `raise` · `allin` |

> **Note:** `bet_50` only appears in solver output. The heuristic fallback only returns `bet_33` / `bet_67` / `bet_100`.

#### `resolve_matchup(hero_position, is_oop, matchups) → str | None`

```python
key = resolve_matchup('BTN', is_oop=False, matchups=pf_data['matchups'])
# Mirrors GTO.Engine.PostflopLookup.resolveMatchup()
# is_oop=True  → hero is first to act (out of position)
# Falls back to a random matchup if no exact position match.
```

---

### Postflop Heuristic Fallback (`postflop_heuristic.py`)

```python
SPOT_TYPES = [
    'IP_cbet_flop', 'OOP_cbet_flop',
    'IP_turn_barrel', 'OOP_turn_barrel',
    'IP_river_bet', 'OOP_river_bet',
    'IP_facing_cbet', 'OOP_facing_cbet',
    'IP_facing_turn_bet', 'OOP_facing_turn_bet',
    'IP_facing_river_bet', 'OOP_facing_river_bet',
]
BOARD_TEXTURES = [
    'dry_rainbow', 'dry_twotone', 'wet_rainbow', 'wet_twotone',
    'monotone', 'paired_dry', 'paired_wet', 'highly_connected',
]
HAND_STRENGTHS = [
    'air', 'overcards', 'weak_draw', 'gutshot', 'combo_draw', 'oesd_or_fd',
    'underpair', 'weak_pair', 'second_pair', 'top_pair_weak', 'top_pair_strong',
    'overpair', 'two_pair', 'trips', 'set', 'straight', 'flush', 'full_house',
]
BETTING_SPOTS   # set[str]  — spots where hero bets (check/bet actions): all without 'facing'
FACING_SPOTS    # set[str]  — spots where hero faces a bet (fold/call/raise): all with 'facing'
```

#### `lookup(spot_type, board_texture, hand_strength, spr=None) → dict | None`

Returns action-frequency dict, or `None` if `spot_type` / `hand_strength` is unknown.

> ⚠️ **Always guard the return value** — log a warning and default to `'fold'` if `None`.

#### `recommendation(freqs) → str`

Returns the action key with the highest frequency in `freqs`.

---

## How `get_gto_action.py` Uses These APIs

### Preflop

```python
g = G.get_action(solutions, 'cash', '100bb', context, position_key, hand)
if g is None:
    log.error("unknown position_key")
    return 'fold'
recommendation = g['recommendation']
```

### Postflop — current (heuristic only)

```python
freqs = PF.lookup(spot, board_tex, hand_str, spr=spr)
if freqs is None:
    log.warning("heuristic lookup returned None")
    return 'fold'
recommendation = PF.recommendation(freqs)
```

### Postflop — improved (solver-backed)

```python
result = G.postflop_lookup(
    spot_type     = spot,
    board_texture = board_tex,
    hand_strength = hand_str,
    spr           = spr,
    board_cards   = gs.community_cards_raw,   # e.g. ['Ac','7d','2h']
    matchup       = G.resolve_matchup(hero_pos, is_oop, pf_data['matchups']),
    pf_data       = pf_data,                  # loaded once at startup
)
recommendation = PF.recommendation(result['freqs'])
# result['source'] == 'solver' for the 4 covered flop spots
```

---

## Compliance Notes

> Status as of `apollo/python/` — 2026-03-07

| Status | Item |
|---|---|
| ✅ | All 12 `SPOT_TYPES` produced by `_spot_type()` |
| ✅ | All 8 `BOARD_TEXTURES` produced by `BoardCategories.classify()` |
| ✅ | All 18 `HAND_STRENGTHS` produced by `BoardCategories.classify_hand_strength()` |
| ✅ | Hand notation canonical (`'T'` not `'10'`, `'s'`/`'o'` suffix correct) |
| ✅ | Suited suffix only when both suits valid AND equal (`game_state.py`) |
| ✅ | `get_action()` `None` guard for unknown position key |
| ✅ | `spr = bb_unit * 100 / pot` (consistent with `depth='100bb'`) |
| ✅ | `PF.lookup()` `None` guard: `log.warning` + return `'fold'` early |
| ✅ | Postflop uses `G.postflop_lookup()` (solver for 4 flop spots, heuristic fallback for turn/river). |
| ⚠️ | BB has no RFI entry. `_preflop_context_key()` returns `('','')` for BB at `BB_BET` level, correctly suppressing the GTO lookup. |
| 📋 | **TODO** (postflop `None` fallback): replace hard fold with pot-commitment: `recommendation = 'call' if committed_ratio >= 0.33 else 'fold'` where `committed_ratio = hero_invested / (hero_invested + pot)`. Currently unreachable because `_hand_strength()` only emits known values. |
