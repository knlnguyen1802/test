// GTOTerminal — Native Postflop Solver
// Based on postflop-solver by Wataru Inariba (AGPL-3.0)
//
// This is the NATIVE counterpart of solver/src/lib.rs (the WASM build). It runs
// the exact same postflop-solver engine but uses the system allocator, so it is
// not bound by the 4 GiB wasm32 address-space limit and can use all host RAM.
//
// Protocol: reads a single JSON config object from stdin, solves the spot,
// extracts the same tree nodes the Node child extracts, and prints ONE line of
// JSON to stdout with the identical shape the WASM child produces. Diagnostics
// go to stderr.
#![allow(clippy::needless_range_loop)]

use postflop_solver::*;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::io::Read;

// ===========================================================================
// GameManager — ported from solver/src/lib.rs (WASM), minus wasm-bindgen.
// ===========================================================================
struct GameManager {
    game: PostFlopGame,
}

#[inline]
fn round(value: f64) -> f64 {
    if value < 1.0 {
        (value * 1_000_000.0).round() / 1_000_000.0
    } else if value < 10.0 {
        (value * 100_000.0).round() / 100_000.0
    } else if value < 100.0 {
        (value * 10_000.0).round() / 10_000.0
    } else if value < 1000.0 {
        (value * 1_000.0).round() / 1_000.0
    } else if value < 10000.0 {
        (value * 100.0).round() / 100.0
    } else {
        (value * 10.0).round() / 10.0
    }
}

#[inline]
fn round_iter<'a>(iter: impl Iterator<Item = &'a f32> + 'a) -> impl Iterator<Item = f64> + 'a {
    iter.map(|&x| round(x as f64))
}

