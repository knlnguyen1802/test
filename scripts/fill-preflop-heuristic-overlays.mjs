import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const posIndex = new Map(positions.map((p, i) => [p, i]));
const spots = ['vs_raise', 'vs_3bet', 'vs_4bet'];

const basePath = path.join(root, 'gtoterminal', 'preflop-lookup', 'preflop-ranges.js');
const outInputLookupPath = path.join(root, 'gtoterminal', 'preflop-lookup', 'preflop-ranges-heuristic-for-input.js');
const outSolutionLookupPath = path.join(root, 'gtoterminal', 'preflop-lookup', 'preflop-ranges-heuristic-for-solution.js');
const outInputDataPath = path.join(root, 'gtoterminal', 'js', 'data', 'preflop-ranges-heuristic-for-input.js');
const outSolutionDataPath = path.join(root, 'gtoterminal', 'js', 'data', 'preflop-ranges-heuristic-for-solution.js');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ringDistance(i, j, n = 6) {
  const diff = Math.abs(i - j);
  return Math.min(diff, n - diff);
}

function parseMatchupKey(key) {
  const idx = key.indexOf('_');
  if (idx === -1) return null;
  const hero = key.slice(0, idx);
  const villain = key.slice(idx + 1);
  if (!posIndex.has(hero) || !posIndex.has(villain) || hero === villain) return null;
  return { hero, villain };
}

function getAllOrderedPairs() {
  const keys = [];
  for (const hero of positions) {
    for (const villain of positions) {
      if (hero !== villain) {
        keys.push(`${hero}_${villain}`);
      }
    }
  }
  return keys;
}

function getAllowedPairsForSpot(spot) {
  // Keys are aggressor-first. For vs_raise, only earlier->later positions are feasible.
  if (spot === 'vs_raise') {
    const keys = [];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        keys.push(`${positions[i]}_${positions[j]}`);
      }
    }
    return keys;
  }

  // For vs_3bet and vs_4bet, all ordered pairs may occur.
  return getAllOrderedPairs();
}

function pickDonor(existingEntries, missingKey) {
  const parsedMissing = parseMatchupKey(missingKey);
  if (!parsedMissing) return null;

  const candidates = [];
  for (const donorKey of Object.keys(existingEntries)) {
    const parsedDonor = parseMatchupKey(donorKey);
    if (!parsedDonor) continue;

    const heroDist = ringDistance(posIndex.get(parsedMissing.hero), posIndex.get(parsedDonor.hero));
    const villainDist = ringDistance(posIndex.get(parsedMissing.villain), posIndex.get(parsedDonor.villain));
    const score = heroDist + villainDist;
    const sameHero = parsedMissing.hero === parsedDonor.hero ? 1 : 0;
    const sameVillain = parsedMissing.villain === parsedDonor.villain ? 1 : 0;

    candidates.push({ donorKey, score, sameHero, sameVillain });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.sameHero !== b.sameHero) return b.sameHero - a.sameHero;
    if (a.sameVillain !== b.sameVillain) return b.sameVillain - a.sameVillain;
    return a.donorKey.localeCompare(b.donorKey);
  });

  return candidates[0].donorKey;
}

function enforceNoColdCalls(entry) {
  const out = deepClone(entry);

  if (Array.isArray(out.pure_call)) {
    out.pure_call = [];
  }

  if (out.mixed && typeof out.mixed === 'object') {
    for (const hand of Object.keys(out.mixed)) {
      const v = out.mixed[hand];
      if (!Array.isArray(v) || v.length !== 3) continue;

      const fold = Number(v[0]) || 0;
      const raise = Number(v[2]) || 0;
      const sum = fold + raise;

      if (sum > 0) {
        out.mixed[hand] = [fold / sum, 0, raise / sum];
      } else {
        out.mixed[hand] = [1, 0, 0];
      }
    }
  }

  return out;
}

function ensurePath(obj, keys) {
  let cur = obj;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(cur, key)) {
      cur[key] = {};
    }
    cur = cur[key];
  }
  return cur;
}

function loadBaseRanges(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const gtoRoot = {};
  const context = {
    window: { GTO: gtoRoot },
    GTO: gtoRoot,
    console,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: filePath });

  const gto = context.window.GTO || context.GTO;
  if (!gto || !gto.Data || !gto.Data.PreflopRanges) {
    throw new Error('Failed to load GTO.Data.PreflopRanges from base source file');
  }

  return gto.Data.PreflopRanges;
}

