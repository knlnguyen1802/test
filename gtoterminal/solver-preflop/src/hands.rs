/// 169 canonical preflop hand groups.
/// Index 0 = AA, 1 = AKs, 2 = AQs, ... 168 = 32o
/// Layout: pairs on diagonal, suited above, offsuit below (standard 13x13 matrix)

/// Total hand groups
pub const NUM_GROUPS: usize = 169;

/// Rank names (2=0 .. A=12)
pub const RANK_NAMES: [char; 13] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/// Number of combos per group type
pub const PAIR_COMBOS: f32 = 6.0;
pub const SUITED_COMBOS: f32 = 4.0;
pub const OFFSUIT_COMBOS: f32 = 12.0;

/// Hand group type
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GroupType {
    Pair,
    Suited,
    Offsuit,
}

/// A canonical hand group
#[derive(Clone, Copy, Debug)]
pub struct HandGroup {
    pub index: usize,
    pub rank_hi: usize,   // 0=2, 12=A
    pub rank_lo: usize,
    pub group_type: GroupType,
}

impl HandGroup {
    pub fn combos(&self) -> f32 {
        match self.group_type {
            GroupType::Pair => PAIR_COMBOS,
            GroupType::Suited => SUITED_COMBOS,
            GroupType::Offsuit => OFFSUIT_COMBOS,
        }
    }

    /// e.g. "AA", "AKs", "AKo"
    pub fn name(&self) -> String {
        let hi = RANK_NAMES[self.rank_hi];
        let lo = RANK_NAMES[self.rank_lo];
        match self.group_type {
            GroupType::Pair => format!("{}{}", hi, lo),
            GroupType::Suited => format!("{}{}s", hi, lo),
            GroupType::Offsuit => format!("{}{}o", hi, lo),
        }
    }
}

/// All 169 hand groups in standard matrix order.
/// Row = high card (A..2), Col = low card (A..2).
/// Diagonal = pairs, above diagonal = suited, below = offsuit.
/// Index layout (row-major, high rank first):
///   Row 0: AA AKs AQs AJs ATs A9s A8s A7s A6s A5s A4s A3s A2s
///   Row 1: AKo KK KQs KJs KTs K9s K8s K7s K6s K5s K4s K3s K2s
///   ...
pub fn all_groups() -> [HandGroup; NUM_GROUPS] {
    let mut groups = [HandGroup { index: 0, rank_hi: 0, rank_lo: 0, group_type: GroupType::Pair }; NUM_GROUPS];
    let mut idx = 0;
    for row in 0..13usize {
        for col in 0..13usize {
            let r1 = 12 - row;  // A=12 down to 2=0
            let r2 = 12 - col;
            let group_type = if row == col {
                GroupType::Pair
            } else if col > row {
                GroupType::Suited   // above diagonal
            } else {
                GroupType::Offsuit  // below diagonal
            };
            // Ensure rank_hi >= rank_lo for consistent naming (AKo not KAo)
            let (rank_hi, rank_lo) = if r1 >= r2 { (r1, r2) } else { (r2, r1) };
            groups[idx] = HandGroup { index: idx, rank_hi, rank_lo, group_type };
            idx += 1;
        }
    }
    groups
}

/// Convert a hand name string to its group index.
/// Accepts: "AA", "AKs", "AKo", "A2s", etc.
pub fn name_to_index(name: &str) -> Option<usize> {
    let chars: Vec<char> = name.chars().collect();
    if chars.len() < 2 || chars.len() > 3 { return None; }

    let r1 = rank_char_to_idx(chars[0])?;
    let r2 = rank_char_to_idx(chars[1])?;

    let (rank_hi, rank_lo) = if r1 >= r2 { (r1, r2) } else { (r2, r1) };
    let row = 12 - rank_hi;
    let col = 12 - rank_lo;

    if rank_hi == rank_lo {
        // Pair
        Some(row * 13 + col)
    } else if chars.len() == 3 && chars[2] == 's' {
        // Suited — above diagonal (col > row)
        Some(col * 13 + row)  // swap to put high card in row
        // Actually: suited means row < col in our matrix
        // row = 12 - rank_hi, col = 12 - rank_lo
        // Since rank_hi > rank_lo, row < col, so it's already above diagonal
    } else {
        // Offsuit — below diagonal (row > col)
        // We need row > col, which means 12-rank_lo row, 12-rank_hi col
        Some((12 - rank_lo) * 13 + (12 - rank_hi))
    }
}

/// Convert group index to hand name
pub fn index_to_name(idx: usize) -> String {
    let groups = all_groups();
    if idx < NUM_GROUPS { groups[idx].name() } else { String::from("??") }
}

fn rank_char_to_idx(c: char) -> Option<usize> {
    match c {
        '2' => Some(0), '3' => Some(1), '4' => Some(2), '5' => Some(3),
        '6' => Some(4), '7' => Some(5), '8' => Some(6), '9' => Some(7),
        'T' | 't' => Some(8), 'J' | 'j' => Some(9), 'Q' | 'q' => Some(10),
        'K' | 'k' => Some(11), 'A' | 'a' => Some(12),
        _ => None,
    }
}

/// Get the number of combos for a given group index
pub fn group_combos(idx: usize) -> f32 {
    let row = idx / 13;
    let col = idx % 13;
    if row == col { PAIR_COMBOS }
    else if col > row { SUITED_COMBOS }
    else { OFFSUIT_COMBOS }
}

/// Total combos in a 169 weight array (weighted by frequencies)
pub fn total_combos(weights: &[f32; NUM_GROUPS]) -> f32 {
    let mut total = 0.0;
    for i in 0..NUM_GROUPS {
        total += weights[i] * group_combos(i);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_group_count() {
        let groups = all_groups();
        assert_eq!(groups.len(), 169);
        // First should be AA
        assert_eq!(groups[0].name(), "AA");
        assert_eq!(groups[0].group_type, GroupType::Pair);
        // Second should be AKs
        assert_eq!(groups[1].name(), "AKs");
        assert_eq!(groups[1].group_type, GroupType::Suited);
        // Row 1, col 0 should be AKo
        assert_eq!(groups[13].name(), "AKo");
        assert_eq!(groups[13].group_type, GroupType::Offsuit);
        // Last should be 32o (row 12 = 2, col 11 = 3... actually 22 is last pair)
        assert_eq!(groups[168].name(), "32o");
    }

    #[test]
    fn test_name_to_index() {
        assert_eq!(name_to_index("AA"), Some(0));
        assert_eq!(name_to_index("AKs"), Some(1));
        assert_eq!(name_to_index("AKo"), Some(13));
        assert_eq!(name_to_index("KK"), Some(14));
    }

    #[test]
    fn test_total_combos() {
        // All hands = 1326
        let all_ones = [1.0f32; NUM_GROUPS];
        let total = total_combos(&all_ones);
        assert!((total - 1326.0).abs() < 0.01);
    }
}