impl GameManager {
    fn new() -> Self {
        Self {
            game: PostFlopGame::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn init(
        &mut self,
        oop_range: &[f32],
        ip_range: &[f32],
        board: &[u8],
        starting_pot: i32,
        effective_stack: i32,
        donk_option: bool,
        oop_flop_bet: &str,
        oop_flop_raise: &str,
        oop_turn_bet: &str,
        oop_turn_raise: &str,
        oop_turn_donk: &str,
        oop_river_bet: &str,
        oop_river_raise: &str,
        oop_river_donk: &str,
        ip_flop_bet: &str,
        ip_flop_raise: &str,
        ip_turn_bet: &str,
        ip_turn_raise: &str,
        ip_river_bet: &str,
        ip_river_raise: &str,
    ) -> Option<String> {
        let (turn, river, state) = match board.len() {
            3 => (NOT_DEALT, NOT_DEALT, BoardState::Flop),
            4 => (board[3], NOT_DEALT, BoardState::Turn),
            5 => (board[3], board[4], BoardState::River),
            _ => return Some("Invalid board length".to_string()),
        };

        let oop = match Range::from_raw_data(oop_range) {
            Ok(r) => r,
            Err(e) => return Some(format!("Bad OOP range: {e}")),
        };
        let ip = match Range::from_raw_data(ip_range) {
            Ok(r) => r,
            Err(e) => return Some(format!("Bad IP range: {e}")),
        };

        let card_config = CardConfig {
            range: [oop, ip],
            flop: match board[..3].try_into() {
                Ok(f) => f,
                Err(_) => return Some("Bad flop".to_string()),
            },
            turn,
            river,
        };

        let mk = |b: &str, r: &str| BetSizeOptions::try_from((b, r));
        let tree_config = TreeConfig {
            initial_state: state,
            starting_pot,
            effective_stack,
            rake_rate: 0.0,
            rake_cap: 0.0,
            flop_bet_sizes: [
                mk(oop_flop_bet, oop_flop_raise).map_err(|e| e.to_string()).ok()?,
                mk(ip_flop_bet, ip_flop_raise).map_err(|e| e.to_string()).ok()?,
            ],
            turn_bet_sizes: [
                mk(oop_turn_bet, oop_turn_raise).map_err(|e| e.to_string()).ok()?,
                mk(ip_turn_bet, ip_turn_raise).map_err(|e| e.to_string()).ok()?,
            ],
            river_bet_sizes: [
                mk(oop_river_bet, oop_river_raise).map_err(|e| e.to_string()).ok()?,
                mk(ip_river_bet, ip_river_raise).map_err(|e| e.to_string()).ok()?,
            ],
            turn_donk_sizes: match donk_option {
                false => None,
                true => DonkSizeOptions::try_from(oop_turn_donk).ok(),
            },
            river_donk_sizes: match donk_option {
                false => None,
                true => DonkSizeOptions::try_from(oop_river_donk).ok(),
            },
            add_allin_threshold: 1.5,
            force_allin_threshold: 0.15,
            merging_threshold: 0.1,
        };

        let action_tree = match ActionTree::new(tree_config) {
            Ok(t) => t,
            Err(e) => return Some(format!("Bad action tree: {e}")),
        };

        self.game.update_config(card_config, action_tree).err()
    }

    fn private_len(&self, player: usize) -> usize {
        self.game.private_cards(player).len()
    }

    fn private_cards_packed(&self, player: usize) -> Vec<u16> {
        self.game
            .private_cards(player)
            .iter()
            .map(|&(c1, c2)| c1 as u16 | ((c2 as u16) << 8))
            .collect()
    }

    /// Private hole-card pairs for a player, in the same order as weights /
    /// strategy indexing. Used to bucket combos into hand-strength classes.
    fn private_pairs(&self, player: usize) -> Vec<(u8, u8)> {
        self.game.private_cards(player).to_vec()
    }

    fn memory_usage(&self, enable_compression: bool) -> u64 {
        if !enable_compression {
            self.game.memory_usage().0
        } else {
            self.game.memory_usage().1
        }
    }

    fn allocate_memory(&mut self, enable_compression: bool) {
        self.game.allocate_memory(enable_compression);
    }

    fn solve_step(&self, current_iteration: u32) {
        solve_step(&self.game, current_iteration);
    }

    fn exploitability(&self) -> f32 {
        compute_exploitability(&self.game)
    }

    fn finalize(&mut self) {
        finalize(&mut self.game);
    }

    fn apply_history(&mut self, history: &[usize]) {
        self.game.apply_history(history);
    }

    fn current_player(&self) -> &'static str {
        if self.game.is_terminal_node() {
            "terminal"
        } else if self.game.is_chance_node() {
            "chance"
        } else if self.game.current_player() == 0 {
            "oop"
        } else {
            "ip"
        }
    }

    fn num_actions(&self) -> usize {
        self.game.available_actions().len()
    }

    fn actions(&self) -> String {
        if self.game.is_terminal_node() {
            "terminal".to_string()
        } else if self.game.is_chance_node() {
            "chance".to_string()
        } else {
            self.game
                .available_actions()
                .iter()
                .map(|&x| match x {
                    Action::Fold => "Fold:0".to_string(),
                    Action::Check => "Check:0".to_string(),
                    Action::Call => "Call:0".to_string(),
                    Action::Bet(amount) => format!("Bet:{amount}"),
                    Action::Raise(amount) => format!("Raise:{amount}"),
                    Action::AllIn(amount) => format!("Allin:{amount}"),
                    _ => unreachable!(),
                })
                .collect::<Vec<_>>()
                .join("/")
        }
    }

    /// Packed results array — identical layout to the WASM build's get_results.
    fn get_results(&mut self) -> Vec<f64> {
        let game = &mut self.game;
        let mut buf: Vec<f64> = Vec::new();

        let total_bet_amount = game.total_bet_amount();
        let pot_base = game.tree_config().starting_pot + total_bet_amount.iter().min().unwrap();

        buf.push((pot_base + total_bet_amount[0]) as f64);
        buf.push((pot_base + total_bet_amount[1]) as f64);

        let trunc = |&w: &f32| if w < 0.0005 { 0.0 } else { w };
        let weights = [
            game.weights(0).iter().map(trunc).collect::<Vec<_>>(),
            game.weights(1).iter().map(trunc).collect::<Vec<_>>(),
        ];

        let is_empty = |player: usize| weights[player].iter().all(|&w| w == 0.0);
        let is_empty_flag = is_empty(0) as usize + 2 * is_empty(1) as usize;
        buf.push(is_empty_flag as f64);

        buf.extend(round_iter(weights[0].iter()));
        buf.extend(round_iter(weights[1].iter()));

        if is_empty_flag > 0 {
            buf.extend(round_iter(weights[0].iter()));
            buf.extend(round_iter(weights[1].iter()));
        } else {
            game.cache_normalized_weights();

            buf.extend(round_iter(game.normalized_weights(0).iter()));
            buf.extend(round_iter(game.normalized_weights(1).iter()));

            let equity = [game.equity(0), game.equity(1)];
            let ev = [game.expected_values(0), game.expected_values(1)];

            buf.extend(round_iter(equity[0].iter()));
            buf.extend(round_iter(equity[1].iter()));
            buf.extend(round_iter(ev[0].iter()));
            buf.extend(round_iter(ev[1].iter()));

            for player in 0..2 {
                let pot = (pot_base + total_bet_amount[player]) as f64;
                for (&eq, &ev) in equity[player].iter().zip(ev[player].iter()) {
                    let (eq, ev) = (eq as f64, ev as f64);
                    if eq < 5e-7 {
                        buf.push(ev / 0.0);
                    } else {
                        buf.push(round(ev / (pot * eq)));
                    }
                }
            }
        }

        if !game.is_terminal_node() && !game.is_chance_node() {
            buf.extend(round_iter(game.strategy().iter()));
            if is_empty_flag == 0 {
                buf.extend(round_iter(
                    game.expected_values_detail(game.current_player()).iter(),
                ));
            }
        }

        buf
    }
}

// ===========================================================================
// Card / range utilities — ported from scripts/precompute-postflop.mjs.
// ===========================================================================
const RANKS: &[u8] = b"23456789TJQKA";
const SUITS: &[u8] = b"cdhs";

fn rank_index(c: u8) -> usize {
    RANKS.iter().position(|&x| x == c).unwrap()
}
fn suit_index(c: u8) -> usize {
    SUITS.iter().position(|&x| x == c).unwrap()
}
fn card_id(rank: u8, suit: u8) -> u8 {
    (4 * rank_index(rank) + suit_index(suit)) as u8
}
fn index_to_card(idx: u8) -> String {
    let r = RANKS[(idx / 4) as usize] as char;
    let s = SUITS[(idx % 4) as usize] as char;
    format!("{r}{s}")
}
fn card_pair_index(mut c1: usize, mut c2: usize) -> usize {
    if c1 > c2 {
        std::mem::swap(&mut c1, &mut c2);
    }
    c1 * (101 - c1) / 2 + c2 - 1
}
#[allow(dead_code)]
fn possible_cards(board: &[String]) -> Vec<u8> {
    let set: std::collections::HashSet<u8> = board
        .iter()
        .map(|c| {
            let b = c.as_bytes();
            card_id(b[0], b[1])
        })
        .collect();
    (0u8..52).filter(|c| !set.contains(c)).collect()
}

fn set_hand_weight(range: &mut [f32; 1326], hand: &str, weight: f32) {
    let h = hand.as_bytes();
    if h.len() == 2 && h[0] == h[1] {
        let r = rank_index(h[0]);
        for s1 in 0..4 {
            for s2 in (s1 + 1)..4 {
                range[card_pair_index(4 * r + s1, 4 * r + s2)] = weight;
            }
        }
    } else if h.len() == 3 && h[2] == b's' {
        let r1 = rank_index(h[0]);
        let r2 = rank_index(h[1]);
        for s in 0..4 {
            range[card_pair_index(4 * r1 + s, 4 * r2 + s)] = weight;
        }
    } else if h.len() == 3 && h[2] == b'o' {
        let r1 = rank_index(h[0]);
        let r2 = rank_index(h[1]);
        for s1 in 0..4 {
            for s2 in 0..4 {
                if s1 == s2 {
                    continue;
                }
                range[card_pair_index(4 * r1 + s1, 4 * r2 + s2)] = weight;
            }
        }
    } else if h.len() == 2 && h[0] != h[1] {
        let r1 = rank_index(h[0]);
        let r2 = rank_index(h[1]);
        for s1 in 0..4 {
            for s2 in 0..4 {
                let c1 = 4 * r1 + s1;
                let c2 = 4 * r2 + s2;
                if c1 != c2 {
                    range[card_pair_index(c1, c2)] = weight;
                }
            }
        }
    }
}

fn expand_range(start: &str, end: &str) -> Vec<String> {
    let mut hands = Vec::new();
    let (sb, eb) = (start.as_bytes(), end.as_bytes());
    if sb.len() == 2 && sb[0] == sb[1] && eb.len() == 2 && eb[0] == eb[1] {
        let r1 = rank_index(sb[0]);
        let r2 = rank_index(eb[0]);
        for r in r1.min(r2)..=r1.max(r2) {
            let c = RANKS[r] as char;
            hands.push(format!("{c}{c}"));
        }
    } else if sb.len() == 3 && sb[2] == b's' && eb.len() == 3 && eb[2] == b's' {
        let high = RANKS[rank_index(sb[0])] as char;
        let r1 = rank_index(sb[1]);
        let r2 = rank_index(eb[1]);
        for r in r1.min(r2)..=r1.max(r2) {
            let c = RANKS[r] as char;
            hands.push(format!("{high}{c}s"));
        }
    } else if sb.len() == 3 && sb[2] == b'o' && eb.len() == 3 && eb[2] == b'o' {
        let high = RANKS[rank_index(sb[0])] as char;
        let r1 = rank_index(sb[1]);
        let r2 = rank_index(eb[1]);
        for r in r1.min(r2)..=r1.max(r2) {
            let c = RANKS[r] as char;
            hands.push(format!("{high}{c}o"));
        }
    }
    hands
}

fn parse_range(text: &str) -> [f32; 1326] {
    let mut range = [0.0f32; 1326];
    if text.trim().is_empty() {
        return range;
    }
    for raw in text.split(',') {
        let part = raw.trim();
        if part.is_empty() {
            continue;
        }
        let (body, weight) = match part.find(':') {
            Some(colon) => (&part[..colon], part[colon + 1..].parse().unwrap_or(1.0f32)),
            None => (part, 1.0f32),
        };
        if let Some(dash) = body.find('-') {
            let s = &body[..dash];
            let e = &body[dash + 1..];
            for h in expand_range(s, e) {
                set_hand_weight(&mut range, &h, weight);
            }
            continue;
        }
        set_hand_weight(&mut range, body, weight);
    }
    range
}

// ===========================================================================
// Config (stdin JSON)
// ===========================================================================
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BetSizes {
    oop_flop_bet: String,
    oop_flop_raise: String,
    oop_turn_bet: String,
    oop_turn_raise: String,
    oop_turn_donk: String,
    oop_river_bet: String,
    oop_river_raise: String,
    oop_river_donk: String,
    ip_flop_bet: String,
    ip_flop_raise: String,
    ip_turn_bet: String,
    ip_turn_raise: String,
    ip_river_bet: String,
    ip_river_raise: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    oop_range: String,
    ip_range: String,
    board: Vec<String>,
    pot: i32,
    stack: i32,
    #[serde(default)]
    donk_option: bool,
    bet_sizes: BetSizes,
    iterations: u32,
    target: f64,
}

// ===========================================================================
// Tree navigation + node extraction (ported from the Node child)
// ===========================================================================
struct NodeStrat {
    actions: String,
    player: String,
    num_actions: usize,
    strategy: Vec<f64>,
    by_class: Option<Map<String, Value>>,
}

/// Navigate to `hist` from the root, validating each step. Returns true and
/// leaves the manager positioned at the node; false if the path is invalid
/// (out-of-range index or a terminal node reached early).
///
/// The underlying postflop-solver panics (rather than returning an error) on an
/// "Invalid action" during `apply_history` — e.g. a chance/action line that does
/// not exist in this particular solved tree. The JS extractor guards the same
/// navigation with try/catch and simply skips such lines; we mirror that here by
/// catching the unwind. Recovery is safe because the next navigation begins with
/// `apply_history(&[])`, which resets the game back to the root before replaying.
fn nav(mgr: &mut GameManager, hist: &[usize]) -> bool {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        mgr.apply_history(&[]);
        for k in 0..hist.len() {
            if mgr.current_player() == "terminal" {
                return false;
            }
            let n = mgr.num_actions();
            if hist[k] >= n {
                return false;
            }
            mgr.apply_history(&hist[..=k]);
        }
        true
    }));
    match result {
        Ok(valid) => valid,
        Err(_) => {
            // Invalid line for this solved tree — skip it. Reset to root so the
            // next navigation starts from a known-good state.
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                mgr.apply_history(&[]);
            }));
            false
        }
    }
}

