// GTOTerminal — WASM Preflop Solver
// CFR+ solver for preflop poker (6-max NLHE)

extern crate wasm_bindgen;

mod hands;
mod equity;
mod game_tree;
mod cfr;

use wasm_bindgen::prelude::*;
use game_tree::{SpotConfig, ActionContext};
use cfr::CfrSolver;

#[wasm_bindgen]
pub struct PreflopSolver {
    solver: Option<CfrSolver>,
}

#[wasm_bindgen]
impl PreflopSolver {
    /// Create a new solver instance
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        PreflopSolver { solver: None }
    }

    /// Set up a preflop spot to solve.
    ///
    /// config_json format:
    /// {
    ///   "stackDepth": 100,          // Effective stack in BB
    ///   "actionContext": "rfi",      // "rfi", "vs_raise", "vs_3bet", "vs_4bet"
    ///   "villainRange": [1.0, ...],  // 169 weights (optional, defaults to full range)
    ///   "icmBubbleFactor": 1.0       // ICM bubble factor (optional, default 1.0)
    /// }
    pub fn setup(&mut self, config_json: &str) -> Option<String> {
        let parsed: serde_json::Value = match serde_json::from_str(config_json) {
            Ok(v) => v,
            Err(e) => return Some(format!("Invalid JSON: {}", e)),
        };

        // Parse stack depth
        let stack_depth = parsed["stackDepth"].as_f64().unwrap_or(100.0) as f32;

        // Parse action context
        let context_str = parsed["actionContext"].as_str().unwrap_or("rfi");
        let context = match ActionContext::from_str(context_str) {
            Some(c) => c,
            None => return Some(format!("Unknown actionContext: {}", context_str)),
        };

        // Build spot config
        let mut config = SpotConfig::new(context, stack_depth);

        // Number of opponents (for RFI fold equity)
        if let Some(n) = parsed["numOpponents"].as_u64() {
            config = config.with_opponents(n as u32);
        }

        // Position-specific overrides for equity realization and villain fold frequency
        if let Some(v) = parsed["callEqRealization"].as_f64() {
            config.call_eq_override = Some(v as f32);
        }
        if let Some(v) = parsed["raiseEqRealization"].as_f64() {
            config.raise_eq_override = Some(v as f32);
        }
        if let Some(v) = parsed["villainFoldFreq"].as_f64() {
            config.villain_fold_override = Some(v as f32);
        }

        // Parse villain range (or default to full range)
        let mut villain_range = [1.0f32; hands::NUM_GROUPS];
        if let Some(arr) = parsed["villainRange"].as_array() {
            for (i, v) in arr.iter().enumerate() {
                if i >= hands::NUM_GROUPS { break; }
                villain_range[i] = v.as_f64().unwrap_or(1.0) as f32;
            }
        }

        // Create solver
        self.solver = Some(CfrSolver::new(config, villain_range));
        None
    }

    /// Run solver iterations.
    /// Returns the number of iterations actually performed.
    pub fn solve(&mut self, max_iterations: u32, target_exploitability: f32) -> u32 {
        if let Some(ref mut solver) = self.solver {
            let start = solver.iterations;
            solver.solve(max_iterations, target_exploitability);
            solver.iterations - start
        } else {
            0
        }
    }

    /// Run a single batch of iterations (for progress reporting).
    /// Returns current iteration count.
    pub fn solve_step(&mut self, batch_size: u32) -> u32 {
        if let Some(ref mut solver) = self.solver {
            for _ in 0..batch_size {
                solver.iterate();
            }
            solver.iterations
        } else {
            0
        }
    }

    /// Get current exploitability (lower = closer to Nash equilibrium)
    pub fn exploitability(&self) -> f32 {
        if let Some(ref solver) = self.solver {
            solver.exploitability()
        } else {
            f32::MAX
        }
    }

    /// Get current iteration count
    pub fn iterations(&self) -> u32 {
        if let Some(ref solver) = self.solver {
            solver.iterations
        } else {
            0
        }
    }

    /// Get results as JSON string.
    /// Returns: { "AA": { "fold": 0.0, "call": 0.0, "raise": 1.0 }, ... }
    pub fn get_results(&self) -> String {
        if let Some(ref solver) = self.solver {
            let results = solver.get_results_json();
            let mut json = String::from("{");
            let mut first = true;

            for (name, freqs) in &results {
                if !first { json.push(','); }
                first = false;

                // Round to 3 decimal places
                let fold = (freqs[0] * 1000.0).round() / 1000.0;
                let call = (freqs[1] * 1000.0).round() / 1000.0;
                let raise = (freqs[2] * 1000.0).round() / 1000.0;

                json.push_str(&format!(
                    "\"{}\":{{\"fold\":{},\"call\":{},\"raise\":{}}}",
                    name, fold, call, raise
                ));
            }
            json.push('}');
            json
        } else {
            "{}".to_string()
        }
    }

    /// Get results in the compact format used by PreflopRanges.
    /// Returns JSON: { "pure_raise": ["AA","KK",...], "pure_call": [...], "mixed": {"QQ": [fold,call,raise],...} }
    pub fn get_results_compact(&self) -> String {
        if let Some(ref solver) = self.solver {
            let results = solver.get_results_json();

            let mut pure_raise: Vec<String> = Vec::new();
            let mut pure_call: Vec<String> = Vec::new();
            let mut mixed: Vec<(String, [f32; 3])> = Vec::new();

            for (name, freqs) in &results {
                let fold = freqs[0];
                let call = freqs[1];
                let raise = freqs[2];

                if raise >= 0.95 {
                    pure_raise.push(name.clone());
                } else if call >= 0.95 {
                    pure_call.push(name.clone());
                } else if fold < 0.95 {
                    // Mixed or has some action
                    mixed.push((name.clone(), [
                        (fold * 100.0).round() / 100.0,
                        (call * 100.0).round() / 100.0,
                        (raise * 100.0).round() / 100.0,
                    ]));
                }
                // else: pure fold, not included
            }

            let mut json = String::from("{\"pure_raise\":[");
            for (i, h) in pure_raise.iter().enumerate() {
                if i > 0 { json.push(','); }
                json.push_str(&format!("\"{}\"", h));
            }
            json.push_str("],\"pure_call\":[");
            for (i, h) in pure_call.iter().enumerate() {
                if i > 0 { json.push(','); }
                json.push_str(&format!("\"{}\"", h));
            }
            json.push_str("],\"mixed\":{");
            for (i, (name, freqs)) in mixed.iter().enumerate() {
                if i > 0 { json.push(','); }
                json.push_str(&format!("\"{}\":[{},{},{}]", name, freqs[0], freqs[1], freqs[2]));
            }
            json.push_str("}}");
            json
        } else {
            "{\"pure_raise\":[],\"pure_call\":[],\"mixed\":{}}".to_string()
        }
    }

    /// Get total combos in the hero's raising range
    pub fn raise_combos(&self) -> f32 {
        if let Some(ref solver) = self.solver {
            let results = solver.get_results_json();
            let mut combos = 0.0f32;
            for (i, (_, freqs)) in results.iter().enumerate() {
                combos += freqs[2] * hands::group_combos(i);
            }
            combos
        } else {
            0.0
        }
    }
}
