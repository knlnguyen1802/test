window.GTO = window.GTO || {};
GTO.Training = GTO.Training || {};

GTO.Training.PlanTemplates = [
  {
    id: 'mtt_fundamentals',
    name: 'MTT Fundamentals',
    description: 'Complete tournament training covering all essential skills over 4 weeks',
    duration: '4 weeks',
    sessionsPerWeek: 5,
    format: 'mtt',
    focusAreas: ['preflop_rfi', 'preflop_defense', 'push_fold', 'icm', 'postflop_cbet'],
    sessions: [
      { day: 1, drills: [{ type: 'preflop', subtype: 'rfi', count: 30 }, { type: 'preflop', subtype: 'vs_raise', count: 20 }] },
      { day: 2, drills: [{ type: 'postflop', subtype: 'IP_cbet_flop', count: 25 }, { type: 'postflop', subtype: 'OOP_facing_cbet', count: 25 }] },
      { day: 3, drills: [{ type: 'tournament', subtype: 'push_fold', count: 30, config: { stackMin: 8, stackMax: 15 } }] },
      { day: 4, drills: [{ type: 'preflop', subtype: 'vs_3bet', count: 25 }, { type: 'preflop', subtype: 'rfi', count: 25, config: { stackDepths: ['40bb','25bb'] } }] },
      { day: 5, drills: [{ type: 'tournament', subtype: 'push_fold', count: 20, config: { stackMin: 3, stackMax: 10 } }, { type: 'postflop', subtype: 'IP_turn_barrel', count: 20 }] }
    ]
  },
  {
    id: 'cash_grinder',
    name: 'Cash Game Grinder',
    description: 'Intensive 2-week cash game training focused on 6-max 100bb play',
    duration: '2 weeks',
    sessionsPerWeek: 5,
    format: 'cash',
    focusAreas: ['preflop_rfi', 'preflop_3bet', 'postflop_cbet', 'postflop_barrels'],
    sessions: [
      { day: 1, drills: [{ type: 'preflop', subtype: 'rfi', count: 40, config: { stackDepths: ['100bb'] } }] },
      { day: 2, drills: [{ type: 'preflop', subtype: 'vs_raise', count: 30 }, { type: 'preflop', subtype: 'vs_3bet', count: 20 }] },
      { day: 3, drills: [{ type: 'postflop', subtype: 'IP_cbet_flop', count: 30 }, { type: 'postflop', subtype: 'OOP_cbet_flop', count: 20 }] },
      { day: 4, drills: [{ type: 'postflop', subtype: 'IP_facing_cbet', count: 25 }, { type: 'postflop', subtype: 'IP_turn_barrel', count: 25 }] },
      { day: 5, drills: [{ type: 'playthrough', count: 10 }] }
    ]
  },
  {
    id: 'tournament_prep',
    name: 'Tournament Prep',
    description: 'Customizable plan targeting a specific tournament date',
    duration: 'Custom',
    sessionsPerWeek: 5,
    format: 'mtt',
    focusAreas: ['preflop_rfi', 'push_fold', 'icm', 'postflop_cbet', 'bb_defense'],
    sessions: [
      { day: 1, drills: [{ type: 'preflop', subtype: 'rfi', count: 30, config: { format: 'mtt' } }, { type: 'preflop', subtype: 'vs_raise', count: 20 }] },
      { day: 2, drills: [{ type: 'tournament', subtype: 'push_fold', count: 30 }] },
      { day: 3, drills: [{ type: 'postflop', subtype: 'IP_cbet_flop', count: 25 }, { type: 'postflop', subtype: 'OOP_facing_cbet', count: 25 }] },
      { day: 4, drills: [{ type: 'preflop', subtype: 'vs_3bet', count: 25 }, { type: 'preflop', subtype: 'rfi', count: 25, config: { stackDepths: ['25bb','15bb'] } }] },
      { day: 5, drills: [{ type: 'tournament', subtype: 'push_fold', count: 20, config: { stackMin: 3, stackMax: 8 } }, { type: 'playthrough', count: 5 }] }
    ]
  },
  {
    id: 'leak_plugger',
    name: 'Leak Plugger',
    description: 'Auto-generated plan based on your weakest areas',
    duration: '1 week',
    sessionsPerWeek: 5,
    format: 'auto',
    focusAreas: ['auto'],
    sessions: [] // Generated dynamically from weakness analysis
  }
];