fn aggregate_strategy(res: &[f64], player: &str, oop_len: usize, ip_len: usize, num_actions: usize) -> Vec<f64> {
    let mut off = 2usize; // pots
    let is_empty = res[off] as i64;
    off += 1;
    let oop_w = &res[off..off + oop_len];
    off += oop_len;
    let ip_w = &res[off..off + ip_len];
    off += ip_len;
    off += oop_len + ip_len; // normalized weights
    if is_empty == 0 {
        off += (oop_len + ip_len) * 3; // equity, ev, eqr
    }
    let (active_len, active_w): (usize, &[f64]) = if player == "oop" {
        (oop_len, oop_w)
    } else {
        (ip_len, ip_w)
    };
    let strat = &res[off..off + num_actions * active_len];
    let total_w: f64 = active_w.iter().sum();
    let mut agg = Vec::with_capacity(num_actions);
    for a in 0..num_actions {
        let mut sum = 0.0;
        for c in 0..active_len {
            sum += strat[a * active_len + c] * active_w[c];
        }
        agg.push(if total_w > 0.0 {
            (sum / total_w * 1000.0).round() / 1000.0
        } else {
            0.0
        });
    }
    agg
}

// ---------------------------------------------------------------------------
// Hand-strength classification — port of BoardCategories.classify_hand_strength
// (python/gto_advisor.py / js/data/board-categories.js). Buckets a single combo
// on a given board into one of the 18 hand-strength classes so the extractor can
// emit a per-class strategy instead of only a range-wide average.
// ---------------------------------------------------------------------------
#[inline]
fn rank_val(card: u8) -> i32 {
    (card / 4) as i32 + 2 // 2..=14 (A)
}
#[inline]
fn suit_of(card: u8) -> u8 {
    card % 4
}

fn has_straight(all_ranks: &[i32], hole_ranks: &[i32]) -> bool {
    let mut unique: Vec<i32> = all_ranks.to_vec();
    unique.sort_unstable();
    unique.dedup();
    if unique.contains(&14) {
        let mut u = vec![1];
        u.extend_from_slice(&unique);
        unique = u;
    }
    for i in 0..unique.len().saturating_sub(4) {
        let w = &unique[i..i + 5];
        if w[4] - w[0] == 4 && (0..4).all(|j| w[j + 1] - w[j] == 1) {
            if hole_ranks
                .iter()
                .any(|&h| w.contains(&h) || (h == 14 && w.contains(&1)))
            {
                return true;
            }
        }
    }
    false
}

/// Returns (has_oesd, has_gutshot).
fn straight_draw_info(all_ranks: &[i32], hole_ranks: &[i32]) -> (bool, bool) {
    let mut unique: Vec<i32> = all_ranks.to_vec();
    unique.sort_unstable();
    unique.dedup();
    if unique.contains(&14) {
        let mut u = vec![1];
        u.extend_from_slice(&unique);
        unique = u;
    }
    let mut oesd = false;
    let mut gut = false;
    for i in 0..unique.len().saturating_sub(3) {
        let w4 = &unique[i..i + 4];
        let span = w4[3] - w4[0];
        let uses = hole_ranks
            .iter()
            .any(|&h| w4.contains(&h) || (h == 14 && w4.contains(&1)));
        if span == 3 && (0..3).all(|j| w4[j + 1] - w4[j] == 1) && uses {
            if w4[0] > 1 && w4[3] < 14 {
                oesd = true;
            } else {
                gut = true;
            }
        } else if span == 4 && !oesd && uses {
            let gaps = (0..3).filter(|&j| w4[j + 1] - w4[j] == 2).count();
            let over = (0..3).filter(|&j| w4[j + 1] - w4[j] > 2).count();
            if gaps == 1 && over == 0 {
                gut = true;
            }
        }
    }
    (oesd, gut && !oesd)
}

