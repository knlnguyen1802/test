# Native Solver — Build & Optimization

The native solver ([`solver-native`](./src/main.rs)) runs the same
[`postflop-solver`](https://github.com/b-inary/postflop-solver) CFR+ engine as
the browser WASM build, but as a native binary. It uses the **system allocator**
(all host RAM) instead of the wasm32 bump arena, so it is **not** bound by the
4 GiB wasm32 address-space limit — deep spots (e.g. 100bb single-raised pot,
SPR ~16) that need >4 GiB solve here.

The Node precompute pipeline uses it automatically when built
(`--engine auto`, the default). Force it with `--engine native`, or fall back to
the in-process WASM child with `--engine wasm`.

## Build

Standard release build:

```bash
cargo build --release --manifest-path solver-native/Cargo.toml
```

Output: `solver-native/target/release/gto-solver-native(.exe)`.

## Optimization options

### 1. Multithreading (biggest win — already enabled)

The crate enables the `rayon` feature, so the CFR solve runs across all CPU
cores. Speedup is roughly linear in core count (e.g. ~8× on 8 cores). Nothing to
do at build time; control the thread count at runtime:

```bash
# PowerShell
$env:RAYON_NUM_THREADS=8; node scripts/precompute-postflop.mjs --depth srp --board A72r

# bash
RAYON_NUM_THREADS=8 node scripts/precompute-postflop.mjs --depth srp --board A72r
```

Leave it unset to use every core. Set it lower to keep the machine responsive.

> Note: multithreaded CFR can produce tiny floating-point differences vs the
> single-threaded WASM path (iteration ordering). Convergence is identical; the
> differences are harmless since native is the primary engine.

### 2. `target-cpu=native` (~10–20%)

Lets the compiler use your CPU's full instruction set (AVX2/AVX-512, FMA):

```bash
# PowerShell
$env:RUSTFLAGS="-C target-cpu=native"; cargo build --release --manifest-path solver-native/Cargo.toml

# bash
RUSTFLAGS="-C target-cpu=native" cargo build --release --manifest-path solver-native/Cargo.toml
```

Binaries built this way are tuned to the machine that compiled them — rebuild if
you move to different hardware.

### 3. Already-on release tuning

`Cargo.toml` sets `lto = true`, `codegen-units = 1`, and `opt-level = 3`. These
maximize runtime speed at the cost of longer compile times (fine for a tool you
build rarely).

### 4. Trim the game tree (fewer nodes = faster + less RAM)

Per-iteration cost scales with tree size. Reduce it via the bet-sizing menu in
`scripts/precompute-postflop.mjs` (`LINE_BET_SIZES`):

- Fewer **river** bet sizes (the deepest layer — biggest multiplier).
- Drop the **donk** lead (`donkOption: false`).
- Fewer **turn**/**flop** sizes.

### 5. Fewer iterations / looser target

The solver stops at whichever comes first: `--iterations <cap>` or the target
exploitability `--target <pct-of-pot>`. See below.

## How many iterations?

Iteration count is **not** the quality knob — **exploitability** is. The loop
stops as soon as exploitability drops below `--target` (percent of pot), so set a
generous iteration cap and let the target decide.

- **Exploitability** (printed each run) is how much a perfect opponent could
  exploit the strategy, in chips. Lower = closer to GTO. Rules of thumb:
  - `< 1% of pot` — practically GTO, good for study/precompute.
  - `< 0.5% of pot` — very tight, diminishing returns.
- CFR+ converges fast early then slowly. Typical postflop spots reach
  ~1% pot in roughly **100–300 iterations**, ~0.5% in a few hundred more.
- **10 iterations is far too few** — the strategy is essentially unconverged
  (exploitability still very high). It only looked slow because each iteration on
  the deep SRP tree is expensive single-threaded; with `rayon` enabled it is much
  faster per iteration.

Recommended defaults:

```bash
# cap high, let the 0.5–1% target stop it early
node scripts/precompute-postflop.mjs --depth srp --board A72r --iterations 500 --target 0.5
```

Watch the printed `exploit=` value: if it's already under your target well before
the cap, the cap is fine; if it's still high at the cap, raise `--iterations` or
loosen `--target`.
