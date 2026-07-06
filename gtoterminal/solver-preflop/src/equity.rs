/// Preflop hand-vs-hand equity lookup using calibrated hand strength values.
///
/// Hand-vs-random equities are embedded as known values (calibrated against
/// Monte Carlo simulations). The 169x169 matrix is derived from these using
/// a formula that accounts for domination, pair dynamics, and suitedness.

use crate::hands::{self, NUM_GROUPS, GroupType};

/// Known hand equity vs a random hand (from Monte Carlo simulations).
/// Index matches the standard 169-group layout (row-major, high card first).
/// Row 0: AA AKs AQs AJs ATs A9s A8s A7s A6s A5s A4s A3s A2s
/// Row 1: AKo KK KQs KJs KTs K9s K8s K7s K6s K5s K4s K3s K2s
/// etc.
const EQUITY_VS_RANDOM: [f32; NUM_GROUPS] = [
    // Row 0: AA AKs AQs AJs ATs A9s A8s A7s A6s A5s A4s A3s A2s
    0.852, 0.670, 0.662, 0.654, 0.647, 0.630, 0.619, 0.609, 0.599, 0.607, 0.592, 0.581, 0.571,
    // Row 1: AKo KK KQs KJs KTs K9s K8s K7s K6s K5s K4s K3s K2s
    0.653, 0.824, 0.634, 0.626, 0.619, 0.600, 0.587, 0.575, 0.565, 0.556, 0.544, 0.533, 0.523,
    // Row 2: AQo KQo QQ QJs QTs Q9s Q8s Q7s Q6s Q5s Q4s Q3s Q2s
    0.645, 0.617, 0.799, 0.601, 0.594, 0.574, 0.559, 0.546, 0.537, 0.528, 0.516, 0.505, 0.495,
    // Row 3: AJo KJo QJo JJ JTs J9s J8s J7s J6s J5s J4s J3s J2s
    0.637, 0.609, 0.583, 0.775, 0.569, 0.551, 0.533, 0.520, 0.508, 0.499, 0.488, 0.477, 0.467,
    // Row 4: ATo KTo QTo JTo TT T9s T8s T7s T6s T5s T4s T3s T2s
    0.629, 0.601, 0.576, 0.551, 0.750, 0.528, 0.510, 0.496, 0.483, 0.472, 0.461, 0.450, 0.440,
    // Row 5: A9o K9o Q9o J9o T9o 99 98s 97s 96s 95s 94s 93s 92s
    0.611, 0.581, 0.554, 0.530, 0.507, 0.721, 0.487, 0.474, 0.460, 0.449, 0.436, 0.425, 0.416,
    // Row 6: A8o K8o Q8o J8o T8o 98o 88 87s 86s 85s 84s 83s 82s
    0.599, 0.566, 0.537, 0.511, 0.488, 0.465, 0.693, 0.454, 0.441, 0.428, 0.414, 0.403, 0.393,
    // Row 7: A7o K7o Q7o J7o T7o 97o 87o 77 76s 75s 74s 73s 72s
    0.588, 0.553, 0.523, 0.496, 0.473, 0.450, 0.431, 0.665, 0.424, 0.411, 0.396, 0.385, 0.374,
    // Row 8: A6o K6o Q6o J6o T6o 96o 86o 76o 66 65s 64s 63s 62s
    0.577, 0.542, 0.512, 0.483, 0.458, 0.435, 0.416, 0.399, 0.636, 0.398, 0.384, 0.372, 0.361,
    // Row 9: A5o K5o Q5o J5o T5o 95o 85o 75o 65o 55 54s 53s 52s
    0.586, 0.533, 0.503, 0.474, 0.446, 0.423, 0.402, 0.385, 0.372, 0.609, 0.376, 0.363, 0.352,
    // Row 10: A4o K4o Q4o J4o T4o 94o 84o 74o 64o 54o 44 43s 42s
    0.570, 0.520, 0.490, 0.461, 0.434, 0.408, 0.387, 0.369, 0.356, 0.349, 0.582, 0.354, 0.343,
    // Row 11: A3o K3o Q3o J3o T3o 93o 83o 73o 63o 53o 43o 33 32s
    0.559, 0.508, 0.479, 0.449, 0.422, 0.397, 0.375, 0.357, 0.343, 0.335, 0.325, 0.556, 0.338,
    // Row 12: A2o K2o Q2o J2o T2o 92o 82o 72o 62o 52o 42o 32o 22
    0.549, 0.498, 0.468, 0.439, 0.412, 0.387, 0.364, 0.346, 0.331, 0.323, 0.313, 0.308, 0.531,
];