fn classify_hand_strength(hole: (u8, u8), board: &[u8]) -> &'static str {
    if board.len() < 3 {
        return "air";
    }
    let hr = [rank_val(hole.0), rank_val(hole.1)];
    let br: Vec<i32> = board.iter().map(|&c| rank_val(c)).collect();
    let hs = [suit_of(hole.0), suit_of(hole.1)];

    let mut ar = vec![hr[0], hr[1]];
    ar.extend_from_slice(&br);

    let bmax = *br.iter().max().unwrap();
    let mut bsrt = br.clone();
    bsrt.sort_unstable_by(|a, b| b.cmp(a)); // descending

    // Suit counts over all cards.
    let mut sc = [0i32; 4];
    for &c in board.iter() {
        sc[suit_of(c) as usize] += 1;
    }
    sc[hs[0] as usize] += 1;
    sc[hs[1] as usize] += 1;

    let has_flush = (0..4).any(|s| sc[s] >= 5 && hs.contains(&(s as u8)));
    let straight = has_straight(&ar, &hr);

    // Rank counts.
    let mut arc: std::collections::HashMap<i32, i32> = std::collections::HashMap::new();
    for &r in &ar {
        *arc.entry(r).or_insert(0) += 1;
    }
    let mut brc: std::collections::HashMap<i32, i32> = std::collections::HashMap::new();
    for &r in &br {
        *brc.entry(r).or_insert(0) += 1;
    }
    let is_pp = hr[0] == hr[1];

    // Full house.
    let trips_r: Vec<i32> = arc.iter().filter(|(_, &c)| c >= 3).map(|(&r, _)| r).collect();
    let pairs_r: Vec<i32> = arc.iter().filter(|(_, &c)| c >= 2).map(|(&r, _)| r).collect();
    let mut fh = false;
    if !trips_r.is_empty() && pairs_r.len() >= 2 {
        if hr.iter().any(|h| trips_r.contains(h) || pairs_r.contains(h)) {
            fh = true;
        }
    }
    if trips_r.len() >= 2 {
        fh = true;
    }
    if fh {
        return "full_house";
    }
    if has_flush {
        return "flush";
    }
    if straight {
        return "straight";
    }

    // Set.
    if is_pp && br.contains(&hr[0]) {
        return "set";
    }
    // Trips (using a board pair).
    if hr.iter().any(|h| brc.get(h).copied().unwrap_or(0) >= 2) {
        return "trips";
    }

    // Two pair.
    let paired_r: Vec<i32> = hr.iter().cloned().filter(|h| br.contains(h)).collect();
    let p_count = paired_r.len();
    if p_count >= 2 {
        return "two_pair";
    }
    if is_pp && p_count >= 1 && !paired_r.contains(&hr[0]) {
        return "two_pair";
    }

    // Made pairs.
    if is_pp && hr[0] > bmax {
        return "overpair";
    }
    if p_count >= 1 {
        let pr = paired_r[0];
        if pr == bmax {
            let kicker = if hr[0] == pr { hr[1] } else { hr[0] };
            return if kicker >= 11 { "top_pair_strong" } else { "top_pair_weak" };
        }
        if bsrt.len() >= 2 && pr == bsrt[1] {
            return "second_pair";
        }
        return "weak_pair";
    }
    if is_pp && hr[0] < *br.iter().min().unwrap() {
        return "underpair";
    }
    if is_pp {
        return "weak_pair";
    }

    // Draws.
    let has_fd = (0..4).any(|s| sc[s] == 4 && hs.contains(&(s as u8)));
    let (has_oesd, has_gutshot) = straight_draw_info(&ar, &hr);
    if has_fd && (has_oesd || has_gutshot) {
        return "combo_draw";
    }
    if has_fd || has_oesd {
        return "oesd_or_fd";
    }
    if has_gutshot {
        return "gutshot";
    }

    // Backdoor flush (flop only).
    if board.len() == 3 && (0..4).any(|s| sc[s] == 3 && hs.contains(&(s as u8))) {
        return "weak_draw";
    }

    // Overcards vs air.
    if hr[0] > bmax && hr[1] > bmax {
        return "overcards";
    }
    "air"
}

/// Reach-weighted strategy split by hand-strength class. Returns a map of
/// class -> per-action frequency vector. Combos are bucketed by
/// classify_hand_strength against `board`, then averaged within each bucket.
fn strategy_by_class(
    res: &[f64],
    player: &str,
    oop_len: usize,
    ip_len: usize,
    num_actions: usize,
    active_pairs: &[(u8, u8)],
    board: &[u8],
) -> Map<String, Value> {
    let mut off = 2usize; // pots
    let is_empty = res[off] as i64;
    off += 1;
    let oop_w = &res[off..off + oop_len];
    off += oop_len;
    let ip_w = &res[off..off + ip_len];
    off += ip_len;
    off += oop_len + ip_len; // normalized weights
    if is_empty == 0 {
        off += (oop_len + ip_len) * 3; // equity, ev, eqr
    }
    let (active_len, active_w): (usize, &[f64]) = if player == "oop" {
        (oop_len, oop_w)
    } else {
        (ip_len, ip_w)
    };
    let strat = &res[off..off + num_actions * active_len];

    let mut class_w: std::collections::HashMap<&'static str, f64> = std::collections::HashMap::new();
    let mut class_sum: std::collections::HashMap<&'static str, Vec<f64>> =
        std::collections::HashMap::new();
    for c in 0..active_len.min(active_pairs.len()) {
        let w = active_w[c];
        if w <= 0.0 {
            continue;
        }
        let cls = classify_hand_strength(active_pairs[c], board);
        *class_w.entry(cls).or_insert(0.0) += w;
        let entry = class_sum.entry(cls).or_insert_with(|| vec![0.0; num_actions]);
        for a in 0..num_actions {
            entry[a] += strat[a * active_len + c] * w;
        }
    }

    let mut map = Map::new();
    for (cls, sums) in class_sum {
        let tw = class_w[cls];
        if tw <= 0.0 {
            continue;
        }
        let freqs: Vec<f64> = sums
            .iter()
            .map(|s| (s / tw * 1000.0).round() / 1000.0)
            .collect();
        map.insert(cls.to_string(), json!(freqs));
    }
    map
}

fn node_strategy(mgr: &mut GameManager, hist: &[usize], oop_len: usize, ip_len: usize, class_board: Option<&[u8]>) -> Option<NodeStrat> {
    if !nav(mgr, hist) {
        return None;
    }
    let player = mgr.current_player().to_string();
    if player == "terminal" || player == "chance" {
        return None;
    }
    let num_actions = mgr.num_actions();
    let actions = mgr.actions();
    let res = mgr.get_results();
    let strategy = aggregate_strategy(&res, &player, oop_len, ip_len, num_actions);
    let by_class = class_board.map(|bd| {
        let pidx = if player == "oop" { 0 } else { 1 };
        let pairs = mgr.private_pairs(pidx);
        strategy_by_class(&res, &player, oop_len, ip_len, num_actions, &pairs, bd)
    });
    Some(NodeStrat {
        actions,
        player,
        num_actions,
        strategy,
        by_class,
    })
}

/// Verify a history reaches a chance node.
/// NOTE: Do NOT compare num_actions() with the raw card count — the solver
/// applies suit isomorphism at turn/river chance nodes, grouping cards whose
/// suits are indistinguishable given the board and ranges. Two-tone and
/// monotone boards have fewer chance actions than the naive 49/48 count.
fn chance_at(mgr: &mut GameManager, hist: &[usize]) -> bool {
    if !nav(mgr, hist) {
        return false;
    }
    mgr.current_player() == "chance"
}

// ---------------------------------------------------------------------------
// Suit isomorphism helpers — replicate the solver's isomorphic chance logic
// so we can map each real turn/river card to the correct chance-node action
// index. Without this, two-tone and monotone boards silently skip all turn
// and river extraction (the chance node has fewer actions than naive count).
// ---------------------------------------------------------------------------

/// Bitmask of ranks present per suit (index = suit, bit = rank).
fn build_rankset(cards: &[u8]) -> [u32; 4] {
    let mut rs = [0u32; 4];
    for &c in cards {
        rs[(c & 3) as usize] |= 1u32 << (c >> 2);
    }
    rs
}

