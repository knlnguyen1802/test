/// Preflop game tree construction for 6-max.
///
/// Action contexts:
///   RFI:      Everyone folds to hero, hero can fold/raise
///   vs_raise: Villain opened, hero can fold/call/3bet
///   vs_3bet:  Hero opened, villain 3bet, hero can fold/call/4bet
///   vs_4bet:  Hero 3bet, villain 4bet, hero can fold/call/5bet-jam

/// Action a player can take
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    Fold,
    Call,
    Raise,
}

/// Action context determines the game tree structure
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ActionContext {
    Rfi,
    VsRaise,
    Vs3Bet,
    Vs4Bet,
}

impl ActionContext {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "rfi" => Some(ActionContext::Rfi),
            "vs_raise" => Some(ActionContext::VsRaise),
            "vs_3bet" => Some(ActionContext::Vs3Bet),
            "vs_4bet" => Some(ActionContext::Vs4Bet),
            _ => None,
        }
    }
}

/// Configuration for a preflop spot
#[derive(Clone, Debug)]
pub struct SpotConfig {
    pub stack_depth: f32,
    pub action_context: ActionContext,
    /// Number of opponents yet to act (for RFI fold equity calculation).
    /// UTG=5, MP=4, CO=3, BTN=2, SB=1. Default=3 (average position).
    pub num_opponents: u32,
    /// Optional overrides (set by precompute script for position-specific tuning)
    pub call_eq_override: Option<f32>,
    pub raise_eq_override: Option<f32>,
    pub villain_fold_override: Option<f32>,
}

impl SpotConfig {
    pub fn new(context: ActionContext, stack_bb: f32) -> Self {
        SpotConfig {
            stack_depth: stack_bb,
            action_context: context,
            num_opponents: 3,
            call_eq_override: None,
            raise_eq_override: None,
            villain_fold_override: None,
        }
    }

    pub fn with_opponents(mut self, n: u32) -> Self {
        self.num_opponents = n;
        self
    }
}

// ---------------------------------------------------------------------------
// Stack-depth scaling
// ---------------------------------------------------------------------------

/// Parameters that scale with effective stack depth.
/// At shorter stacks opponents defend wider, 3bet/jam more, and
/// equity realization increases (lower SPR → less post-flop play).
struct StackScaling {
    /// Multiplier on per-opponent defend rate (higher = more defense)
    defend_mult: f32,
    /// Multiplier on per-opponent 3bet/4bet rate (higher = more aggression)
    reraise_mult: f32,
    /// Bonus added to equity realization (higher at short stacks)
    eq_real_bonus: f32,
    /// Multiplier on villain fold-to-raise frequency (lower = villain folds less)
    fold_freq_mult: f32,
}

fn stack_scaling(stack: f32) -> StackScaling {
    if stack >= 60.0 {
        StackScaling { defend_mult: 1.0, reraise_mult: 1.0, eq_real_bonus: 0.0, fold_freq_mult: 1.0 }
    } else if stack >= 30.0 {
        // ~40bb: slight increase in opponent aggression
        StackScaling { defend_mult: 1.05, reraise_mult: 1.10, eq_real_bonus: 0.0, fold_freq_mult: 0.95 }
    } else if stack >= 20.0 {
        // ~25bb: cheaper opens (2.2 vs 2.5) need negative bonus to compensate
        StackScaling { defend_mult: 1.10, reraise_mult: 1.25, eq_real_bonus: -0.02, fold_freq_mult: 0.88 }
    } else if stack >= 15.0 {
        // ~20bb: open size drops further, increase penalty
        StackScaling { defend_mult: 1.15, reraise_mult: 1.40, eq_real_bonus: -0.04, fold_freq_mult: 0.80 }
    } else {
        // <=15bb: cheapest opens (2.0) need strongest penalty to keep ranges tight
        StackScaling { defend_mult: 1.20, reraise_mult: 1.60, eq_real_bonus: -0.06, fold_freq_mult: 0.72 }
    }
}

/// Apply equity realization bonus from stack scaling (clamped to 1.0)
fn scaled_eq_real(base: f32, bonus: f32) -> f32 {
    (base + bonus).min(1.0)
}

// ---------------------------------------------------------------------------
// Payoff model
// ---------------------------------------------------------------------------

/// Payoff parameters computed from spot config.
/// All values in BB units, from hero's perspective at the decision point.
pub struct SpotPayoffs {
    /// EV of folding (always 0 — we measure incremental EV)
    pub fold_ev: f32,

