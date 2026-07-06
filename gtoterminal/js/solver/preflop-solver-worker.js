// GTOTerminal — Preflop Solver Web Worker (ES Module)
// Runs the preflop CFR+ WASM solver in a background thread

import init, { PreflopSolver } from './preflop-pkg/preflop_solver_wasm.js';

let solver = null;

async function initSolver() {
  await init();
  solver = new PreflopSolver();
  return true;
}

self.onmessage = async function(e) {
  var msg = e.data;
  var type = msg.type;

  try {
    if (type === 'init') {
      await initSolver();
      self.postMessage({ type: 'init', success: true });
    }

    else if (type === 'solve') {
      var config = msg.config;
      var maxIterations = msg.maxIterations || 3000;
      var targetExploitability = msg.targetExploitability || 0.005;

      // Setup the spot
      var error = solver.setup(JSON.stringify(config));
      if (error) {
        self.postMessage({ type: 'solve', success: false, error: error });
        return;
      }

      // Solve in batches with progress reporting
      var batchSize = 100;
      var totalIters = 0;

      while (totalIters < maxIterations) {
        var remaining = maxIterations - totalIters;
        var batch = Math.min(batchSize, remaining);
        var iters = solver.solve_step(batch);
        totalIters += batch;

        var exploit = solver.exploitability();

        self.postMessage({
          type: 'progress',
          iterations: totalIters,
          exploitability: exploit
        });

        if (exploit < targetExploitability) break;
      }

      // Get results
      var results = solver.get_results();
      var compact = solver.get_results_compact();
      var raiseCombos = solver.raise_combos();
      var exploit = solver.exploitability();

      self.postMessage({
        type: 'solve',
        success: true,
        results: results,
        compact: compact,
        raiseCombos: raiseCombos,
        iterations: totalIters,
        exploitability: exploit
      });
    }

  } catch (err) {
    self.postMessage({ type: msg.type, success: false, error: err.toString() });
  }
};