/// Determine which suits are isomorphic given a rankset.
/// Returns [None; 4] where Some(s) means "this suit maps to suit s".
fn compute_isomorphic_suits(rankset: &[u32; 4]) -> [Option<u8>; 4] {
    let mut map = [None; 4];
    for s1 in 1u8..4 {
        for s2 in 0..s1 {
            if rankset[s1 as usize] == rankset[s2 as usize] {
                map[s1 as usize] = Some(s2);
                break;
            }
        }
    }
    map
}

/// Map every legal card (not in `board_ids`) to its isomorphic group index.
#[allow(dead_code)]
struct CardIsomorphism {
    /// card_id (0..52) → group index
    card_to_group: Vec<Option<usize>>,
    /// group index → representative card_id
    group_to_card: Vec<u8>,
    num_groups: usize,
}

fn compute_card_isomorphism(board_ids: &[u8], isomorphic_suits: &[Option<u8>; 4]) -> CardIsomorphism {
    let board_set: std::collections::HashSet<u8> = board_ids.iter().copied().collect();
    let mut card_to_group: Vec<Option<usize>> = vec![None; 52];
    let mut group_to_card = Vec::new();
    let mut counter: usize = 0;

    for c in 0u8..52 {
        if board_set.contains(&c) { continue; }
        let suit = c & 3;
        let mut group: Option<usize> = None;
        if let Some(mapped_suit) = isomorphic_suits[suit as usize] {
            let mapped_card = c - suit + mapped_suit;
            if !board_set.contains(&mapped_card) {
                group = card_to_group[mapped_card as usize];
            }
        }
        let g = group.unwrap_or_else(|| {
            let g = counter;
            counter += 1;
            g
        });
        card_to_group[c as usize] = Some(g);
        if g >= group_to_card.len() {
            group_to_card.push(c);
        }
    }

    CardIsomorphism { card_to_group, group_to_card, num_groups: counter }
}

struct StreetNodes {
    strategies: [Option<Vec<f64>>; 10],
    actions: [Option<String>; 10],
    by_class: [Option<Map<String, Value>>; 10],
}

/// [0] OOP first to act, [1] IP after OOP check,
/// [2] IP facing OOP bet SMALL ([1]), [3] OOP facing IP probe SMALL ([0,1]),
/// [4] OOP facing raise after betting small  ([1,2]),
/// [5] OOP facing raise after betting large  ([2,2]),
/// [6] IP facing check-raise after betting small ([0,1,2]),
/// [7] IP facing check-raise after betting large ([0,2,2]),
/// [8] IP facing OOP bet LARGE ([2]), [9] OOP facing IP probe LARGE ([0,2]).
/// When `class_board` is Some, per-hand-class strategies are computed for each
/// decision using that board (3 cards on flop, 4 on turn, 5 on river).
/// A semantic action selector. It resolves to a concrete child index at a node
/// by inspecting that node's *live* available actions, rather than assuming a
/// fixed positional index. This keeps extraction correct when the solver's tree
/// changes shape (all-in insertion via `add_allin_threshold`/`force_allin_threshold`,
/// or bet-size merging via `merging_threshold`) at low SPR — e.g. 3bet / 4bet pots.
#[derive(Clone, Copy, PartialEq)]
enum Sel {
    Check,
    Call,
    BetSmall,
    BetLarge,
    Raise,
}

/// Parse an actions string ("Check:0/Bet:33/Bet:75") into (label, amount) pairs,
/// in the same order as the node's `available_actions()` (= strategy indexing).
fn parse_action_labels(actions: &str) -> Vec<(String, f64)> {
    actions
        .split('/')
        .filter_map(|tok| {
            let mut it = tok.splitn(2, ':');
            let label = it.next()?.to_string();
            let amt = it.next().and_then(|a| a.parse::<f64>().ok()).unwrap_or(0.0);
            Some((label, amt))
        })
        .collect()
}

/// Resolve one selector against a node's parsed actions → child index.
/// Aggressive first actions are `Bet`; if a size was forced all-in the tree has
/// `Allin` instead, so we fall back to it. When only one bet size survives,
/// `BetSmall` and `BetLarge` collapse to the same node (honest: no distinct size).
fn resolve_sel(acts: &[(String, f64)], sel: Sel) -> Option<usize> {
    let pos = |label: &str| acts.iter().position(|(l, _)| l == label);
    let allin = || pos("Allin");
    // All `Bet` actions with their amounts, sorted ascending by amount.
    let bets: Vec<(usize, f64)> = {
        let mut v: Vec<(usize, f64)> = acts
            .iter()
            .enumerate()
            .filter(|(_, (l, _))| l == "Bet")
            .map(|(i, (_, a))| (i, *a))
            .collect();
        v.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        v
    };
    match sel {
        Sel::Check => pos("Check"),
        Sel::Call => pos("Call"),
        Sel::BetSmall => bets.first().map(|(i, _)| *i).or_else(allin),
        Sel::BetLarge => {
            if bets.len() >= 2 {
                bets.last().map(|(i, _)| *i)
            } else if bets.len() == 1 {
                // The large size may have been forced all-in (larger than the
                // one surviving bet). Otherwise collapse to that single bet.
                match allin() {
                    Some(ai) if acts[ai].1 > bets[0].1 => Some(ai),
                    _ => Some(bets[0].0),
                }
            } else {
                allin()
            }
        }
        Sel::Raise => pos("Raise").or_else(allin),
    }
}

/// Walk a sequence of semantic selectors from `base`, reading each node's live
/// actions to resolve the next concrete index. Returns the full index history,
/// or None if any step can't be resolved / the line doesn't exist in this tree.
fn resolve_path(mgr: &mut GameManager, base: &[usize], sels: &[Sel]) -> Option<Vec<usize>> {
    let mut hist = base.to_vec();
    for &sel in sels {
        if !nav(mgr, &hist) {
            return None;
        }
        let player = mgr.current_player();
        if player == "terminal" || player == "chance" {
            return None;
        }
        let acts = parse_action_labels(&mgr.actions());
        let idx = resolve_sel(&acts, sel)?;
        hist.push(idx);
    }
    Some(hist)
}

