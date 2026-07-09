# GTOTerminal

A free, open-source GTO poker trainer that runs entirely in your browser. No servers, no subscriptions, no build tools — just open `index.html` and train.

![GTOTerminal](https://img.shields.io/badge/status-alpha-orange) ![License](https://img.shields.io/badge/license-MIT-blue)

## Why This Exists

Commercial GTO trainers charge $39-279/month and require constant server connectivity. GTOTerminal delivers the same core training loop — preflop ranges, postflop solver output, drills, hand playthrough — as static files that run client-side. Your browser does everything.

**Cost: $0/month, forever.**

## What You Get

### vs. GTO Wizard / PokerCoaching

| Feature | GTOTerminal | GTO Wizard ($39-279/mo) |
|---------|-------------|------------------------|
| **Preflop solver** | CFR+ WASM solver with 200+ pre-computed spots + live solve for any spot | Millions of solver-computed scenarios |
| **Postflop solutions** | 460 pre-computed spots + live WASM solver for any board | 300K+ solved spots + neural net |
| **Multi-street consistency** | Preflop action filters postflop range + composition-aware frequency adjustment | Full game tree with solved turn/river |
| **ICM / tournament support** | Bubble factor, ICM pressure, Nash push/fold charts | Full ICM solver integration |
| **Range composition analysis** | Shows monsters/strong/draws/air breakdown per board | Similar feature in premium tier |
| **Format coverage** | Cash + MTT with ICM toggle across all modes | Cash + MTT + spin & go + PKO |
| **Offline** | Fully offline | No |
| **Open source** | Yes (MIT) | No |

We're not a GTO Wizard replacement — they have real infrastructure and a team. GTOTerminal is for players who want solid GTO training without a subscription, and developers who want to see how poker engines work.

### Preflop Solver

**The only free, open-source in-browser preflop GTO solver.** Built from scratch using CFR+ (Counterfactual Regret Minimization Plus) compiled to WebAssembly:

- **200+ pre-computed spots** across 5 stack depths (100bb/40bb/25bb/20bb/15bb), 4 action contexts (RFI, vs raise, vs 3bet, vs 4bet), and all 6-max position matchups
- **Live solve** for any uncovered spot — click "SOLVE WITH ENGINE" in Explore to run the WASM solver in-browser with real-time progress
- **Stack-depth aware** — open sizes, 3bet/4bet sizes, opponent defense rates, and equity realization all scale with effective stacks
- **Sequential range building** — vs_raise solutions use the villain's actual RFI range, vs_3bet uses the actual 3bet range, etc.
- **ICM overlay** — MTT spots automatically tightened via bubble factor when ICM is enabled
- **Calibrated** against known solver benchmarks — ranges within 1-3% of reference GTO data across all positions and depths

### Postflop Solver

460 pre-computed flop solutions across 5 matchups, 23 board textures, and 4 stack depths. For custom boards, a Rust-compiled WASM solver runs locally in your browser via Web Workers — no server round-trip needed.

## Features

- **Explore** — Browse preflop + postflop ranges on a 13x13 hand matrix with board picker, texture presets, solver stats, and OOP range composition display
- **Drill** — Timed preflop, postflop, and push/fold training with GTO feedback, frequency bars, EV loss tracking, and composition-aware scoring
- **Play** — Multi-street hand playthrough (preflop through river) with inline range analysis, board texture breakdown, hand strength classification, and range composition bars
- **Plans** — Structured training plans (MTT Fundamentals, Cash Grinder, Tournament Prep, Leak Plugger)
- **Learn** — AI-generated strategy articles powered by Groq/Llama 3.3 70B, scored against your weakness profile
- **Stats** — Player profile with accuracy tracking, EV loss analysis, skill rating, achievements, and weakness detection
- **Stream** — Twitch/YouTube embeds with AI vision-based hand analysis

### Multi-Street Consistency

When you take a preflop action (raise/call), that context carries through to postflop across all three interactive tabs (Explore, Drill, Play):
- **Filtered hand selection** — Postflop scenarios only deal hands consistent with your preflop action
- **Range composition display** — See what % of your range is monsters, strong, draws, or air on each board
- **Frequency adjustment** — GTO recommendations nudged 5-10% based on your range composition (tight range = bet more, wide range = check more)

### ICM Calculator & Tournament Support

Full ICM (Independent Chip Model) implementation built from scratch:
- **ICM equity calculation** — Exact recursive Malmuth-Harville model computing each player's $EV from chip stacks and prize pool
- **Bubble factor** — Measures risk/reward asymmetry near the money. BF > 1.0 means chips lost are worth more than chips gained, tightening optimal ranges
- **ICM pressure indicator** — Low/Medium/High/Extreme labels with color coding based on tournament stage
- **Frequency adjustment** — All preflop and postflop GTO frequencies automatically adjusted when ICM is enabled (tighter opens, more folding vs aggression)
- **MTT format toggle** — Available across all tabs (Explore, Drill, Play) with one-click ICM on/off
- **Nash push/fold charts** — Short-stack equilibrium ranges for tournament endgame

## Quick Start

```bash
git clone https://github.com/matt-nowakowski/gtoterminal.git
cd gtoterminal
open index.html
```

No npm, no build step, no server required.

### AI Coaching (Optional)

1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Click the gear icon in GTOTerminal and paste your key
3. Click "Explain" on any drill result for AI-powered GTO analysis

### WASM Solvers (Optional)

The live solvers require an HTTP server (not `file://`). Pre-computed solutions work without it.

```bash
# Re-compute preflop solutions (200+ spots, ~3 seconds)
node scripts/precompute-preflop.mjs

# Re-compute postflop solutions (460 spots per depth)
node scripts/precompute-postflop.mjs --depth srp
node scripts/precompute-postflop.mjs --depth 3bet
node scripts/precompute-postflop.mjs --depth 4bet
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-7` | Switch tabs |
| `F / C / R` | Fold / Call / Raise |
| `X` | Check |
| `1 / 2 / 3` | Bet 1/3 / 2/3 / Pot |
| `P / F` | Push / Fold (MTT) |
| `Space / N` | Next hand |
| `E` | AI explain |
| `?` | Help |

## Open Source Acknowledgements

GTOTerminal builds on the work of several open-source projects:

- **[postflop-solver](https://github.com/b-inary/postflop-solver)** by Wataru Inariba — The CFR solver that powers our WASM postflop engine. Compiled to WebAssembly via wasm-pack. Licensed under AGPL-3.0.
- **[wasm-bindgen](https://github.com/rustwasm/wasm-bindgen)** — Rust-to-JavaScript interop that makes both WASM solvers callable from the browser.
- **[wasm-pack](https://github.com/rustwasm/wasm-pack)** — Build toolchain for compiling Rust to WASM with size optimization.
- **[serde](https://github.com/serde-rs/serde)** / **[serde_json](https://github.com/serde-rs/json)** — Serialization framework used by the preflop solver for JSON config parsing.
- **[Groq](https://groq.com)** — Fast LLM inference API (Llama 3.3 70B) used for the optional AI coaching and Learn tab article generation.

### Preflop Solver

The preflop solver (`solver-preflop/`) is an **original implementation** written from scratch for GTOTerminal. It implements the CFR+ (Counterfactual Regret Minimization Plus) algorithm for 169 canonical hand groups in 6-max NLHE. The equity model uses a logistic matchup function with domination, pair, and suited adjustments calibrated against Monte Carlo simulations. Licensed under MIT, separate from the AGPL postflop solver.

## Contributing

Contributions welcome. High-impact areas:

- **More pre-computed postflop solutions** — Additional boards and matchups
- **WASM solver optimization** — Faster convergence and solve speed
- **Hand history import** — Parse from PokerStars, GGPoker, ACR
- **Range builder** — Paint custom ranges on the 13x13 matrix

## License

MIT. See [LICENSE](LICENSE).

- The **postflop** WASM solver (`solver/`) is AGPL-3.0, matching the upstream [postflop-solver](https://github.com/b-inary/postflop-solver) license.
- The **preflop** WASM solver (`solver-preflop/`) is MIT — original implementation, no upstream dependency.
