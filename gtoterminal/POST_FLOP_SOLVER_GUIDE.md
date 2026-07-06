# Postflop Solver Guide

The pipeline has two layers. The **client** asks a middle API (`PostflopLookup.lookup`)
for a strategy; the API selects a matching **pre-computed** solution that was
produced offline by the precompute script feeding the WASM solver.

```
Layer 1                         Layer 2
game client ──lookup(p)──> PostflopLookup ──selects──> pre-computed solution
                           (js/engine/                  (produced offline by
                            postflop-lookup.js)          precompute → solver)
```

---

## Layer 1 — Game Client → Lookup API

The client calls `GTO.Engine.PostflopLookup.lookup(p)`
([postflop-lookup.js](js/engine/postflop-lookup.js)). It must supply **5 factors**:

| # | Factor | Param | Purpose |
|---|--------|-------|---------|
| 1 | **Board** | `boardTexture` + `boardCards` | Map your board to a solved board — exact card match first, then texture match (e.g. `dry_rainbow`), then fuzzy fallback |
| 2 | **Hand strength class** | `handStrength` | Your hand category (e.g. `strong_pair`). Used to pick a strategy in the heuristic fallback |
| 3 | **SPR** | `spr` | Stack-to-pot ratio. **This is the depth key** — the client passes SPR directly, *not* stack depth. SPR encodes the preflop line (SRP / 3bet / 4bet) into one number |
| 4 | **Position matchup** | `matchup` | Who is OOP vs IP — `SB_vs_BB`, `BTN_vs_BB`, `CO_vs_BB`, `UTG_vs_BB`, `BTN_vs_SB`. **Required** for a solver hit |
| 5 | **Spot type (decision node)** | `spotType` | Street + who acts + what they face: `OOP_cbet_flop`, `IP_cbet_flop`, `IP_facing_cbet`, `OOP_facing_cbet` |

> Factors 4 and 5 are the ones commonly forgotten. Without `matchup` the lookup
> skips the solver entirely and returns a heuristic. `spotType` selects which
> node inside the solved tree to read (`_SPOT_NODE_MAP`).
>
> The client passes **SPR**, never stack depth. SPR is the real dimension: it
> already folds the preflop line and effective stack into a single ratio, so the
> API never needs to know the raw stack depth.

**How each client factor maps to a pre-computed dimension:**

| Client factor | Selects | Resolver |
|---------------|---------|----------|
| `spr` | solved case (`srp` / `3bet` / `4bet`) | `_resolveCase(spr)` — picks the nearest solved SPR (16 / 5.4 / 1.7) |
| `matchup` | the OOP/IP range pair | `_getSolutions(case)[matchup]` |
| `boardTexture`+`boardCards` | the solved board | `_findSolution()` — exact → texture → fuzzy |
| `spotType` | the tree node | `_SPOT_NODE_MAP[spotType]` |
| `handStrength` | (heuristic fallback only) | `_lookupPostflopHeuristic()` |

---

## Layer 2 — Precompute → Solver

Each pre-computed solution is defined by **5 things**, all set in
`scripts/precompute-postflop.mjs` and passed to `manager.init()`:

| # | Factor | Defined In | Notes |
|---|--------|-----------|-------|
| 1 | **Specific board** | `FLOP_BOARDS` | 3 exact card IDs (+ a texture label for client matching) |
| 2 | **SPR** | `DEPTH_CONFIGS[].pot` / `.stack` | Pot normalized to 100; stack sets SPR. **Solutions are keyed by preflop-line case, not stack depth** — three 100bb cases are solved: `srp` (SPR 16), `3bet` (SPR 5.4), `4bet` (SPR 1.7) |
| 3 | **Specific range pair** | `MATCHUPS` or preflop-derived `postflop-input-ranges.json` | Must match the preflop line — SRP vs 3bet vs 4bet produce different SPRs at the same stack depth (see note) |
| 4 | **Game tree** | `DEPTH_CONFIGS[].betSizes` + `donkOption` | Bet/raise sizes per street; `donkOption` is a game-tree factor |
| 5 | **Additional** | hardcoded in the `manager.init()` call | Rake (`0,0`), tree thresholds (`1.5/0.15/0.1`), custom lines (`'',''`) |

> **SPR depends on the preflop line, not just stack depth.** At 100bb effective:
> a single-raised pot has SPR ≈ 16, a 3bet pot ≈ 5.4, a 4bet pot ≈ 1.7. So the
> range (factor 3) and the SPR (factor 2) must come from the *same* preflop line.
> This is why the preflop-derived range must be paired with the correctly
> computed SPR for SRP / 3bet / 4bet.
>
> **Consequence:** SPR is the true index on both layers. The client passes SPR
> (not stack depth); `_resolveCase(spr)` maps it to the nearest of the three
> solved 100bb cases — `srp` (16), `3bet` (5.4), `4bet` (1.7) — each paired with
> the range from that same preflop line.

