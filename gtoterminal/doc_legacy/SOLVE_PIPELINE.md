# Postflop Solve Pipeline

How the precompute pipeline generates GTO postflop solutions and how to run it.

## Scripts

| Script | Role |
|--------|------|
| [`solve-unsolved.mjs`](solve-unsolved.mjs) | **Resilient driver.** Runs one board at a time, skips already-complete boards, survives crashes. Use this for bulk runs. |
| [`scripts/precompute-postflop.mjs`](scripts/precompute-postflop.mjs) | The actual solver. Solves every matchup for a given board/depth and writes results. Called by the driver (or directly for a single board). |
| [`solver-native/`](solver-native/) | Native (non-WASM) Rust solver binary — no 4 GiB cap, multithreaded via `rayon`. Used by default. |

## What gets solved

- **5 matchups** per board: `SB_vs_BB`, `BTN_vs_BB`, `CO_vs_BB`, `UTG_vs_BB`, `BTN_vs_SB`.
- **Depths** (preflop pot type → normalized SPR): `srp` (SPR 16), `3bet` (5.4), `4bet` (1.7).
- **Streets:** flop always; **turn + river are extracted by default** (disable with `--no-turn` / `--no-river`).

### Output files (per depth `<D>`)

| File | Contents |
|------|----------|
| `js/data/postflop-solutions-<D>.js` | Flop: root strategy + `ip_cbet` / `ip_facing_cbet` / `oop_facing_cbet` nodes. |
| `js/data/postflop-solutions-turn-<D>.js` | Turn strategies keyed by action line → turn card. |
| `js/data/postflop-solutions-river-<D>.js` | River strategies keyed by action line → turn card → turn line → river card. |

> Note: **action lines** (`check_check`, `bet_small_call`, …) only ever appear in the **turn/river** files, never in the flop file. The flop file's node set is fixed.

## Override / resume behavior

The pipeline is **incremental and crash-safe** — it does **not** re-solve everything each run.

1. **Driver picks boards.** A board is "solved" only when every matchup has flop nodes **and** turn lines **and** river lines (when those extractions are on). Flop-only / errored / missing boards count as **unsolved** and get run. Fully complete boards are **skipped**.
2. **Precompute merges + overwrites.** When a board is run, its entry is replaced (`solutions[matchup][board] = newResult`) while all other boards are preserved. Results are written to disk **after each spot**, so a crash keeps everything already finished.

So incomplete (e.g. flop-only) data is overridden **once** on the next run, then left alone on subsequent runs.

To force a re-solve of an already-complete board, run precompute directly with `--board <label>` (it always re-solves the named board), or delete that board's entry first.

## Commands

Run from the `gtoterminal/` directory.

```bash
# Solve ALL boards for one depth (flop + turn + river, native engine)
node solve-unsolved.mjs --depth srp

# Solve ALL depths, one after another (continues even if one depth errors)
node solve-unsolved.mjs --depth srp; node solve-unsolved.mjs --depth 3bet; node solve-unsolved.mjs --depth 4bet

# Just list solved / unsolved boards (no solving)
node solve-unsolved.mjs --depth srp --list

# Flop only (skip turn/river)
node solve-unsolved.mjs --depth srp --no-turn --no-river

# Single board directly (always re-solves, overwrites that board)
node scripts/precompute-postflop.mjs --depth srp --board A72r
```

### Useful flags (driver)

| Flag | Default | Meaning |
|------|---------|---------|
| `--depth` | `srp` | `srp` / `3bet` / `4bet` |
| `--iterations` | `500` | Max CFR iterations per spot |
| `--target` | `0.5` | Target exploitability (% of pot). Lower = tighter/GTO but slower. |
| `--engine` | `native` | `native` / `wasm` |
| `--no-turn`, `--no-river` | off | Disable turn / river extraction |
| `--matchup <key>` | all | Solve a single matchup |
| `--list` | — | List solved/unsolved and exit |

> Multithreading: the native engine uses all CPU cores. Cap it with the `RAYON_NUM_THREADS` env var, e.g. `RAYON_NUM_THREADS=8 node solve-unsolved.mjs --depth srp`.

## Python client

The Python game-state client ([`python/get_gto_action.py`](../python/get_gto_action.py)) consumes these files. It picks the depth from the preflop pot type (`srp` / `3bet` / `4bet`) and looks up flop, turn, and river strategies (heuristic fallback when data is missing).
