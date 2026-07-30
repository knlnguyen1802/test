import fs from 'node:fs';

const path = 'gtoterminal/preflop-lookup/preflop-ranges.js';
const src = fs.readFileSync(path, 'utf8');
const out = src.replace(/^(\s*)([2-9TJQKA]{2}(?:[so])?)\s*:/gm, "$1'$2':");

if (out !== src) {
  fs.writeFileSync(path, out, 'utf8');
  console.log('Updated hand keys quoting');
} else {
  console.log('No changes needed');
}