    // --- Call path ---
    /// Cost to call
    pub call_cost: f32,
    /// Total pot if hero calls (hero + villain contributions)
    pub call_pot: f32,
    /// Equity realization multiplier for the call path
    pub call_eq_realization: f32,

    // --- Raise path ---
    /// Hero's raise investment
    pub raise_cost: f32,
    /// Pot hero wins when villain folds to raise
    pub raise_fold_pot: f32,
    /// How often villain folds to our raise (position/context dependent)
    pub villain_fold_freq: f32,
    /// Total pot when raise is called (hero + villain)
    pub raise_call_pot: f32,
    /// Equity realization when our raise is called
    pub raise_eq_realization: f32,
    /// Probability villain 3bets/4bets/jams over our raise (hero usually folds)
    pub villain_reraise_freq: f32,
    /// How much hero loses when facing a reraise and folding
    pub reraise_loss: f32,
}

impl SpotPayoffs {
    pub fn from_config(config: &SpotConfig) -> Self {
        let stack = config.stack_depth;
        let sc = stack_scaling(stack);

        match config.action_context {
            ActionContext::Rfi => {
                let open_size = rfi_size(stack);
                let n = config.num_opponents;

                // Per-opponent base rates scale with position:
                // Fewer opponents → each defends wider (blinds defend aggressively vs steals)
                let (base_defend, base_3bet, base_eq): (f32, f32, f32) = match n {
                    1 => (0.58, 0.14, 0.68),  // SB vs BB: BB defends very wide
                    2 => (0.38, 0.09, 0.82),  // BTN vs blinds: IP advantage
                    3 => (0.28, 0.06, 0.72),  // CO: moderate defense
                    4 => (0.22, 0.05, 0.68),  // MP: tighter defense
                    _ => (0.18, 0.04, 0.64),  // UTG: tightest defense
                };

                // Apply stack-depth scaling
                let per_opp_defend = (base_defend * sc.defend_mult).min(0.70);
                let per_opp_3bet = (base_3bet * sc.reraise_mult).min(0.25);
                let eq_real = scaled_eq_real(base_eq, sc.eq_real_bonus);

                let nf = n as f32;
                let all_fold = (1.0 - per_opp_defend).powf(nf);
                let any_3bet = 1.0 - (1.0 - per_opp_3bet).powf(nf);

                SpotPayoffs {
                    fold_ev: 0.0,
                    call_cost: 0.0,
                    call_pot: 0.0,
                    call_eq_realization: 0.0,
                    raise_cost: open_size,
                    raise_fold_pot: 1.5,
                    villain_fold_freq: all_fold,
                    raise_call_pot: 1.5 + open_size * 2.0,
                    raise_eq_realization: eq_real,
                    villain_reraise_freq: any_3bet,
                    reraise_loss: open_size,
                }
            }
            ActionContext::VsRaise => {
                let open_size = rfi_size(stack);
                let three_bet_size = three_bet_size(stack, open_size);

                // Stack-scaled villain behavior
                let base_fold = 0.55;  // Opener folds ~55% to 3bet at 100bb
                let base_4bet = 0.12;  // Opener 4bets ~12% at 100bb
                let villain_fold = config.villain_fold_override
                    .unwrap_or(base_fold * sc.fold_freq_mult);
                let villain_4bet = (base_4bet * sc.reraise_mult).min(0.35);

                // Ensure fold + 4bet <= 1.0
                let total = villain_fold + villain_4bet;
                let (vf, v4) = if total > 0.95 {
                    let ratio = 0.95 / total;
                    (villain_fold * ratio, villain_4bet * ratio)
                } else {
                    (villain_fold, villain_4bet)
                };

                SpotPayoffs {
                    fold_ev: 0.0,
                    call_cost: open_size,
                    call_pot: 1.5 + open_size * 2.0,
                    call_eq_realization: config.call_eq_override
                        .unwrap_or_else(|| scaled_eq_real(0.75, sc.eq_real_bonus)),
                    raise_cost: three_bet_size,
                    raise_fold_pot: 1.5 + open_size,
                    villain_fold_freq: vf,
                    raise_call_pot: 1.5 + three_bet_size * 2.0,
                    raise_eq_realization: config.raise_eq_override
                        .unwrap_or_else(|| scaled_eq_real(0.78, sc.eq_real_bonus)),
                    villain_reraise_freq: v4,
                    reraise_loss: three_bet_size,
                }
            }
            ActionContext::Vs3Bet => {
                let open_size = rfi_size(stack);
                let three_bet_size = three_bet_size(stack, open_size);
                let four_bet_size = four_bet_size(stack, three_bet_size);
                let is_allin = (four_bet_size - stack).abs() < 0.01;

                // Stack-scaled villain behavior
                let base_fold = 0.50;
                let base_5bet = if is_allin { 0.0 } else { 0.20 };
                let villain_fold = config.villain_fold_override
                    .unwrap_or(base_fold * sc.fold_freq_mult);
                let villain_5bet = if is_allin { 0.0 } else { (base_5bet * sc.reraise_mult).min(0.30) };

                let total = villain_fold + villain_5bet;
                let (vf, v5) = if total > 0.95 {
                    let ratio = 0.95 / total;
                    (villain_fold * ratio, villain_5bet * ratio)
                } else {
                    (villain_fold, villain_5bet)
                };

                SpotPayoffs {
                    fold_ev: 0.0,
                    call_cost: three_bet_size - open_size,
                    call_pot: 1.5 + three_bet_size * 2.0,
                    call_eq_realization: config.call_eq_override
                        .unwrap_or_else(|| scaled_eq_real(0.65, sc.eq_real_bonus)),
                    raise_cost: four_bet_size - open_size,
                    raise_fold_pot: 1.5 + open_size + three_bet_size,
                    villain_fold_freq: vf,
                    raise_call_pot: if is_allin { stack * 2.0 + 1.5 } else { 1.5 + four_bet_size * 2.0 },
                    raise_eq_realization: config.raise_eq_override
                        .unwrap_or_else(|| if is_allin { 1.0 } else { scaled_eq_real(0.65, sc.eq_real_bonus) }),
                    villain_reraise_freq: v5,
                    reraise_loss: four_bet_size - open_size,
                }
            }
            ActionContext::Vs4Bet => {
                let open_size = rfi_size(stack);
                let three_bet_size = three_bet_size(stack, open_size);
                let four_bet_size = four_bet_size(stack, three_bet_size);

                // Hero's 5bet is always jam at this point
                let base_fold = 0.30;
                let villain_fold = config.villain_fold_override
                    .unwrap_or(base_fold * sc.fold_freq_mult);

                SpotPayoffs {
                    fold_ev: 0.0,
                    call_cost: four_bet_size - three_bet_size,
                    call_pot: 1.5 + four_bet_size * 2.0,
                    call_eq_realization: config.call_eq_override
                        .unwrap_or_else(|| scaled_eq_real(0.62, sc.eq_real_bonus)),
                    raise_cost: stack - three_bet_size,
                    raise_fold_pot: 1.5 + three_bet_size + four_bet_size,
                    villain_fold_freq: villain_fold,
                    raise_call_pot: stack * 2.0 + 1.5,
                    raise_eq_realization: 1.0,
                    villain_reraise_freq: 0.0,
                    reraise_loss: 0.0,
                }
            }
        }
    }