fn extract_street_nodes(mgr: &mut GameManager, base: &[usize], oop_len: usize, ip_len: usize, class_board: Option<&[u8]>) -> Option<StreetNodes> {
    let oop = node_strategy(mgr, base, oop_len, ip_len, class_board)?;

    // Address every decision node by a sequence of action selectors relative to
    // `base`, resolving each hop against the node's live action list.
    let get = |mgr: &mut GameManager, sels: &[Sel]| -> Option<NodeStrat> {
        let hist = resolve_path(mgr, base, sels)?;
        node_strategy(mgr, &hist, oop_len, ip_len, class_board)
    };

    let ip = get(mgr, &[Sel::Check]);
    // Facing the SMALL bet (villain's first sizing).
    let ip_fb = get(mgr, &[Sel::BetSmall]);
    let oop_fp = get(mgr, &[Sel::Check, Sel::BetSmall]);
    // Facing a raise, split by hero's OWN bet size that got raised.
    let oop_fr_small = get(mgr, &[Sel::BetSmall, Sel::Raise]);
    let oop_fr_large = get(mgr, &[Sel::BetLarge, Sel::Raise]);
    let ip_fr_small = get(mgr, &[Sel::Check, Sel::BetSmall, Sel::Raise]);
    let ip_fr_large = get(mgr, &[Sel::Check, Sel::BetLarge, Sel::Raise]);
    // Facing the LARGE bet (villain's second sizing).
    let ip_fb_large = get(mgr, &[Sel::BetLarge]);
    let oop_fp_large = get(mgr, &[Sel::Check, Sel::BetLarge]);

    let oop_bc = oop.by_class.clone();
    let ip_bc = ip.as_ref().and_then(|n| n.by_class.clone());
    let ip_fb_bc = ip_fb.as_ref().and_then(|n| n.by_class.clone());
    let oop_fp_bc = oop_fp.as_ref().and_then(|n| n.by_class.clone());
    let oop_fr_small_bc = oop_fr_small.as_ref().and_then(|n| n.by_class.clone());
    let oop_fr_large_bc = oop_fr_large.as_ref().and_then(|n| n.by_class.clone());
    let ip_fr_small_bc = ip_fr_small.as_ref().and_then(|n| n.by_class.clone());
    let ip_fr_large_bc = ip_fr_large.as_ref().and_then(|n| n.by_class.clone());
    let ip_fb_large_bc = ip_fb_large.as_ref().and_then(|n| n.by_class.clone());
    let oop_fp_large_bc = oop_fp_large.as_ref().and_then(|n| n.by_class.clone());

    Some(StreetNodes {
        strategies: [
            Some(oop.strategy),
            ip.as_ref().map(|n| n.strategy.clone()),
            ip_fb.as_ref().map(|n| n.strategy.clone()),
            oop_fp.as_ref().map(|n| n.strategy.clone()),
            oop_fr_small.as_ref().map(|n| n.strategy.clone()),
            oop_fr_large.as_ref().map(|n| n.strategy.clone()),
            ip_fr_small.as_ref().map(|n| n.strategy.clone()),
            ip_fr_large.as_ref().map(|n| n.strategy.clone()),
            ip_fb_large.as_ref().map(|n| n.strategy.clone()),
            oop_fp_large.as_ref().map(|n| n.strategy.clone()),
        ],
        actions: [
            Some(oop.actions),
            ip.map(|n| n.actions),
            ip_fb.map(|n| n.actions),
            oop_fp.map(|n| n.actions),
            oop_fr_small.map(|n| n.actions),
            oop_fr_large.map(|n| n.actions),
            ip_fr_small.map(|n| n.actions),
            ip_fr_large.map(|n| n.actions),
            ip_fb_large.map(|n| n.actions),
            oop_fp_large.map(|n| n.actions),
        ],
        by_class: [
            oop_bc, ip_bc, ip_fb_bc, oop_fp_bc,
            oop_fr_small_bc, oop_fr_large_bc, ip_fr_small_bc, ip_fr_large_bc,
            ip_fb_large_bc, oop_fp_large_bc,
        ],
    })
}

fn strat_value(opt: &Option<Vec<f64>>) -> Value {
    match opt {
        Some(v) => json!(v),
        None => Value::Null,
    }
}
fn class_value(opt: &Option<Map<String, Value>>) -> Value {
    match opt {
        Some(m) => Value::Object(m.clone()),
        None => Value::Null,
    }
}
fn action_value(opt: &Option<String>) -> Value {
    match opt {
        Some(s) => json!(s),
        None => Value::Null,
    }
}

// Action lines that reach the next street's chance node (mirrors ACTION_LINES).
fn action_lines() -> Vec<(&'static str, Vec<Sel>)> {
    vec![
        ("check_check", vec![Sel::Check, Sel::Check]),
        ("bet_small_call", vec![Sel::BetSmall, Sel::Call]),
        ("bet_large_call", vec![Sel::BetLarge, Sel::Call]),
        ("xbet_small_call", vec![Sel::Check, Sel::BetSmall, Sel::Call]),
        ("xbet_large_call", vec![Sel::Check, Sel::BetLarge, Sel::Call]),
        ("bet_small_raise_call", vec![Sel::BetSmall, Sel::Raise, Sel::Call]),
        ("bet_large_raise_call", vec![Sel::BetLarge, Sel::Raise, Sel::Call]),
        ("xbet_small_raise_call", vec![Sel::Check, Sel::BetSmall, Sel::Raise, Sel::Call]),
        ("xbet_large_raise_call", vec![Sel::Check, Sel::BetLarge, Sel::Raise, Sel::Call]),
        ("bet_small_raise_raise_call", vec![Sel::BetSmall, Sel::Raise, Sel::Raise, Sel::Call]),
        ("bet_large_raise_raise_call", vec![Sel::BetLarge, Sel::Raise, Sel::Raise, Sel::Call]),
        ("xbet_small_raise_raise_call", vec![Sel::Check, Sel::BetSmall, Sel::Raise, Sel::Raise, Sel::Call]),
        ("xbet_large_raise_raise_call", vec![Sel::Check, Sel::BetLarge, Sel::Raise, Sel::Raise, Sel::Call]),
    ]
}

fn emit(v: Value) -> ! {
    println!("{v}");
    std::process::exit(0);
}

