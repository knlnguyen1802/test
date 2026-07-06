/// CFR+ (Counterfactual Regret Minimization Plus) solver for preflop poker.
///
/// Hero has 169 hand groups, each choosing from {fold, call, raise}.
/// Villain has a fixed range. Equity is from the pre-computed matrix.
/// The solver finds the Nash equilibrium strategy for the hero player.

use crate::hands::{self, NUM_GROUPS};
use crate::equity;
use crate::game_tree::{self, SpotConfig, Action, SpotPayoffs};

const MAX_ACTIONS: usize = 3;

pub struct CfrSolver {
    regret: [[f32; MAX_ACTIONS]; NUM_GROUPS],
    strategy_sum: [[f32; MAX_ACTIONS]; NUM_GROUPS],
    strategy: [[f32; MAX_ACTIONS]; NUM_GROUPS],
    equity_matrix: Vec<Vec<f32>>,
    config: SpotConfig,
    payoffs: SpotPayoffs,
    actions: Vec<Action>,
    villain_range: [f32; NUM_GROUPS],
    /// Villain's continuing range (top portion that doesn't fold to raises)
    villain_continue_range: [f32; NUM_GROUPS],
    pub iterations: u32,
}

impl CfrSolver {
    pub fn new(config: SpotConfig, villain_range: [f32; NUM_GROUPS]) -> Self {
        let payoffs = SpotPayoffs::from_config(&config);
        let actions = game_tree::available_actions(config.action_context);
        let equity_matrix = equity::build_equity_matrix();

        // Build villain's continuing range (hands that don't fold to our raise)
        let villain_continue_range = Self::build_continue_range(
            &villain_range, payoffs.villain_fold_freq, &equity_matrix
        );

        let num_actions = actions.len();
        let uniform = 1.0 / num_actions as f32;
        let mut strategy = [[0.0f32; MAX_ACTIONS]; NUM_GROUPS];
        for hand in 0..NUM_GROUPS {
            for a in 0..num_actions {
                strategy[hand][a] = uniform;
            }
        }

        CfrSolver {
            regret: [[0.0; MAX_ACTIONS]; NUM_GROUPS],
            strategy_sum: [[0.0; MAX_ACTIONS]; NUM_GROUPS],
            strategy,
            equity_matrix,
            config,
            payoffs,
            actions,
            villain_range,
            villain_continue_range,
            iterations: 0,
        }
    }

    /// Build the villain's range that continues (calls or re-raises) vs a raise.
    /// Takes the top (1 - fold_freq) portion by hand strength.
    fn build_continue_range(
        villain_range: &[f32; NUM_GROUPS],
        fold_freq: f32,
        equity_matrix: &[Vec<f32>],
    ) -> [f32; NUM_GROUPS] {
        let mut continue_range = [0.0f32; NUM_GROUPS];
        if fold_freq <= 0.0 {
            return *villain_range;
        }

        let groups = hands::all_groups();

        // Compute hand strengths (equity vs random)
        let full_range = [1.0f32; NUM_GROUPS];
        let mut hand_strengths: Vec<(usize, f32)> = Vec::new();
        for v in 0..NUM_GROUPS {
            if villain_range[v] <= 0.0 { continue; }
            let eq = equity::equity_vs_range(v, &full_range, equity_matrix);
            hand_strengths.push((v, eq));
        }
        hand_strengths.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        // Total combos in villain range
        let mut total_combos = 0.0f32;
        for &(v, _) in &hand_strengths {
            total_combos += villain_range[v] * groups[v].combos();
        }

        // Keep the top (1 - fold_freq) portion
        let target_combos = total_combos * (1.0 - fold_freq);
        let mut running = 0.0f32;
        for &(v, _) in &hand_strengths {
            let combos = villain_range[v] * groups[v].combos();
            if running + combos <= target_combos {
                continue_range[v] = villain_range[v];
                running += combos;
            } else {
                let remaining = target_combos - running;
                if combos > 0.0 {
                    continue_range[v] = villain_range[v] * (remaining / combos);
                }
                break;
            }
        }

        continue_range
    }