---

## Solver Inputs (full parameter list for Layer 2)

All inputs go through one call: `manager.init()` in `scripts/precompute-postflop.mjs`.

| # | Param | Defined In | Source |
|---|-------|-----------|--------|
| 1 | `oopRange` | `MATCHUPS` / preflop-derived | range pair (see Layer 2 #3) |
| 2 | `ipRange` | same | range pair |
| 3 | `board` (3 card IDs) | `FLOP_BOARDS` | 23 boards across 7 texture labels |
| 4 | `startingPot` | `DEPTH_CONFIGS` | always `100` (normalized) |
| 5 | `effectiveStack` | `DEPTH_CONFIGS` | `1600`/`540`/`170` for srp/3bet/4bet (legacy `450`/`175`/`100`/`50`) |
| 6 | `rakeRate`, `rakeCap` | hardcoded in `manager.init()` call | **disabled** (`0, 0`) |
| 7 | `donkOption` | `DEPTH_CONFIGS` | `true` for srp/3bet/4bet (donk 50% turn & river) |
| 8 | All 18 bet sizes | `DEPTH_CONFIGS[].betSizes` | flop 33%/75%, turn 33%/75%, river 25%/33%/75%/120%, raise 60% (see [game_tree.md](game_tree.md)) |
| 9 | Tree thresholds | hardcoded in `manager.init()` call | `1.5`, `0.15`, `0.1` |
| 10 | `addedLines`, `removedLines` | hardcoded in `manager.init()` call | **unused** (`'', ''`) |

**Ranges** may now come from the preflop solver (via `postflop-input-ranges.json`,
produced by `scripts/preflop-to-postflop-ranges.mjs`); all other inputs are fixed
in the precompute script. Built-in `MATCHUPS` act as backup for any empty derived side.

### Preflop → Postflop range mapping (per case)

The bridge reads the 100bb preflop solution and fills each seat from the preflop
line that produced the case. `key = {opener}_{defender}` (e.g. `SB_BB`):

| Case | OOP (opener) | IP (defender) |
|------|--------------|---------------|
| `srp`  | `rfi[opener]` open (raise) | `vs_raise[key]` flat-call |
| `3bet` | `vs_3bet[key]` call (opener calls 3bet) | `vs_raise[key]` raise (defender 3bet) |
| `4bet` | `vs_3bet[key]` raise (opener 4bet) | `vs_4bet[key]` call (3bettor calls 4bet) |

Output is written to `postflop-input-ranges.json` under `cases.{srp,3bet,4bet}`;
the precompute script auto-loads the section matching its `--depth` case. Any side
whose preflop line yields a near-empty range (e.g. the srp flat-call range, since
the solver 3bets rather than flats) keeps the built-in `MATCHUPS` default.


---

## One Solve = All Streets

`manager.init()` builds a full flop + turn + river game tree and solves all streets in one Nash equilibrium computation. Turn/river data extraction is on by default (disable with `--no-turn` / `--no-river`) and just reads pre-computed nodes from the tree — no separate solve needed.

For the tree shape, sizings, and per-case commitment/all-in behavior, see [game_tree.md](game_tree.md).

---

## Commands

```bash
cd gtoterminal

# (Optional) Derive input ranges from the preflop solution first
node scripts/preflop-to-postflop-ranges.mjs            # writes cases: srp/3bet/4bet

# Single spot test
node scripts/precompute-postflop.mjs --depth srp --matchup UTG_vs_BB --board A72r --iterations 10

# Solve each preflop-line case (all 100bb effective) — --store persists to disk
node scripts/precompute-postflop.mjs --depth srp  --store   # SPR 16
node scripts/precompute-postflop.mjs --depth 3bet --store   # SPR 5.4
node scripts/precompute-postflop.mjs --depth 4bet --store   # SPR 1.7
```

---

## Output Files

| Flag | Output | Variable |
|------|--------|--------|
| `--depth srp` | `js/data/postflop-solutions-srp.js` | `PostflopSolutions_SRP` |
| `--depth 3bet` | `js/data/postflop-solutions-3bet.js` | `PostflopSolutions_3BET` |
| `--depth 4bet` | `js/data/postflop-solutions-4bet.js` | `PostflopSolutions_4BET` |
| *(default, `--no-turn` to skip)* | `js/data/postflop-solutions-turn-<case>.js` | `PostflopSolutionsTurn_*` |
| *(default, `--no-river` to skip)* | `js/data/postflop-solutions-river-<case>.js` | `PostflopSolutionsRiver_*` |

> The `100bb` baseline case remains available alongside the three
> preflop-line cases.

