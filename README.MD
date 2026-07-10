# EDO Solver

| Directory | Description |
|-----------|-------------|
| **Postflop solver** | Contains core algorithm |
| **GTO terminal** | Solve specific spots, extract data from solving pipeline and save into solutions to reuse. Python part: lookup API for game tool |

In the below graph, arrow direction specify data flow

```mermaid
graph BT
    subgraph CORE[Solver core]
        CFR[CFR+ algorithm]
    end

    subgraph TERMINAL[Gtoterminal]
        SCR[postflop script]
        SOLVER[Solver]
    end

    subgraph DATA[Solutions]
        PREDB[(Preflop range)]
        POSTDB[(Post flop solution)]
    end

    CONFIG[[CONFIG <br> Ranges, Game Tree <br> Flop, spr]]

    subgraph TOOL[Poker tools]
    end

    PREDB --> |1. range| CONFIG
    CONFIG --> |2. input| SCR
    CONFIG -.-> |form actions| TOOL

    CORE --> |used by| SOLVER
    SOLVER --> |used by| SCR
    SCR --> |3. build| POSTDB
    POSTDB --> |4. Lookup API| TOOL

```

## Imporant files
| Files     | Description |
|-----------|-------------|
|/js/data/preflop-ranges.js or /preflop-lookup/preflop-ranges| Preflop solution |
|/scripts/preflop-to-postflop-ranges.js| Extract data from preflop solution and build input ranges for postflop solver |
|/scripts/precompute-preflop.js| Script to gather input and run solver |

**Note:** 1->2->3->4 is the path we build post flop data to look up.