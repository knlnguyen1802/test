// GTOTerminal — WASM Postflop Solver Wrapper
// Based on postflop-solver by Wataru Inariba (AGPL-3.0)
// Single-threaded build for maximum browser compatibility

extern crate wasm_bindgen;
use postflop_solver::*;
use wasm_bindgen::prelude::*;

struct DummyPool;
static mut THREAD_POOL: Option<DummyPool> = None;
impl DummyPool {
    fn install<OP: FnOnce() -> R, R: Default>(&self, _op: OP) -> R {
        R::default()
    }
}

#[wasm_bindgen]
pub struct GameManager {
    game: PostFlopGame,
}

#[inline]
fn round(value: f64) -> f64 {
    if value < 1.0 {
        (value * 1000000.0).round() / 1000000.0
    } else if value < 10.0 {
        (value * 100000.0).round() / 100000.0
    } else if value < 100.0 {
        (value * 10000.0).round() / 10000.0
    } else if value < 1000.0 {
        (value * 1000.0).round() / 1000.0
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

#[inline]
fn weighted_average(slice: &[f32], weights: &[f32]) -> f64 {
    let mut sum = 0.0;
    let mut weight_sum = 0.0;
    for (&value, &weight) in slice.iter().zip(weights.iter()) {
        sum += value as f64 * weight as f64;
        weight_sum += weight as f64;
    }
    if weight_sum == 0.0 { 0.0 } else { sum / weight_sum }
}

#[inline]
fn decode_action(action: &str) -> Action {
    match action {
        "F" => Action::Fold,
        "X" => Action::Check,
        "C" => Action::Call,
        _ => {
            let mut chars = action.chars();
            let first_char = chars.next().unwrap();
            let amount = chars.as_str().parse().unwrap();
            match first_char {
                'B' => Action::Bet(amount),
                'R' => Action::Raise(amount),
                'A' => Action::AllIn(amount),
                _ => unreachable!(),
            }
        }
    }
}

#[wasm_bindgen]
impl GameManager {
    pub fn new() -> Self {
        Self {
            game: PostFlopGame::new(),
        }
    }

    /// Initialize with ranges, board, pot/stack, and bet sizes.
    /// Returns null on success, error string on failure.
    pub fn init(
        &mut self,
        oop_range: &[f32],
        ip_range: &[f32],
        board: &[u8],
        starting_pot: i32,
        effective_stack: i32,
        rake_rate: f64,
        rake_cap: f64,
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
        add_allin_threshold: f64,
        force_allin_threshold: f64,
        merging_threshold: f64,
        added_lines: &str,
        removed_lines: &str,
    ) -> Option<String> {
        let (turn, river, state) = match board.len() {
            3 => (NOT_DEALT, NOT_DEALT, BoardState::Flop),
            4 => (board[3], NOT_DEALT, BoardState::Turn),
            5 => (board[3], board[4], BoardState::River),
            _ => return Some("Invalid board length".to_string()),
        };

        let card_config = CardConfig {
            range: [
                Range::from_raw_data(oop_range).unwrap(),
                Range::from_raw_data(ip_range).unwrap(),
            ],
            flop: board[..3].try_into().unwrap(),
            turn,
            river,
        };

        let tree_config = TreeConfig {
            initial_state: state,
            starting_pot,
            effective_stack,
            rake_rate,
            rake_cap,
            flop_bet_sizes: [
                BetSizeOptions::try_from((oop_flop_bet, oop_flop_raise)).unwrap(),
                BetSizeOptions::try_from((ip_flop_bet, ip_flop_raise)).unwrap(),
            ],
            turn_bet_sizes: [
                BetSizeOptions::try_from((oop_turn_bet, oop_turn_raise)).unwrap(),
                BetSizeOptions::try_from((ip_turn_bet, ip_turn_raise)).unwrap(),
            ],
            river_bet_sizes: [
                BetSizeOptions::try_from((oop_river_bet, oop_river_raise)).unwrap(),
                BetSizeOptions::try_from((ip_river_bet, ip_river_raise)).unwrap(),
            ],
            turn_donk_sizes: match donk_option {
                false => None,
                true => DonkSizeOptions::try_from(oop_turn_donk).ok(),
            },
            river_donk_sizes: match donk_option {
                false => None,
                true => DonkSizeOptions::try_from(oop_river_donk).ok(),
            },
            add_allin_threshold,
            force_allin_threshold,
            merging_threshold,
        };

        let mut action_tree = ActionTree::new(tree_config).unwrap();

        if !added_lines.is_empty() {
            for added_line in added_lines.split(',') {
                let line = added_line
                    .split(&['-', '|'][..])
                    .map(decode_action)
                    .collect::<Vec<_>>();
                if action_tree.add_line(&line).is_err() {
                    return Some("Failed to add line".to_string());
                }
            }
        }

        if !removed_lines.is_empty() {
            for removed_line in removed_lines.split(',') {
                let line = removed_line
                    .split(&['-', '|'][..])
                    .map(decode_action)
                    .collect::<Vec<_>>();
                if action_tree.remove_line(&line).is_err() {
                    return Some("Failed to remove line".to_string());
                }
            }
        }

        self.game.update_config(card_config, action_tree).err()
    }

    pub fn private_cards(&self, player: usize) -> Box<[u16]> {
        let cards = self.game.private_cards(player);
        cards.iter().map(|&(c1, c2)| c1 as u16 | ((c2 as u16) << 8)).collect()
    }

    pub fn memory_usage(&self, enable_compression: bool) -> u64 {
        if !enable_compression {
            self.game.memory_usage().0
        } else {
            self.game.memory_usage().1
        }
    }

    pub fn allocate_memory(&mut self, enable_compression: bool) {
        self.game.allocate_memory(enable_compression);
    }

    pub fn solve_step(&self, current_iteration: u32) {
        unsafe {
            if let Some(pool) = THREAD_POOL.as_ref() {
                pool.install(|| solve_step(&self.game, current_iteration));
            } else {
                solve_step(&self.game, current_iteration);
            }
        }
    }

    pub fn exploitability(&self) -> f32 {
        unsafe {
            if let Some(pool) = THREAD_POOL.as_ref() {
                pool.install(|| compute_exploitability(&self.game))
            } else {
                compute_exploitability(&self.game)
            }
        }
    }

    pub fn finalize(&mut self) {
        unsafe {
            if let Some(pool) = THREAD_POOL.as_ref() {
                pool.install(|| finalize(&mut self.game));
            } else {
                finalize(&mut self.game);
            }
        }
    }

    pub fn apply_history(&mut self, history: &[usize]) {
        self.game.apply_history(history);
    }

    pub fn current_player(&self) -> String {
        if self.game.is_terminal_node() {
            "terminal".to_string()
        } else if self.game.is_chance_node() {
            "chance".to_string()
        } else if self.game.current_player() == 0 {
            "oop".to_string()
        } else {
            "ip".to_string()
        }
    }

    pub fn num_actions(&self) -> usize {
        self.game.available_actions().len()
    }

    pub fn actions(&self) -> String {
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

    /// Get full results at the current game tree node.
    /// Returns a packed Float64Array with weights, equity, EV, EQR, and strategy.
    pub fn get_results(&mut self) -> Box<[f64]> {
        let game = &mut self.game;
        let mut buf = Vec::new();

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

        buf.into_boxed_slice()
    }
}
