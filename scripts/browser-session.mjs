/** Managed Edge/CDP session: temporary profile by default, deterministic teardown on every exit path. */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = path.join(root, '.scratch');
const runs = path.join(scratch, 'runs');
const cacheProfiles = path.join(scratch, 'cache', 'profiles');
const persistentProfiles = path.join(scratch, 'cache', 'persistent');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') throw new Error(`Invalid name: ${value}`);
  return value;
}

function under(base, target) {
  const relative = path.relative(base, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function edgeExecutable() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Edge not found; set EDGE_PATH');
  return found;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error('Could not allocate a CDP port');
  return port;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {}
  if (await waitForExit(child, 3000)) return;
  try { child.kill('SIGKILL'); } catch {}
  await waitForExit(child, 1000);
}

function removeProfile(profile) {
  if (!under(cacheProfiles, profile) && !under(runs, profile)) throw new Error(`Refusing to remove profile outside .scratch: ${profile}`);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    throw new Error(`Could not remove temporary profile ${profile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForDevtools(port, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Edge exited before CDP was ready (code ${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP endpoint did not become ready');
}

/**
 * Run a callback with a managed Edge page. The profile is removed in a finally block unless
 * keepProfile or persistentProfile is set. keepProfile requires a scratch run.
 */
export async function withEdgePage(options, task) {
  const {
    url,
    taskId,
    keepProfile = false,
    persistentProfile,
    headless = true,
    width = 1440,
    height = 900,
    executable = edgeExecutable(),
  } = options;
  if (typeof task !== 'function') throw new Error('withEdgePage requires a callback');
  if (keepProfile && !taskId) throw new Error('keepProfile requires taskId');
  mkdirSync(cacheProfiles, { recursive: true });
  mkdirSync(persistentProfiles, { recursive: true });
  let profile;
  if (persistentProfile) {
    profile = path.join(persistentProfiles, safeName(persistentProfile));
    mkdirSync(profile, { recursive: true });
  } else if (keepProfile) {
    const run = path.join(runs, safeName(taskId));
    const manifest = path.join(run, 'manifest.json');
    if (!existsSync(manifest)) throw new Error(`Unknown run: ${taskId}`);
    profile = path.join(run, 'profile');
    if (existsSync(profile)) profile = path.join(run, `profile-${Date.now()}`);
    mkdirSync(profile, { recursive: true });
  } else {
    profile = path.join(cacheProfiles, `${Date.now()}-${randomUUID()}`);
    mkdirSync(profile, { recursive: true });
  }
  const port = await freePort();
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--metrics-recording-only',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, 'about:blank',
  ];
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
  let socket;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try { socket?.close(); } catch {}
    await stop(child);
    if (!keepProfile && !persistentProfile) removeProfile(profile);
  };
  const onSignal = (signal) => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await waitForDevtools(port, child);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('No page target');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 0;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return result.result?.value;
    };
    if (url) {
      await send('Page.enable');
      await send('Page.navigate', { url });
      await sleep(options.settleMs ?? 1200);
    }
    return await task({ send, evaluate, profile, port, child });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await cleanup();
  }
}
