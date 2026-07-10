# Boards: texture × height sampling & generalization

We cannot solve every flop (1,755 strategically-distinct flops × 3 bet levels ×
~15 matchups is far too many). Instead we solve a small **representative sample**
and, at query time, **generalize** any real flop to the closest solved board.

The key that decides "closest" has **two dimensions**:

1. **Texture** — the coarse structural class (pairing / suits / connectivity).
2. **Height** — the strategically dominant rank (top card, or the pair rank on
   paired boards).

> **Working assumption:** boards that share a texture *and* sit at a similar
> height play with (approximately) the same strategy. Texture alone is too
> coarse — `A72r` and `532r` are both `dry_rainbow` but play very differently —
> so height is a required second axis.

Pipeline:

```
solve sample boards  ──▶  store solution per (matchup, bet level, board)
                                        │
real flop ──▶ classify texture ──▶ candidates = boards of that texture
          ──▶ compute height anchor ──▶ nearest candidate by anchor rank
          ──▶ reuse that board's solution
```

---

## 1. Texture taxonomy — are 8 enough?

**Yes, 8 is enough** for a lookup approximation. The strategic structure of a
flop is captured by three independent axes:

| Axis | Values |
|---|---|
| Pairing | unpaired / paired (trips is negligible — folded into paired) |
| Suits | rainbow / two-tone / monotone |
| Connectivity | disconnected (dry) / connected (wet) |

The full cross-product is large, but most cells are either rare or strategically
redundant, so the practical set collapses to **8**:

| # | Texture | Definition |
|---|---|---|
| 1 | `dry_rainbow` | unpaired, 3 suits, disconnected |
| 2 | `dry_twotone` | unpaired, 2 of a suit, disconnected |
| 3 | `wet_rainbow` | unpaired, 3 suits, connected |
| 4 | `wet_twotone` | unpaired, 2 of a suit, connected |
| 5 | `monotone` | 3 of a suit (connectivity ignored — flush dominates) |
| 6 | `paired_dry` | paired, disconnected |
| 7 | `paired_wet` | paired, connected/close (straight or flush live) |
| 8 | `highly_connected` | unpaired, very connected (3-straight / one-gappers) |

Notes / deliberate simplifications:
- **Monotone** ignores connectivity — with three of a suit the flush texture
  dominates the strategy, so `KT4` vs `KQJ` monotone are treated alike.
- **`highly_connected`** is really "unpaired + extremely wet" (e.g. `JT9`,
  `KQT`, `987`). It is split out from `wet_*` because straight-heavy boards
  shift ranges hard toward the caller.
- **Trips** (e.g. `777`) is rare; it maps to `paired_*`.
- **Paired** does not split by suit (two-tone vs rainbow) — the pair, not the
  flush draw, drives strategy on most paired flops.

