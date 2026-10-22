/**
 * Build-time data generation for the playground: runs the Node-only
 * adapter and serializes the snapshots to plain JSON that the browser
 * can import without node:fs / node:vm.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');

const { loadBotStages } = await import(pathToFileURL(join(pkgRoot, 'examples/1002bot/adapter.ts')).href);
const { tracks } = loadBotStages();

const outDir = join(pkgRoot, 'playground/src/generated');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, 'bot-stages.json');
writeFileSync(file, JSON.stringify({ tracks }, null, 1), 'utf8');
console.log('playground data written:', tracks.map((t) => `${t.track}(${t.stages.length})`).join(' '));
