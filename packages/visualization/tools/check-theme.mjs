import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/themes/default.css', import.meta.url), 'utf8');
const source = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
let depth = 0;

for (const char of source) {
  if (char === '{') depth += 1;
  if (char === '}') depth -= 1;
  if (depth < 0) throw new Error('CSS contains an unmatched closing brace');
}

if (depth !== 0) throw new Error(`CSS contains ${depth} unmatched opening brace(s)`);

const required = [
  '.av-card', '.av-card-status', '.av-card-body', '.av-card-icon',
  '.av-card-copy', '.av-card-title', '.av-card-desc', '.av-card-meta',
  '.av-card-action', '.av-aggregate', '.av-aggregate-header', '.av-aggregate-desc',
  '.av-aggregate-action', '.av-edge-label', 'react-flow__edge',
  '.av-delta-added', '.av-delta-modified', '.av-delta-moved',
  '.av-delta-split', '.av-delta-merged', '.av-delta-removed',
  '.av-delta-baseline', '.av-delta-inherited', '.av-planned',
];
const missing = required.filter((selector) => !source.includes(selector));
if (missing.length > 0) throw new Error(`Missing selectors: ${missing.join(', ')}`);

console.log(`Theme CSS syntax and ${required.length} required selectors verified.`);