    /// Run one iteration of CFR+
    pub fn iterate(&mut self) {
        self.iterations += 1;
        let num_actions = self.actions.len();

        for hand in 0..NUM_GROUPS {
            let combos = hands::group_combos(hand);
            if combos <= 0.0 { continue; }

            // Hero's equity vs villain's full range (for call path)
            let eq_vs_range = equity::equity_vs_range(
                hand, &self.villain_range, &self.equity_matrix
            );
            // Hero's equity vs villain's continuing range (for raise path)
            let eq_vs_continue = equity::equity_vs_range(
                hand, &self.villain_continue_range, &self.equity_matrix
            );

            // Compute EV for each action
            let mut action_ev = [0.0f32; MAX_ACTIONS];
            for a in 0..num_actions {
                action_ev[a] = match self.actions[a] {
                    Action::Fold => self.payoffs.fold_ev,
                    Action::Call => self.payoffs.call_ev(eq_vs_range),
                    Action::Raise => self.payoffs.raise_ev(eq_vs_continue),
                };
            }

            // Strategy-weighted EV
            let mut node_ev = 0.0f32;
            for a in 0..num_actions {
                node_ev += self.strategy[hand][a] * action_ev[a];
            }

            // Update regrets (CFR+: clamp to 0)
            for a in 0..num_actions {
                let regret = action_ev[a] - node_ev;
                self.regret[hand][a] = (self.regret[hand][a] + regret).max(0.0);
            }

            // Update strategy sum (linear weighting)
            let weight = self.iterations as f32;
            for a in 0..num_actions {
                self.strategy_sum[hand][a] += weight * self.strategy[hand][a];
            }

            // Regret matching
            let mut regret_sum = 0.0f32;
            for a in 0..num_actions {
                regret_sum += self.regret[hand][a];
            }

            if regret_sum > 0.0 {
                for a in 0..num_actions {
                    self.strategy[hand][a] = self.regret[hand][a] / regret_sum;
                }
            } else {
                for a in 0..num_actions {
                    self.strategy[hand][a] = 1.0 / num_actions as f32;
                }
            }
        }
    }

    /// Run multiple iterations
    pub fn solve(&mut self, max_iterations: u32, target_exploitability: f32) {
        for _ in 0..max_iterations {
            self.iterate();
            if self.iterations % 100 == 0 && self.exploitability() < target_exploitability {
                break;
            }
        }
    }

    /// Get the average strategy (converged Nash equilibrium)
    pub fn get_average_strategy(&self) -> [[f32; MAX_ACTIONS]; NUM_GROUPS] {
        let num_actions = self.actions.len();
        let mut avg = [[0.0f32; MAX_ACTIONS]; NUM_GROUPS];

        for hand in 0..NUM_GROUPS {
            let mut total = 0.0f32;
            for a in 0..num_actions {
                total += self.strategy_sum[hand][a];
            }
            if total > 0.0 {
                for a in 0..num_actions {
                    avg[hand][a] = self.strategy_sum[hand][a] / total;
                }
            } else {
                for a in 0..num_actions {
                    avg[hand][a] = 1.0 / num_actions as f32;
                }
            }
        }
        avg
    }

    /// Compute exploitability (lower = closer to Nash)
    pub fn exploitability(&self) -> f32 {
        let avg = self.get_average_strategy();
        let num_actions = self.actions.len();
        let mut max_exploit = 0.0f32;

        for hand in 0..NUM_GROUPS {
            let combos = hands::group_combos(hand);
            if combos <= 0.0 { continue; }

            let eq_vs_range = equity::equity_vs_range(
                hand, &self.villain_range, &self.equity_matrix
            );
            let eq_vs_continue = equity::equity_vs_range(
                hand, &self.villain_continue_range, &self.equity_matrix
            );

            let mut best_ev = f32::NEG_INFINITY;
            let mut avg_ev = 0.0f32;

            for a in 0..num_actions {
                let ev = match self.actions[a] {
                    Action::Fold => self.payoffs.fold_ev,
                    Action::Call => self.payoffs.call_ev(eq_vs_range),
                    Action::Raise => self.payoffs.raise_ev(eq_vs_continue),
                };
                if ev > best_ev { best_ev = ev; }
                avg_ev += avg[hand][a] * ev;
            }

            max_exploit += (best_ev - avg_ev) * combos;
        }

        max_exploit / 1326.0
    }

    /// Get context
    pub fn action_context(&self) -> game_tree::ActionContext {
        self.config.action_context
    }

    /// Convert results to fold/call/raise format
    pub fn get_results_json(&self) -> Vec<(String, [f32; 3])> {
        let avg = self.get_average_strategy();
        let num_actions = self.actions.len();
        let mut results = Vec::with_capacity(NUM_GROUPS);

        for hand in 0..NUM_GROUPS {
            let name = hands::index_to_name(hand);
            let mut freqs = [0.0f32; 3]; // [fold, call, raise]

            for a in 0..num_actions {
                match self.actions[a] {
                    Action::Fold => freqs[0] = avg[hand][a],
                    Action::Call => freqs[1] = avg[hand][a],
                    Action::Raise => freqs[2] = avg[hand][a],
                }
            }

            let sum: f32 = freqs.iter().sum();
            if sum > 0.0 {
                for f in freqs.iter_mut() { *f /= sum; }
            }

            results.push((name, freqs));
        }
        results
    }
}
