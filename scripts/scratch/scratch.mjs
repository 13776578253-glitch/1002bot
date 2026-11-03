/** Manage disposable runs, protected evidence and stale browser profiles under .scratch. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scratch = path.join(root, '.scratch');
const runs = path.join(scratch, 'runs');
const cache = path.join(scratch, 'cache');
const cacheProfiles = path.join(cache, 'profiles');
const quarantine = path.join(scratch, 'quarantine');
const statuses = new Set(['active', 'review', 'complete', 'expired']);
const booleans = new Set(['--protected', '--unprotect', '--apply', '--purge', '--legacy', '--force', '--dry-run']);
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

function fail(message) {
  throw new Error(message);
}

function safeName(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') fail(`Invalid ${label}: ${value}`);
  return value;
}

function child(base, name) {
  const target = path.join(base, safeName(name, 'name'));
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(`Path escapes ${base}`);
  return target;
}

function ensureLayout() {
  for (const directory of [scratch, runs, cache, cacheProfiles, path.join(cache, 'persistent'), quarantine]) mkdirSync(directory, { recursive: true });
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeManifest(directory, manifest) {
  const target = path.join(directory, 'manifest.json');
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, json(manifest));
  renameSync(temporary, target);
}

function readManifest(id) {
  const directory = child(runs, id);
  const file = path.join(directory, 'manifest.json');
  if (!existsSync(file)) fail(`Unknown run: ${id}`);
  return { directory, manifest: JSON.parse(readFileSync(file, 'utf8')) };
}

function parse(argv) {
  const [command = 'help', ...rest] = argv;
  const flags = new Map();
  const positional = [];
  const add = (key, value) => {
    if (!flags.has(key)) flags.set(key, value);
    else {
      const previous = flags.get(key);
      flags.set(key, Array.isArray(previous) ? [...previous, value] : [previous, value]);
    }
  };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const [key, inline] = value.split('=', 2);
    if (inline !== undefined) { add(key, inline); continue; }
    if (booleans.has(key)) { add(key, true); continue; }
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) fail(`${key} requires a value`);
    add(key, next);
    index += 1;
  }
  return { command, flags, positional };
}

function first(flags, key) {
  const value = flags.get(key);
  return Array.isArray(value) ? value[0] : value;
}

function values(flags, key) {
  const value = flags.get(key);
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function bool(flags, key) {
  return flags.get(key) === true;
}

function sourceCommit(flags) {
  if (first(flags, '--source')) return String(first(flags, '--source'));
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return null;
  }
}

function checkDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) fail(`Invalid date: ${value}`);
  return value;
}

function directoryStats(directory) {
  let bytes = 0;
  let files = 0;
  const visit = (target) => {
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      const full = path.join(target, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        files += 1;
        try { bytes += statSync(full).size; } catch {}
      }
    }
  };
  try { visit(directory); } catch {}
  return { bytes, files };
}

function commandLines() {
  try {
    if (process.platform === 'win32') {
      const command = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Select-Object -ExpandProperty CommandLine";
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
        .split(/\r?\n/).filter(Boolean);
    }
    return execFileSync('ps', ['-ax', '-o', 'command='], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
      .split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

const normalizePath = (value) => value.replaceAll('\\', '/').toLowerCase();

function inUse(profile, lines) {
  const needle = normalizePath(profile);
  return lines.some((line) => normalizePath(line).includes(needle));
}

function profileCandidates(includeLegacy) {
  const found = [];
  const collect = (directory, prefix = '') => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(directory, entry.name);
      found.push({ name: `${prefix}${entry.name}`, path: full, ...directoryStats(full) });
    }
  };
  collect(cacheProfiles);
  if (includeLegacy) {
    for (const entry of readdirSync(scratch, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('edge-profile-')) {
        const full = path.join(scratch, entry.name);
        found.push({ name: entry.name, path: full, ...directoryStats(full) });
      }
    }
  }
  return found;
}

function writeReport(task, name, value) {
  if (!task) return null;
  const { directory } = readManifest(task);
  const reports = path.join(directory, 'reports');
  mkdirSync(reports, { recursive: true });
  const target = path.join(reports, safeName(name, 'report name') + '.json');
  writeFileSync(target, json(value));
  return target;
}

function start(command) {
  ensureLayout();
  const id = command.positional[0] ?? first(command.flags, '--task');
  if (!id) fail('start requires a task id');
  safeName(id, 'task id');
  const directory = child(runs, id);
  if (existsSync(path.join(directory, 'manifest.json'))) fail(`Run already exists: ${id}`);
  for (const name of ['logs', 'scripts', 'screenshots', 'reports']) mkdirSync(path.join(directory, name), { recursive: true });
  const agents = values(command.flags, '--agent').map((value) => safeName(value, 'agent id'));
  for (const agent of agents) mkdirSync(path.join(directory, 'agents', agent), { recursive: true });
  const createdAt = now();
  const manifest = {
    version: 1,
    id,
    title: String(first(command.flags, '--title') ?? id),
    createdAt,
    updatedAt: createdAt,
    status: 'active',
    sourceCommit: sourceCommit(command.flags),
    cleanAfter: null,
    protected: bool(command.flags, '--protected'),
    recoveryPoints: values(command.flags, '--recovery'),
    agents,
    artifacts: ['logs', 'scripts', 'screenshots', 'reports', ...(agents.length ? ['agents'] : [])],
  };
  writeManifest(directory, manifest);
  console.log(JSON.stringify({ directory, manifest }, null, 2));
}

function update(command) {
  ensureLayout();
  const id = first(command.flags, '--task') ?? command.positional[0];
  if (!id) fail('update requires --task');
  const { directory, manifest } = readManifest(id);
  const status = first(command.flags, '--status');
  if (status !== undefined) {
    if (!statuses.has(status)) fail(`Invalid status: ${status}`);
    manifest.status = status;
  }
  if (first(command.flags, '--title') !== undefined) manifest.title = String(first(command.flags, '--title'));
  if (bool(command.flags, '--protected')) manifest.protected = true;
  if (bool(command.flags, '--unprotect')) manifest.protected = false;
  if (first(command.flags, '--clean-after') !== undefined) manifest.cleanAfter = checkDate(String(first(command.flags, '--clean-after')));
  if (first(command.flags, '--source') !== undefined) manifest.sourceCommit = String(first(command.flags, '--source'));
  manifest.recoveryPoints = [...new Set([...(manifest.recoveryPoints ?? []), ...values(command.flags, '--recovery')])];
  manifest.agents = [...new Set([...(manifest.agents ?? []), ...values(command.flags, '--agent').map((value) => safeName(value, 'agent id'))])];
  for (const agent of manifest.agents) mkdirSync(path.join(directory, 'agents', agent), { recursive: true });
  manifest.updatedAt = now();
  writeManifest(directory, manifest);
  console.log(JSON.stringify({ directory, manifest }, null, 2));
}

function list() {
  ensureLayout();
  const result = [];
  for (const entry of readdirSync(runs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(runs, entry.name, 'manifest.json');
    if (!existsSync(file)) {
      result.push({ id: entry.name, status: 'missing-manifest' });
      continue;
    }
    try {
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      const stats = directoryStats(path.join(runs, entry.name));
      result.push({ id: manifest.id ?? entry.name, title: manifest.title, status: manifest.status, protected: !!manifest.protected,
        cleanAfter: manifest.cleanAfter ?? null, recoveryPoints: manifest.recoveryPoints?.length ?? 0, bytes: stats.bytes, files: stats.files,
        updatedAt: manifest.updatedAt });
    } catch (error) {
      result.push({ id: entry.name, status: 'invalid-manifest', error: error instanceof Error ? error.message : String(error) });
    }
  }
  result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  console.log(JSON.stringify(result, null, 2));
}

function clean(command) {
  ensureLayout();
  const apply = bool(command.flags, '--apply');
  const purge = bool(command.flags, '--purge');
  const candidates = [];
  for (const entry of readdirSync(runs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(runs, entry.name);
    const file = path.join(directory, 'manifest.json');
    if (!existsSync(file)) continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    const eligible = ['complete', 'expired'].includes(manifest.status)
      && manifest.protected !== true
      && !(manifest.recoveryPoints?.length)
      && typeof manifest.cleanAfter === 'string'
      && manifest.cleanAfter <= today();
    const stats = directoryStats(directory);
    const item = { id: manifest.id ?? entry.name, status: manifest.status, protected: !!manifest.protected,
      recoveryPoints: manifest.recoveryPoints?.length ?? 0, cleanAfter: manifest.cleanAfter ?? null, bytes: stats.bytes, files: stats.files, eligible };
    if (eligible) {
      if (apply) {
        const target = path.join(quarantine, `${now().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}-${safeName(item.id, 'task id')}`);
        try {
          if (purge) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
          else renameSync(directory, target);
          item.applied = purge ? 'purged' : `quarantined:${target}`;
        } catch (error) {
          item.error = error instanceof Error ? error.message : String(error);
        }
      } else {
        item.would = purge ? 'purge' : 'quarantine';
      }
    }
    candidates.push(item);
  }
  const report = { version: 1, at: now(), apply, purge, candidates,
    freedBytes: candidates.filter((item) => item.applied === 'purged').reduce((sum, item) => sum + item.bytes, 0) };
  const reportPath = writeReport(first(command.flags, '--task'), 'run-cleanup', report);
  if (reportPath) report.report = reportPath;
  console.log(JSON.stringify(report, null, 2));
  if (candidates.some((item) => item.error)) process.exitCode = 1;
}

function profiles(command) {
  ensureLayout();
  const apply = bool(command.flags, '--apply');
  const purge = bool(command.flags, '--purge');
  const lines = commandLines();
  const candidates = profileCandidates(bool(command.flags, '--legacy'));
  const removed = [];
  const protectedInUse = [];
  const errors = [];
  for (const profile of candidates) {
    const used = inUse(profile.path, lines);
    const item = { ...profile, inUse: used };
    if (used) { protectedInUse.push(item); continue; }
    if (apply) {
      try {
        if (purge) rmSync(profile.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        else {
          const target = path.join(quarantine, `${now().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}-${profile.name}`);
          renameSync(profile.path, target);
          item.quarantined = target;
        }
        item.applied = purge ? 'purged' : 'quarantined';
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
        errors.push(item);
      }
    } else {
      item.would = purge ? 'purge' : 'quarantine';
    }
    removed.push(item);
  }
  const report = {
    version: 1,
    at: now(),
    apply,
    purge,
    candidates: candidates.length,
    removed,
    inUse: protectedInUse,
    errors,
    freedBytes: removed.filter((item) => item.applied === 'purged').reduce((sum, item) => sum + item.bytes, 0),
  };
  const reportPath = writeReport(first(command.flags, '--task'), 'profile-cleanup', report);
  if (reportPath) report.report = reportPath;
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
}

function help() {
  console.log(`Scratch management

  node scripts/scratch/scratch.mjs start --task <id> [--title <text>] [--agent <id>] [--source <rev>] [--protected] [--recovery <path>]
  node scripts/scratch/scratch.mjs update --task <id> [--status active|review|complete|expired] [--title <text>] [--protected|--unprotect] [--clean-after YYYY-MM-DD] [--recovery <path>] [--agent <id>]
  node scripts/scratch/scratch.mjs list
  node scripts/scratch/scratch.mjs clean [--apply] [--purge] [--task <report-run>]
  node scripts/scratch/scratch.mjs profiles [--legacy] [--apply] [--purge] [--task <report-run>]

Defaults are dry runs. clean only considers complete/expired runs with a cleanAfter date. It never
touches protected runs, review runs, runs with recoveryPoints, cache/persistent, or legacy scratch
directories. profiles only scans temporary profiles and, with --legacy, top-level edge-profile-*;
profiles in use are skipped.`);
}

try {
  ensureLayout();
  const command = parse(process.argv.slice(2));
  if (command.command === 'start') start(command);
  else if (command.command === 'update') update(command);
  else if (command.command === 'list') list();
  else if (command.command === 'clean') clean(command);
  else if (command.command === 'profiles') profiles(command);
  else if (['help', '--help', '-h'].includes(command.command)) help();
  else fail(`Unknown command: ${command.command}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
