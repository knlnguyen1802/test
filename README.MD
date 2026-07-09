# EDO Solver

| Directory | Description |
|-----------|-------------|
| **Postflop solver** | Chứa thuật toán solver |
| **GTO terminal** | Sử dụng thuật toán solver, nhận input, solve, chứa code extract data từ solution để sử dụng, chứa lookup API cho game client query data |

In the below graph, arrow direction specify data flow

```mermaid
graph BT
    subgraph CORE[Solver core]
        CFR[CFR+ algorithm]
    end

    subgraph TERMINAL[Gtoterminal]
        CONFIG[Config<br>1. Gametree]
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