    /// EV of calling with given equity vs villain's range
    pub fn call_ev(&self, equity: f32) -> f32 {
        equity * self.call_eq_realization * self.call_pot - self.call_cost
    }

    /// EV of raising with given equity vs villain's continuing range
    pub fn raise_ev(&self, equity_vs_continue: f32) -> f32 {
        // Three outcomes:
        // 1. Villain folds → win the pot
        let fold_ev = self.villain_fold_freq * self.raise_fold_pot;
        // 2. Villain calls → equity battle
        let call_freq = 1.0 - self.villain_fold_freq - self.villain_reraise_freq;
        let call_ev = call_freq * (equity_vs_continue * self.raise_eq_realization * self.raise_call_pot - self.raise_cost);
        // 3. Villain re-raises → hero usually folds (loses raise investment)
        let reraise_ev = self.villain_reraise_freq * (-self.reraise_loss);

        fold_ev + call_ev + reraise_ev
    }
}

/// Standard open raise size based on stack depth
fn rfi_size(stack_bb: f32) -> f32 {
    if stack_bb <= 15.0 { 2.0 }
    else if stack_bb <= 25.0 { 2.2 }
    else { 2.5 }
}

fn three_bet_size(stack_bb: f32, open_size: f32) -> f32 {
    if stack_bb <= 20.0 { (open_size * 2.5).min(stack_bb) }
    else if stack_bb <= 40.0 { open_size * 3.0 }
    else { open_size * 3.5 }
}

fn four_bet_size(stack_bb: f32, three_bet: f32) -> f32 {
    if stack_bb <= 25.0 { stack_bb }
    else { (three_bet * 2.5).min(stack_bb) }
}

/// Determine available actions for a given context
pub fn available_actions(context: ActionContext) -> Vec<Action> {
    match context {
        ActionContext::Rfi => vec![Action::Fold, Action::Raise],
        _ => vec![Action::Fold, Action::Call, Action::Raise],
    }
}
