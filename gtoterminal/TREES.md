# Trees: Solution Tree vs. Postflop Data Tree

Two very different structures live in this project:

- **Solution Tree** — the *full* game tree the CFR solver (`postflop-solver`) can
  expose in memory. Rich, per-combo, per-action, every runout. Never persisted whole.
- **Postflop Data Tree** — the *pruned, aggregated* structure the pipeline
  (`scripts/precompute-postflop.mjs` + `solver-native`) extracts and saves to
  `js/data/`. Small enough to ship to the browser.

The pipeline walks the Solution Tree, samples a fixed set of nodes, collapses
per-combo detail into reach-weighted averages + 18 hand-strength buckets, and
writes the Postflop Data Tree.

---

## 1. Solution Tree (solver capacity)

A standard poker game tree held by `PostFlopGame`. Alternating **decision nodes**
(OOP/IP) and **chance nodes** (turn/river cards), terminating at showdown/fold
**terminal nodes**. It branches on *every* configured bet/raise size, at every
street, across *all* legal runouts.

Every **decision node** can emit — for **each live private-hand combo** (up to 1326,
minus board blockers) — the packed `get_results()` payload
([solver/src/lib.rs](solver/src/lib.rs#L281), [solver-native/src/main.rs](solver-native/src/main.rs#L232)):

| Field | Granularity | Source method |
|---|---|---|
| raw reach weight | per combo | `weights(p)` |
| normalized weight (combo count) | per combo | `normalized_weights(p)` |
| equity | per combo | `equity(p)` |
| EV (chips) | per combo | `expected_values(p)` |
| EQR (equity realization) | per combo | derived `ev / (pot·eq)` |
| strategy (mixed freq) | per combo × action | `strategy()` |
| per-action counterfactual EV | per combo × action | `expected_values_detail(p)` |
| pot sizes (OOP/IP view) | node | `total_bet_amount()` + `starting_pot` |
| available actions + amounts | node | `available_actions()` |

**Chance nodes** additionally expose `possible_cards()` (52-bit mask of dealable
cards). Node locking (`lock_current_strategy`) and `exploitability()` are also
available.

```mermaid
graph TD
    subgraph Payload["Per DECISION node — full per-combo payload"]
        direction LR
        P0["pots OOP / IP"]
        P1["weights raw + normalized"]
        P2["equity per combo"]
        P3["EV per combo"]
        P4["EQR per combo"]
        P5["strategy: action x combo"]
        P6["EV detail: action x combo"]
    end

    R["Root = Flop decision (OOP)"] --> A1["Check"]
    R --> A2["Bet size 1"]
    R --> A3["Bet size 2 ... N"]

    A2 --> B1["Fold"]
    A2 --> B2["Call"]
    A2 --> B3["Raise size 1..M"]

    B2 --> C{{"Chance node: TURN\n~45 cards, possible_cards()"}}
    C --> T1["Turn Ts"]
    C --> T2["Turn 2h ... (each dealable card)"]

    T1 --> D1["Turn decision (OOP/IP)"]
    D1 --> D2["... bets / raises / calls ..."]
    D2 --> E{{"Chance node: RIVER\n~44 cards"}}
    E --> RV1["River Kd ... (each card)"]
    RV1 --> F["River decision"]
    F --> G["... bets / raises ..."]
    G --> Z["Terminal: showdown / fold"]

    R -.holds.-> Payload
    D1 -.holds.-> Payload
    F -.holds.-> Payload
```

**Key traits:** full branching on every size, all runouts, per-combo + per-action
resolution. This is what the solver *can* produce — it is huge and lives only in
RAM during a solve.

---

## 2. Postflop Data Tree (extracted + persisted)

What the pipeline keeps. It samples a **fixed vocabulary** of canonical decision
nodes and action lines, collapses per-combo detail into:

- **aggregate strategy** — reach-weighted average freq per action, and
- **strategyByClass / `bc`** — the same, bucketed into 18 hand-strength classes
  (`classify_hand_strength`, [solver-native/src/main.rs](solver-native/src/main.rs#L628)).

Per-combo equity/EV/EQR and per-action EV are **dropped** (only *root* average
equity/EV survive). Files live under `js/data/`:

| File | Variable | Holds |
|---|---|---|
| `postflop-solution-index{suffix}.js` | `PostflopSolutionIndex` | metadata: depth, matchups, boards, settings |
| `postflop-solutions{suffix}.js` | `PostflopSolutions` | flop entries + 9 flop decision nodes |
| `postflop-solutions-turn{suffix}.js` | `PostflopSolutionsTurn` | turn nodes per flop line per turn card |
| `js/data/river/{depth}/{matchup}/{board}.json` | (per-file JSON) | river nodes per flop+turn line per river card |

The **10 canonical node slots** per street (indices `s[0..9]` / `bc[0..9]`,
`StreetNodes`, [solver-native/src/main.rs](solver-native/src/main.rs#L820)):
`OOP first`, `IP after check`, `IP vs small bet`, `OOP vs small probe`,
`OOP vs raise (bet small)`, `OOP vs raise (bet large)`, `IP vs x-raise (small)`,
`IP vs x-raise (large)`, `IP vs large bet`, `OOP vs large probe`.

The **9 action lines** that advance a street (`action_lines`,
[solver-native/src/main.rs](solver-native/src/main.rs#L1044)): `check_check`,
`bet_small_call`, `bet_large_call`, `xbet_small_call`, `xbet_large_call`,
`bet_small_raise_call`, `bet_large_raise_call`, `xbet_small_raise_call`,
`xbet_large_raise_call`.

```mermaid
graph TD
    IDX["postflop-solution-index.js\ndepth, matchups, boards, settings"]

    SOL["postflop-solutions.js\nPostflopSolutions"] --> MK["matchup e.g. SB_vs_BB"]
    MK --> BL["board label e.g. A72r"]
    BL --> FE["Flop entry:\nboard, texture, actions, player,\nstrategy (root avg),\noopEquity/ipEquity, oopEV/ipEV,\nexploitability, iterations, combos"]
    FE --> NODES["nodes { 9 flop decisions }"]
    NODES --> N1["ip_cbet"]
    NODES --> N2["oop_facing_cbet / _large"]
    NODES --> N3["*_facing_raise_small / _large"]
    N1 --> NP["each: actions, player, numActions,\nstrategy (agg), strategyByClass (18)"]

    TURN["postflop-solutions-turn.js\nPostflopSolutionsTurn"] --> TMK["matchup"]
    TMK --> TBL["board label"]
    TBL --> TL["lines { by flop action line }"]
    TL --> TLK["e.g. bet_small_call"]
    TLK --> TC["actions[10] + cards { turnCard }"]
    TC --> TCD["s[0..9] strategies\nbc[0..9] by-class"]

    RIV["river/{depth}/{matchup}/{board}.json"] --> RL["lines { flop line }"]
    RL --> RTC["turnCard"]
    RTC --> RTL["turnLine"]
    RTL --> RC["actions[10] + cards { riverCard }"]
    RC --> RCD["s[0..9] strategies\nbc[0..9] by-class"]
```

---

## 3. Solution Tree → Data Tree (what is lost)

```mermaid
graph LR
    subgraph Solution["Solution Tree (in RAM)"]
        S1["every bet/raise size branches"]
        S2["all turn + river runouts"]
        S3["per-combo: weight, equity,\nEV, EQR"]
        S4["per-combo x per-action EV"]
        S5["per-combo strategy"]
    end

    subgraph Data["Postflop Data Tree (on disk)"]
        D1["fixed 2 sizes -> 9-10 node slots"]
        D2["fixed 9 action lines per street"]
        D3["root-only avg equity / EV"]
        D4["per-action EV dropped"]
        D5["reach-weighted avg + 18 classes"]
    end

    S1 -->|prune| D1
    S2 -->|prune to canonical lines| D2
    S3 -->|aggregate, keep root only| D3
    S4 -->|discard| D4
    S5 -->|collapse per-combo| D5
```

**Summary:** the Solution Tree is a full per-combo, per-action game tree over all
sizes and runouts (RAM-only). The Postflop Data Tree is a size-normalized,
line-normalized, reach-weighted + hand-class–bucketed digest that ships to the
browser under `js/data/`.
