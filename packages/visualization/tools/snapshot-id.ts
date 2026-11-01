/** Computes, checks and rewrites project snapshot ids from their selection blocks. */
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface IdList {
  componentIds: string[];
  relationIds: string[];
  contractIds: string[];
}

export interface SnapshotSelection {
  select: IdList;
  remove: IdList;
}

function ids(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${path} must be an array of ids`);
  return value as string[];
}

export function canonicalSelection(stage: SnapshotSelection): string {
  if (!stage || typeof stage !== 'object') throw new Error('snapshot must be an object');
  if (!stage.select || typeof stage.select !== 'object') throw new Error('snapshot.select must be an object');
  if (!stage.remove || typeof stage.remove !== 'object') throw new Error('snapshot.remove must be an object');
  return JSON.stringify({
    select: {
      componentIds: ids(stage.select.componentIds, 'select.componentIds'),
      relationIds: ids(stage.select.relationIds, 'select.relationIds'),
      contractIds: ids(stage.select.contractIds, 'select.contractIds'),
    },
    remove: {
      componentIds: ids(stage.remove.componentIds, 'remove.componentIds'),
      relationIds: ids(stage.remove.relationIds, 'remove.relationIds'),
      contractIds: ids(stage.remove.contractIds, 'remove.contractIds'),
    },
  });
}

export function snapshotId(stage: SnapshotSelection): string {
  return createHash('sha256').update(canonicalSelection(stage)).digest('hex').slice(0, 8);
}

export async function stageFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await stageFiles(path));
    else if (entry.name.endsWith('.json') && basename(directory) === 'stages') files.push(path);
  }
  return files;
}

async function readStage(file: string): Promise<SnapshotSelection & { id?: string }> {
  return JSON.parse(await readFile(file, 'utf8')) as SnapshotSelection & { id?: string };
}

async function check(files: readonly string[]): Promise<boolean> {
  let passed = true;
  for (const file of files) {
    try {
      const stage = await readStage(file);
      const id = snapshotId(stage);
      const problems: string[] = [];
      if (stage.id !== id) problems.push(`id is "${stage.id ?? '(missing)'}", expected "${id}"`);
      if (basename(file) !== `${id}.json`) problems.push(`file name should be "${id}.json"`);
      if (problems.length) {
        passed = false;
        console.error(`FAIL ${relative('.', file)}: ${problems.join('; ')}`);
      } else console.log(`ok   ${relative('.', file)}`);
    } catch (error) {
      passed = false;
      console.error(`FAIL ${relative('.', file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return passed;
}

async function write(file: string): Promise<number> {
  const stage = await readStage(file);
  const id = snapshotId(stage);
  const target = join(dirname(file), `${id}.json`);
  stage.id = id;
  if (target !== file && await stat(target).then(() => true, () => false)) throw new Error(`${target} already exists`);
  await writeFile(target, `${JSON.stringify(stage, null, 2)}\n`);
  if (target !== file) await rm(file);
  console.log(target);
  return 0;
}

function usage(): void {
  console.error('usage:');
  console.error('  node --experimental-strip-types tools/snapshot-id.ts <stage.json>');
  console.error('  node --experimental-strip-types tools/snapshot-id.ts --check <stage.json...>');
  console.error('  node --experimental-strip-types tools/snapshot-id.ts --check --all <datasets-dir>');
  console.error('  node --experimental-strip-types tools/snapshot-id.ts --write <stage.json>');
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help') { usage(); return command ? 0 : 1; }
  if (command === '--check') {
    const all = rest.indexOf('--all');
    const files = all >= 0 ? await stageFiles(rest[all + 1] ?? '.') : rest.filter((item) => !item.startsWith('--'));
    if (!files.length) { usage(); return 1; }
    return await check(files) ? 0 : 1;
  }
  if (command === '--write') {
    const file = rest[0];
    if (!file) { usage(); return 1; }
    return await write(file);
  }
  if (command.startsWith('--')) { usage(); return 1; }
  console.log(snapshotId(await readStage(command)));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