function buildOverlays(baseRanges) {
  const inputOverlay = {};
  const solutionOverlay = {};
  const counts = {
    input: {},
    solution: {},
  };

  for (const gameType of Object.keys(baseRanges)) {
    const stacks = baseRanges[gameType] || {};

    for (const stack of Object.keys(stacks)) {
      const stackNode = stacks[stack] || {};

      for (const spot of spots) {
        const spotNode = stackNode[spot];
        if (!spotNode || typeof spotNode !== 'object') {
          continue;
        }

        const allowedPairs = getAllowedPairsForSpot(spot);
        const existingKeys = new Set(Object.keys(spotNode));
        const missingKeys = allowedPairs.filter((k) => !existingKeys.has(k));
        if (missingKeys.length === 0) {
          continue;
        }

        for (const missingKey of missingKeys) {
          const donorKey = pickDonor(spotNode, missingKey);
          if (!donorKey) {
            throw new Error(`No donor found for ${gameType}/${stack}/${spot}/${missingKey}`);
          }

          const donorEntry = spotNode[donorKey];
          const inputEntry = deepClone(donorEntry);
          const solutionEntry = enforceNoColdCalls(donorEntry);

          const inputSpot = ensurePath(inputOverlay, [gameType, stack, spot]);
          inputSpot[missingKey] = inputEntry;

          const solutionSpot = ensurePath(solutionOverlay, [gameType, stack, spot]);
          solutionSpot[missingKey] = solutionEntry;
        }

        ensurePath(counts.input, [gameType, stack])[spot] = missingKeys.length;
        ensurePath(counts.solution, [gameType, stack])[spot] = missingKeys.length;
      }
    }
  }

  return { inputOverlay, solutionOverlay, counts };
}

function verifyNoBaseDuplicates(baseRanges, overlay) {
  for (const gameType of Object.keys(overlay)) {
    for (const stack of Object.keys(overlay[gameType])) {
      for (const spot of Object.keys(overlay[gameType][stack])) {
        const baseSpot = baseRanges?.[gameType]?.[stack]?.[spot] || {};
        for (const key of Object.keys(overlay[gameType][stack][spot])) {
          if (Object.prototype.hasOwnProperty.call(baseSpot, key)) {
            throw new Error(`Overlay key already exists in base: ${gameType}/${stack}/${spot}/${key}`);
          }
        }
      }
    }
  }
}

function verifySolutionNoColdCalls(overlay) {
  for (const gameType of Object.keys(overlay)) {
    for (const stack of Object.keys(overlay[gameType])) {
      for (const spot of Object.keys(overlay[gameType][stack])) {
        for (const [key, entry] of Object.entries(overlay[gameType][stack][spot])) {
          if (!entry || typeof entry !== 'object') {
            throw new Error(`Invalid solution entry object: ${gameType}/${stack}/${spot}/${key}`);
          }

          if (Array.isArray(entry.pure_call) && entry.pure_call.length > 0) {
            throw new Error(`Solution pure_call not empty: ${gameType}/${stack}/${spot}/${key}`);
          }

          if (entry.mixed && typeof entry.mixed === 'object') {
            for (const [hand, v] of Object.entries(entry.mixed)) {
              if (Array.isArray(v) && v.length === 3) {
                const call = Number(v[1]) || 0;
                if (Math.abs(call) > 1e-12) {
                  throw new Error(`Solution mixed call not zero: ${gameType}/${stack}/${spot}/${key}/${hand}`);
                }
              }
            }
          }
        }
      }
    }
  }
}

function toBrowserFile(overlayObj, mode) {
  const modeComment = mode === 'input'
    ? 'Heuristic add-on ranges for postflop-input derivation.'
    : 'Heuristic add-on ranges for preflop lookup (solution mode).';

  return [
    'window.GTO = window.GTO || {};',
    'GTO.Data = GTO.Data || {};',
    '',
    `// ${modeComment}`,
    '// Overlay-only file: keep ONLY keys missing from preflop-ranges.js.',
    '// Merge order: preflop-ranges.js + this file.',
    '',
    `GTO.Data.PreflopRanges = ${JSON.stringify(overlayObj, null, 2)};`,
    '',
  ].join('\n');
}

function writeExactCopy(sourceText, destPath) {
  fs.writeFileSync(destPath, sourceText, 'utf8');
}

function main() {
  const baseRanges = loadBaseRanges(basePath);
  const { inputOverlay, solutionOverlay, counts } = buildOverlays(baseRanges);

  verifyNoBaseDuplicates(baseRanges, inputOverlay);
  verifyNoBaseDuplicates(baseRanges, solutionOverlay);
  verifySolutionNoColdCalls(solutionOverlay);

  const inputText = toBrowserFile(inputOverlay, 'input');
  const solutionText = toBrowserFile(solutionOverlay, 'solution');

  writeExactCopy(inputText, outInputLookupPath);
  writeExactCopy(solutionText, outSolutionLookupPath);
  writeExactCopy(inputText, outInputDataPath);
  writeExactCopy(solutionText, outSolutionDataPath);

  const report = {
    filesWritten: [
      outInputLookupPath,
      outSolutionLookupPath,
      outInputDataPath,
      outSolutionDataPath,
    ],
    counts,
    assertions: {
      noBaseDuplicates: true,
      solutionNoColdCalls: true,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