This matches the classifier in
[js/data/board-categories.js](js/data/board-categories.js#L5) and the mirror in
[js/solver/solver-cache.js](js/solver/solver-cache.js#L36). Exact rules:

```
if 3 same suit                              -> monotone
elif unpaired and span<=3 (or 3 in a row)   -> highly_connected
elif paired                                 -> paired_wet if span<=4 else paired_dry
elif connected (2 gaps<=2) or span<=4       -> wet_twotone / wet_rainbow
else                                        -> dry_twotone / dry_rainbow
```
(`span` = highest minus lowest rank; two-tone = exactly 2 of a suit.)

---

## 2. Height — which ranks each texture needs

Height sensitivity is **not uniform** across textures, so each texture samples a
different number of height points:

| Texture | Height sensitivity | Anchor | Height points sampled |
|---|---|---|---|
| `dry_rainbow` | **High** | top card | A, K, Q, J, low(≤8) |
| `dry_twotone` | **High** | top card | A, K, Q, J, low(≤8) |
| `wet_rainbow` | Medium | top card | Q, J, T, low(≤8) |
| `wet_twotone` | Medium | top card | Q, J, T, low(≤8) |
| `monotone` | Low | top card | A, K, low |
| `paired_dry` | Medium | **pair rank** | A, K, mid(9), low(7) |
| `paired_wet` | Medium | **pair rank** | J, T, 8, low(5) |
| `highly_connected` | Low–Med | top card | A, K, J, T, low(7) |

Rationale:
- **Dry / unpaired boards are the most height-sensitive**: the top card decides
  who "hits" the board, so the c-bet strategy swings from ~100% (ace-high) to
  range-driven (low). These get the most sample points.
- **Wet / connected boards** compress the strategic range (both players connect),
  so fewer height points are needed.
- **Paired boards anchor on the pair rank**, not the top card: `A88` plays by the
  pair of 8s, so it must match an `88x`-type board, *not* an `AAx` board.
- **Monotone / highly-connected** are dominated by the suit/straight structure,
  so height is coarse (2–3 points).

---

## 3. The board sample (34 boards)

Each cell is one solved board; a real flop routes to the cell of its texture with
the nearest anchor rank.

| Texture | A (14) | K (13) | Q (12) | J (11) | T (10) | mid | low |
|---|---|---|---|---|---|---|---|
| dry_rainbow | A72r | K83r | Q62r | J74r | — | — | 852r (8) |
| dry_twotone | A72tt | K92tt | Q74tt | J83tt | — | — | 852tt (8) |
| wet_rainbow | — | — | QT8r | J97r | T86r | — | 864r (8) |
| wet_twotone | — | — | QT8tt | J97tt | T86tt | — | 864tt (8) |
| monotone | AT6sss | KT4sss | — | — | — | — | 853sss (8) |
| paired_dry | AA8r | KK4r | — | — | — | 992r (9) | 772r (7) |
| paired_wet | — | — | — | JJ9r | TT8r | 887r (8) | 553r (5) |
| highly_connected | AKQr | KQTr | — | JT9r | T98r | — | 765r (7) |

Label legend: `r` rainbow, `tt` two-tone, `sss` monotone. Paired labels carry the
pair rank first (`AA8r`, `JJ9r`). Anchor rank in parentheses where not the label
letter.

---

## 4. Generalization algorithm

For a real flop `B` in matchup `M` at bet level `L`:

1. **Classify texture** `t = classify(B)` (rules in §1).
2. **Candidates** `C = TEXTURE_BOARDS[t]` — the solved boards of that texture.
   - If `C` is empty (should not happen — all 8 are covered), fall back to the
     nearest sibling texture: `paired_wet→paired_dry`, `wet_twotone→wet_rainbow`,
     `dry_twotone→dry_rainbow`, `highly_connected→wet_rainbow`,
     `monotone→wet_twotone`.
3. **Anchor rank** `a = anchor(B)`:
   - paired texture → the rank of the pair,
   - otherwise → the highest card rank.
4. **Pick nearest** candidate `c ∈ C` minimizing `|anchor(c) − a|`; ties break
   toward the higher board.
5. **Return** the stored solution for `(M, L, c)`.

This is implemented in
[js/solver/solver-cache.js](js/solver/solver-cache.js#L136) (`findClosestBoard`)
and the sample lives in
[scripts/postflop_config/flop-boards.mjs](scripts/postflop_config/flop-boards.mjs).

---

## 5. Assumptions & caveats

- **Same texture + similar height ≈ same strategy.** True to first order; the
  residual error grows with the anchor-rank gap, so keeping ≥1 sample per
  meaningful height bucket (above) bounds it.
- **Suit specifics are ignored within a texture** (e.g. which two cards are
  suited on a two-tone board). Postflop strategy is near-symmetric across suits,
  so this is safe.
- **Kickers on unpaired boards are ignored** beyond the top card. `A72r` stands
  in for `AK3r`-type dry aces even though the second card differs; the top card
  is the dominant driver.
- **Paired-board kicker height is not sampled** (only the pair rank). `A88` and
  `988` both route to the `88x` bucket; acceptable for a lookup, refine later if
  needed.
- **Cost:** 34 boards × 3 bet levels × ~15 matchups ≈ ~1.5k solves for a full
  build. Filter with `--board` / `--matchup` for incremental runs.