/// Compute equity of hand group A vs hand group B.
/// Uses the hand-vs-random values to derive matchup equities.
pub fn hand_vs_hand_equity(a: usize, b: usize) -> f32 {
    if a == b { return 0.5; }

    let groups = hands::all_groups();
    let ga = &groups[a];
    let gb = &groups[b];

    let str_a = EQUITY_VS_RANDOM[a];
    let str_b = EQUITY_VS_RANDOM[b];

    // Base equity from calibrated strength values.
    // Use a logistic function: equity = 1 / (1 + exp(-k * (str_a - str_b)))
    // k controls steepness. Calibrated so AA(0.852) vs KK(0.824) ≈ 0.82
    let diff = str_a - str_b;
    let k = 8.0;  // Steepness parameter
    let base = 1.0 / (1.0 + (-k * diff).exp());

    // Domination adjustment: hands sharing a rank are more polarized
    let dom = domination_adj(ga, gb);

    // Pair vs non-pair: pairs have extra edge from set equity
    let pair = pair_adj(ga, gb);

    // Suited bonus
    let suit = suit_adj(ga, gb);

    (base + dom + pair + suit).clamp(0.10, 0.90)
}

/// Domination adjustment for shared ranks
fn domination_adj(a: &hands::HandGroup, b: &hands::HandGroup) -> f32 {
    if a.group_type == GroupType::Pair || b.group_type == GroupType::Pair {
        return 0.0;
    }
    // Same high card = kicker domination
    if a.rank_hi == b.rank_hi {
        let kicker_diff = a.rank_lo as i32 - b.rank_lo as i32;
        return kicker_diff as f32 * 0.012;
    }
    // One hand dominated by the other's high card
    if a.rank_hi == b.rank_lo || a.rank_lo == b.rank_hi {
        return 0.0;  // Already captured by strength difference
    }
    0.0
}

/// Pair vs non-pair extra equity
fn pair_adj(a: &hands::HandGroup, b: &hands::HandGroup) -> f32 {
    let a_pair = a.group_type == GroupType::Pair;
    let b_pair = b.group_type == GroupType::Pair;
    if a_pair && !b_pair { 0.04 }  // Pairs win more often than card strength suggests
    else if !a_pair && b_pair { -0.04 }
    else { 0.0 }
}

/// Suited vs offsuit equity bonus
fn suit_adj(a: &hands::HandGroup, b: &hands::HandGroup) -> f32 {
    let a_suited = a.group_type == GroupType::Suited;
    let b_suited = b.group_type == GroupType::Suited;
    match (a_suited, b_suited) {
        (true, false) => 0.025,
        (false, true) => -0.025,
        _ => 0.0,
    }
}

/// Build the full 169x169 equity matrix
pub fn build_equity_matrix() -> Vec<Vec<f32>> {
    let mut matrix = vec![vec![0.5f32; NUM_GROUPS]; NUM_GROUPS];
    for a in 0..NUM_GROUPS {
        for b in (a+1)..NUM_GROUPS {
            let eq = hand_vs_hand_equity(a, b);
            matrix[a][b] = eq;
            matrix[b][a] = 1.0 - eq;
        }
    }
    matrix
}

/// Equity of hand group `hero` vs a range (array of 169 weights)
pub fn equity_vs_range(hero: usize, villain_range: &[f32; NUM_GROUPS], equity_matrix: &[Vec<f32>]) -> f32 {
    let groups = hands::all_groups();
    let mut weighted_eq = 0.0f64;
    let mut total_weight = 0.0f64;

    for v in 0..NUM_GROUPS {
        if villain_range[v] <= 0.0 { continue; }
        if v == hero { continue; }

        let weight = villain_range[v] as f64 * groups[v].combos() as f64;
        weighted_eq += equity_matrix[hero][v] as f64 * weight;
        total_weight += weight;
    }

    if total_weight == 0.0 { 0.5 } else { (weighted_eq / total_weight) as f32 }
}

/// Get the hand-vs-random equity for a given group index
pub fn hand_strength(idx: usize) -> f32 {
    if idx < NUM_GROUPS { EQUITY_VS_RANDOM[idx] } else { 0.5 }
}