fn main() {
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        emit(json!({ "error": "failed to read stdin" }));
    }
    let config: Config = match serde_json::from_str(&input) {
        Ok(c) => c,
        Err(e) => emit(json!({ "error": format!("bad config json: {e}") })),
    };

    let oop_range = parse_range(&config.oop_range);
    let ip_range = parse_range(&config.ip_range);
    let board: Vec<u8> = config
        .board
        .iter()
        .map(|c| {
            let b = c.as_bytes();
            card_id(b[0], b[1])
        })
        .collect();

    let mut mgr = GameManager::new();
    let bs = &config.bet_sizes;
    let err = mgr.init(
        &oop_range,
        &ip_range,
        &board,
        config.pot,
        config.stack,
        config.donk_option,
        &bs.oop_flop_bet,
        &bs.oop_flop_raise,
        &bs.oop_turn_bet,
        &bs.oop_turn_raise,
        &bs.oop_turn_donk,
        &bs.oop_river_bet,
        &bs.oop_river_raise,
        &bs.oop_river_donk,
        &bs.ip_flop_bet,
        &bs.ip_flop_raise,
        &bs.ip_turn_bet,
        &bs.ip_turn_raise,
        &bs.ip_river_bet,
        &bs.ip_river_raise,
    );
    if let Some(e) = err {
        emit(json!({ "error": e }));
    }

    let mem_bytes = mgr.memory_usage(true);
    eprintln!(
        "[native] tree memory (compressed): {:.2} GiB",
        mem_bytes as f64 / 1024.0 / 1024.0 / 1024.0
    );

    mgr.allocate_memory(true);

    // ---- Solve loop (mirrors the Node child) ----
    let target = config.pot as f64 * config.target / 100.0;
    let mut iteration: u32 = 0;
    let mut exploit = mgr.exploitability() as f64;
    while iteration < config.iterations && exploit > target {
        // Run a batch of CFR steps, then check exploitability once. exploitability()
        // is a full best-response tree pass (≈ one CFR iteration), so we avoid
        // computing it every single iteration.
        let batch = 10;
        let mut i = 0;
        while i < batch && iteration < config.iterations {
            mgr.solve_step(iteration);
            iteration += 1;
            i += 1;
        }
        exploit = mgr.exploitability() as f64;
    }
    mgr.finalize();

    // From here on we navigate the solved tree to extract nodes. Some action /
    // chance lines don't exist in a given tree and make postflop-solver panic
    // with "Invalid action"; `nav` catches those and skips the line. Suppress
    // the hook's output for exactly those expected panics, but keep reporting
    // any other (genuine) panic normally.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if info.to_string().contains("Invalid action") {
            return;
        }
        default_hook(info);
    }));

    let oop_len = mgr.private_len(0);
    let ip_len = mgr.private_len(1);

    // ---- Root results ----
    mgr.apply_history(&[]);
    let results = mgr.get_results();
    let root_actions = mgr.actions();
    let root_player = mgr.current_player().to_string();
    let root_num_actions = mgr.num_actions();

    let mut off = 0usize;
    off += 2; // pots
    let is_empty_flag = results[off] as i64;
    off += 1;
    let oop_weights = &results[off..off + oop_len];
    off += oop_len;
    let ip_weights = &results[off..off + ip_len];
    off += ip_len;
    off += oop_len + ip_len; // normalized

    let mut avg_equity = [0.0f64; 2];
    let mut avg_ev = [0.0f64; 2];
    if is_empty_flag == 0 {
        let oop_eq = &results[off..off + oop_len];
        off += oop_len;
        let ip_eq = &results[off..off + ip_len];
        off += ip_len;
        let oop_ev = &results[off..off + oop_len];
        off += oop_len;
        let ip_ev = &results[off..off + ip_len];
        off += ip_len;
        off += oop_len + ip_len; // eqr
        for p in 0..2 {
            let (eq, ev, w, len): (&[f64], &[f64], &[f64], usize) = if p == 0 {
                (oop_eq, oop_ev, oop_weights, oop_len)
            } else {
                (ip_eq, ip_ev, ip_weights, ip_len)
            };
            let mut w_sum = 0.0;
            let mut eq_sum = 0.0;
            let mut ev_sum = 0.0;
            for i in 0..len {
                w_sum += w[i];
                eq_sum += eq[i] * w[i];
                ev_sum += ev[i] * w[i];
            }
            if w_sum > 0.0 {
                avg_equity[p] = (eq_sum / w_sum * 1000.0).round() / 1000.0;
                avg_ev[p] = (ev_sum / w_sum * 100.0).round() / 100.0;
            }
        }
    }

    let root_strategy: Value = if root_player != "terminal" && root_player != "chance" {
        let active_len = if root_player == "oop" { oop_len } else { ip_len };
        let active_w = if root_player == "oop" { oop_weights } else { ip_weights };
        let strat = &results[off..off + root_num_actions * active_len];
        let total_w: f64 = active_w.iter().sum();
        let mut agg = Vec::with_capacity(root_num_actions);
        for a in 0..root_num_actions {
            let mut sum = 0.0;
            for c in 0..active_len {
                sum += strat[a * active_len + c] * active_w[c];
            }
            agg.push(if total_w > 0.0 {
                (sum / total_w * 1000.0).round() / 1000.0
            } else {
                0.0
            });
        }
        json!(agg)
    } else {
        Value::Null
    };

    let root_strategy_by_class: Value = if root_player != "terminal" && root_player != "chance" {
        let pidx = if root_player == "oop" { 0 } else { 1 };
        let pairs = mgr.private_pairs(pidx);
        Value::Object(strategy_by_class(
            &results,
            &root_player,
            oop_len,
            ip_len,
            root_num_actions,
            &pairs,
            &board[..3],
        ))
    } else {
        Value::Null
    };

    // ---- Flop child nodes ----
    let mut nodes = Map::new();
    let flop_board: Vec<u8> = board[..3].to_vec();
    // Address each node by action selectors (label-resolved), not fixed indices,
    // so extraction stays correct when the tree changes shape at low SPR.
    //   *_cbet          → small-bet variants (villain's first sizing)
    //   *_cbet_large    → large-bet variants (villain's second sizing)
    //   *_facing_raise_ → hero bet, villain raised (split by hero's bet size)
    for (key, sels) in [
        ("ip_cbet", [Sel::Check].as_slice()),
        ("ip_facing_cbet", [Sel::BetSmall].as_slice()),
        ("ip_facing_cbet_large", [Sel::BetLarge].as_slice()),
        ("oop_facing_cbet", [Sel::Check, Sel::BetSmall].as_slice()),
        ("oop_facing_cbet_large", [Sel::Check, Sel::BetLarge].as_slice()),
        ("oop_facing_raise_small", [Sel::BetSmall, Sel::Raise].as_slice()),
        ("oop_facing_raise_large", [Sel::BetLarge, Sel::Raise].as_slice()),
        ("ip_facing_raise_small", [Sel::Check, Sel::BetSmall, Sel::Raise].as_slice()),
        ("ip_facing_raise_large", [Sel::Check, Sel::BetLarge, Sel::Raise].as_slice()),
    ] {
        if let Some(hist) = resolve_path(&mut mgr, &[], sels) {
            if let Some(n) = node_strategy(&mut mgr, &hist, oop_len, ip_len, Some(&flop_board)) {
                nodes.insert(key.into(), json!({
                    "actions": n.actions, "player": n.player,
                    "numActions": n.num_actions, "strategy": n.strategy,
                    "strategyByClass": n.by_class.clone().map(Value::Object).unwrap_or(Value::Null),
                }));
            }
        }
    }

    // ---- Turn + river extraction ----
    let mut turn_nodes = Map::new();
    let mut river_nodes = Map::new();
    let lines = action_lines();

        // Turn isomorphism: which suits are indistinguishable on this flop?
        let flop_rankset = build_rankset(&flop_board);
        let turn_iso_suits = compute_isomorphic_suits(&flop_rankset);
        let turn_iso = compute_card_isomorphism(&flop_board, &turn_iso_suits);

        for (flop_line, flop_sels) in &lines {
            // Resolve this flop line's selectors to a concrete index history for
            // the current tree; skip lines that don't exist (e.g. a size that
            // collapsed to all-in at low SPR).
            let flop_hist = match resolve_path(&mut mgr, &[], flop_sels) {
                Some(h) => h,
                None => continue,
            };
            if !chance_at(&mut mgr, &flop_hist) {
                continue;
            }
            let mut turn_actions: Option<[Value; 10]> = None;
            let mut turn_cards = Map::new();
            let mut river_per_turn_card = Map::new();
            let mut seen_turn_groups: std::collections::HashSet<usize> = std::collections::HashSet::new();

            // Iterate through isomorphic group representatives — one per unique
            // chance action at the turn node. Skip duplicate groups (cards whose
            // suits are isomorphic share the same strategy).
            for &pc in &turn_iso.group_to_card {
                let group = turn_iso.card_to_group[pc as usize].unwrap();
                if !seen_turn_groups.insert(group) {
                    continue;
                }

                let mut turn_hist = flop_hist.clone();
                turn_hist.push(pc as usize);
                let turn_card_str = index_to_card(pc);

                let mut turn_board_ids = flop_board.clone();
                turn_board_ids.push(pc);
                let turn_res = match extract_street_nodes(&mut mgr, &turn_hist, oop_len, ip_len, Some(&turn_board_ids)) {
                    Some(r) => r,
                    None => continue,
                };
                turn_cards.insert(
                    turn_card_str.clone(),
                    json!({
                        "s": [
                            strat_value(&turn_res.strategies[0]),
                            strat_value(&turn_res.strategies[1]),
                            strat_value(&turn_res.strategies[2]),
                            strat_value(&turn_res.strategies[3]),
                            strat_value(&turn_res.strategies[4]),
                            strat_value(&turn_res.strategies[5]),
                            strat_value(&turn_res.strategies[6]),
                            strat_value(&turn_res.strategies[7]),
                            strat_value(&turn_res.strategies[8]),
                            strat_value(&turn_res.strategies[9]),
                        ],
                        "bc": [
                            class_value(&turn_res.by_class[0]),
                            class_value(&turn_res.by_class[1]),
                            class_value(&turn_res.by_class[2]),
                            class_value(&turn_res.by_class[3]),
                            class_value(&turn_res.by_class[4]),
                            class_value(&turn_res.by_class[5]),
                            class_value(&turn_res.by_class[6]),
                            class_value(&turn_res.by_class[7]),
                            class_value(&turn_res.by_class[8]),
                            class_value(&turn_res.by_class[9]),
                        ],
                    }),
                );
                if turn_actions.is_none() {
                    turn_actions = Some([
                        action_value(&turn_res.actions[0]),
                        action_value(&turn_res.actions[1]),
                        action_value(&turn_res.actions[2]),
                        action_value(&turn_res.actions[3]),
                        action_value(&turn_res.actions[4]),
                        action_value(&turn_res.actions[5]),
                        action_value(&turn_res.actions[6]),
                        action_value(&turn_res.actions[7]),
                        action_value(&turn_res.actions[8]),
                        action_value(&turn_res.actions[9]),
                    ]);
                }

            // ---- River extraction (per turn line) ----
            let mut board_with_turn = config.board.clone();
            board_with_turn.push(turn_card_str.clone());

            // River isomorphism depends on which turn card was dealt.
            let turn_and_board_ids: Vec<u8> = {
                let mut v = flop_board.clone();
                v.push(pc);
                v
            };
            let turn_rankset = build_rankset(&turn_and_board_ids);
            let river_iso_suits = compute_isomorphic_suits(&turn_rankset);
            let river_iso = compute_card_isomorphism(&turn_and_board_ids, &river_iso_suits);

            let mut river_for_card = Map::new();

            for (turn_line, turn_sels) in &lines {
                // Resolve this turn line relative to the turn history.
                let river_chance_hist = match resolve_path(&mut mgr, &turn_hist, turn_sels) {
                    Some(h) => h,
                    None => continue,
                };
                if !chance_at(&mut mgr, &river_chance_hist) {
                    continue;
                }
                let mut river_actions: Option<[Value; 10]> = None;
                let mut river_cards = Map::new();
                let mut seen_river_groups: std::collections::HashSet<usize> = std::collections::HashSet::new();

                for &rc in &river_iso.group_to_card {
                    let rgroup = river_iso.card_to_group[rc as usize].unwrap();
                    if !seen_river_groups.insert(rgroup) {
                        continue;
                    }

                    let mut river_hist = river_chance_hist.clone();
                    river_hist.push(rc as usize);
                    let mut river_board_ids = flop_board.clone();
                    river_board_ids.push(pc);
                    river_board_ids.push(rc);
                    let river_res = match extract_street_nodes(&mut mgr, &river_hist, oop_len, ip_len, Some(&river_board_ids)) {
                        Some(r) => r,
                        None => continue,
                    };
                    river_cards.insert(
                        index_to_card(rc),
                        json!({
                            "s": [
                                strat_value(&river_res.strategies[0]),
                                strat_value(&river_res.strategies[1]),
                                strat_value(&river_res.strategies[2]),
                                strat_value(&river_res.strategies[3]),
                                strat_value(&river_res.strategies[4]),
                                strat_value(&river_res.strategies[5]),
                                strat_value(&river_res.strategies[6]),
                                strat_value(&river_res.strategies[7]),
                                strat_value(&river_res.strategies[8]),
                                strat_value(&river_res.strategies[9]),
                            ],
                            "bc": [
                                class_value(&river_res.by_class[0]),
                                class_value(&river_res.by_class[1]),
                                class_value(&river_res.by_class[2]),
                                class_value(&river_res.by_class[3]),
                                class_value(&river_res.by_class[4]),
                                class_value(&river_res.by_class[5]),
                                class_value(&river_res.by_class[6]),
                                class_value(&river_res.by_class[7]),
                                class_value(&river_res.by_class[8]),
                                class_value(&river_res.by_class[9]),
                            ],
                        }),
                    );
                    if river_actions.is_none() {
                        river_actions = Some([
                            action_value(&river_res.actions[0]),
                            action_value(&river_res.actions[1]),
                            action_value(&river_res.actions[2]),
                            action_value(&river_res.actions[3]),
                            action_value(&river_res.actions[4]),
                            action_value(&river_res.actions[5]),
                            action_value(&river_res.actions[6]),
                            action_value(&river_res.actions[7]),
                            action_value(&river_res.actions[8]),
                            action_value(&river_res.actions[9]),
                        ]);
                    }
                }

                if !river_cards.is_empty() {
                    river_for_card.insert(
                        (*turn_line).to_string(),
                        json!({
                            "actions": river_actions.map(|a| Value::Array(a.to_vec())).unwrap_or(Value::Null),
                            "cards": Value::Object(river_cards),
                        }),
                    );
                }
            }

            if !river_for_card.is_empty() {
                river_per_turn_card
                    .insert(turn_card_str.clone(), Value::Object(river_for_card));
            }
        }

            if !turn_cards.is_empty() {
                turn_nodes.insert(
                    (*flop_line).to_string(),
                    json!({
                        "actions": turn_actions.map(|a| Value::Array(a.to_vec())).unwrap_or(Value::Null),
                        "cards": Value::Object(turn_cards),
                    }),
                );
            }
        if !river_per_turn_card.is_empty() {
            river_nodes.insert((*flop_line).to_string(), Value::Object(river_per_turn_card));
        }
    }

    // packed private cards are computed but not part of the output contract;
    // ensure the methods are considered used.
    let _ = (mgr.private_cards_packed(0).len(), mgr.private_cards_packed(1).len());

    let out = json!({
        "iterations": iteration,
        "exploitability": (exploit * 1000.0).round() / 1000.0,
        "actions": root_actions,
        "player": root_player,
        "numActions": root_num_actions,
        "strategy": root_strategy,
        "strategyByClass": root_strategy_by_class,
        "oopEquity": avg_equity[0],
        "ipEquity": avg_equity[1],
        "oopEV": avg_ev[0],
        "ipEV": avg_ev[1],
        "oopCombos": oop_len,
        "ipCombos": ip_len,
        "nodes": Value::Object(nodes),
        "turn_nodes": if !turn_nodes.is_empty() { Value::Object(turn_nodes) } else { Value::Null },
        "river_nodes": if !river_nodes.is_empty() { Value::Object(river_nodes) } else { Value::Null },
    });

    emit(out);
}
