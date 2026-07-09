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
        CONFIG[Config<br>1. Gametree<br>2. Selective boards]
        SCR[postflop script]
        SOLVER[Solver]
    end

    subgraph DATA[Solution]
        PREDB[(Preflop range)]
        POSTDB[(Post flop solution)]
    end

    subgraph TOOL[Poker tools]
    end


    CORE --> |used by| SOLVER
    SOLVER --> |used by| SCR
    PREDB --> |input| SCR
    CONFIG --> |input| SCR
    SCR --> |build| POSTDB
    DATA -----> |Lookup API| TOOL
```

## Imporant files
| Files     | Description |
|-----------|-------------|
|/scripts/precompute-preflop.js| Script to gather input and run solver |