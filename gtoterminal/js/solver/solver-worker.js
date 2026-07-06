// GTOTerminal — Solver Web Worker (ES Module)
// Runs the postflop-solver WASM module in a background thread

import init, { GameManager } from './pkg/gto_solver_wasm.js';

let manager = null;

async function initSolver() {
  await init();
  manager = GameManager.new();
  return true;
}

// Handle messages from the main thread
self.onmessage = async function(e) {
  var msg = e.data;
  var type = msg.type;

  try {
    if (type === 'init') {
      await initSolver();
      self.postMessage({ type: 'init', success: true });
    }

    else if (type === 'setup') {
      var d = msg.data;
      var error = manager.init(
        new Float32Array(d.oopRange),
        new Float32Array(d.ipRange),
        new Uint8Array(d.board),
        d.startingPot,
        d.effectiveStack,
        d.rakeRate || 0,
        d.rakeCap || 0,
        d.donkOption || false,
        d.oopFlopBet || '33%,67%',
        d.oopFlopRaise || '60%',
        d.oopTurnBet || '33%,67%',
        d.oopTurnRaise || '60%',
        d.oopTurnDonk || '',
        d.oopRiverBet || '33%,67%,100%',
        d.oopRiverRaise || '60%',
        d.oopRiverDonk || '',
        d.ipFlopBet || '33%,67%',
        d.ipFlopRaise || '60%',
        d.ipTurnBet || '33%,67%',
        d.ipTurnRaise || '60%',
        d.ipRiverBet || '33%,67%,100%',
        d.ipRiverRaise || '60%',
        d.addAllinThreshold || 1.5,
        d.forceAllinThreshold || 0.15,
        d.mergingThreshold || 0.1,
        d.addedLines || '',
        d.removedLines || ''
      );

      if (error) {
        self.postMessage({ type: 'setup', success: false, error: error });
      } else {
        var memUsage = manager.memory_usage(true);
        self.postMessage({ type: 'setup', success: true, memoryMB: Math.round(Number(memUsage) / 1024 / 1024) });
      }
    }

    else if (type === 'allocate') {
      manager.allocate_memory(msg.compress !== false);
      self.postMessage({ type: 'allocate', success: true });
    }

    else if (type === 'solve') {
      var maxIter = msg.maxIterations || 200;
      var targetExploit = msg.targetExploitability || 0.5;
      var startingPot = msg.startingPot || 100;
      var target = startingPot * targetExploit / 100;

      var iteration = 0;
      var exploit = manager.exploitability();

      self.postMessage({ type: 'progress', iteration: 0, exploitability: exploit, target: target });

      while (iteration < maxIter && exploit > target) {
        var batchSize = iteration < 20 ? 1 : 10;
        for (var i = 0; i < batchSize && iteration < maxIter; i++) {
          manager.solve_step(iteration);
          iteration++;
        }

        exploit = manager.exploitability();

        self.postMessage({
          type: 'progress',
          iteration: iteration,
          exploitability: exploit,
          target: target,
          pctDone: Math.min(100, Math.round((1 - exploit / (startingPot * 5 / 100)) * 100))
        });
      }

      manager.finalize();
      self.postMessage({
        type: 'solve',
        success: true,
        iterations: iteration,
        exploitability: exploit
      });
    }

    else if (type === 'getResults') {
      if (msg.history && msg.history.length > 0) {
        manager.apply_history(new Uint32Array(msg.history));
      }

      var results = manager.get_results();
      var actions = manager.actions();
      var player = manager.current_player();
      var numActions = manager.num_actions();
      var oopCards = manager.private_cards(0);
      var ipCards = manager.private_cards(1);

      self.postMessage({
        type: 'getResults',
        results: Array.from(results),
        actions: actions,
        player: player,
        numActions: numActions,
        oopCards: Array.from(oopCards),
        ipCards: Array.from(ipCards)
      });
    }

    else if (type === 'navigate') {
      manager.apply_history(new Uint32Array(msg.history));
      self.postMessage({
        type: 'navigate',
        actions: manager.actions(),
        player: manager.current_player()
      });
    }

  } catch (err) {
    self.postMessage({ type: msg.type, success: false, error: err.toString() });
  }
};
