/** Project-local Git worktrees record a committed base and keep feature files separate from main. */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const metadataPath = path.join('.worktree-local', 'worktree.json');
const normalize = value => {
  const resolved = path.resolve(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const samePath = (a, b) => normalize(a) === normalize(b);

function git(args, { cwd = projectRoot, allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error((result.stderr || result.stdout).trim());
  return result;
}
const output = (args, options) => git(args, options).stdout.trim();

function worktrees() {
  const entries = [];
  let entry;
  for (const line of output(['worktree', 'list', '--porcelain']).split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { entry = { path: line.slice(9), head: '', branch: null }; entries.push(entry); }
    else if (line.startsWith('HEAD ')) entry.head = line.slice(5);
    else if (line.startsWith('branch ')) entry.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  return entries;
}

function parse(argv) {
  const [command = 'help', ...values] = argv;
  const result = { command, name: '', base: 'main', branch: '', existingBranch: false };
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === '--existing-branch') result.existingBranch = true;
    else if (value === '--base' || value === '--branch') {
      if (!values[i + 1] || values[i + 1].startsWith('--')) throw new Error(`${value} requires a value`);
      result[value.slice(2)] = values[++i];
    } else if (!value.startsWith('-') && !result.name) result.name = value;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

/** 只从主检出的已提交基线创建，避免把其他会话的草稿带入前端分支。 */
function create(args) {
  const primary = worktrees()[0].path;
  const current = output(['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  if (!samePath(current, primary) || !samePath(projectRoot, primary) || output(['branch', '--show-current']) !== 'main') {
    throw new Error('wt:new must run from the primary checkout on main');
  }
  if (output(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Primary checkout has uncommitted files; commit them first');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(args.name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(args.name)) {
    throw new Error('Invalid worktree name; use letters, digits and hyphens');
  }
  const branch = args.branch || `feat/${args.name}`;
  git(['check-ref-format', '--branch', branch]);
  const baseSha = output(['rev-parse', '--verify', '--end-of-options', `${args.base}^{commit}`]);
  const target = path.join(primary, '.worktrees', args.name);
  if (!normalize(target).startsWith(normalize(primary) + '/.worktrees/')) throw new Error('Worktree path escapes the project');
  if (existsSync(target)) throw new Error(`Directory already exists: ${target}`);
  let parent = path.dirname(target);
  while (!existsSync(parent)) parent = path.dirname(parent);
  // Windows junction 可能把看似位于项目内的目录指向项目外，创建前检查实际路径。
  const realParent = normalize(realpathSync(parent));
  const realRoot = normalize(realpathSync(primary));
  if (realParent !== realRoot && !realParent.startsWith(realRoot + '/')) throw new Error('Worktree parent resolves outside the project');
  git(['check-ignore', '--quiet', '--', `.worktrees/${args.name}/.git`]);
  git(['check-ignore', '--quiet', '--', metadataPath]);
  const exists = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true }).status === 0;
  if (exists !== args.existingBranch) throw new Error(exists ? 'Branch already exists; use --existing-branch' : 'Requested existing branch does not exist');
  // 接管既有分支只接受相同基线；工具不替负责人移动分支或丢弃历史。
  if (exists && output(['rev-parse', `${branch}^{commit}`]) !== baseSha) throw new Error('Existing branch differs from the requested base; reconcile it explicitly');
  if (exists) git(['worktree', 'add', target, branch]);
  else git(['worktree', 'add', '-b', branch, target, baseSha]);
  const registration = { name: args.name, path: target, branch, baseRef: args.base, baseSha, createdAt: new Date().toISOString() };
  mkdirSync(path.join(target, '.worktree-local'), { recursive: true });
  writeFileSync(path.join(target, metadataPath), JSON.stringify(registration, null, 2) + '\n');
  writeFileSync(path.join(target, '.worktree-local/rules.md'), `# 本地工作树边界

目录：${target}
分支：${branch}
基线：${args.base} @ ${baseSha}

先执行 pwd、git branch --show-current、git worktree list。代码修改与提交使用本目录；遵循仓库 AGENTS.md。主线仍在 ${primary}。

Git 对象、引用、hooks 与远端是共享资源。跨分支、推送及工作树管理按负责人明确任务执行；普通 TUI 开发不在主目录编辑或切换分支。终端、端口和会话文件按实际运行场景分配，本工具不复制环境文件、凭据或生产数据。
`);
  console.log(JSON.stringify(registration, null, 2));
  console.log('Dependencies are separate. Run pnpm install:all in the new worktree before checks.');
}

/** 读取 Git 的真实检出状态；本地登记只提供创建时的基线说明。 */
function status() {
  const primary = worktrees()[0].path;
  console.log(`Primary checkout: ${primary}`);
  for (const entry of worktrees()) {
    const present = existsSync(entry.path);
    const registry = path.join(entry.path, metadataPath);
    const registration = present && existsSync(registry) ? JSON.parse(readFileSync(registry, 'utf8')) : null;
    const dirty = present ? output(['status', '--porcelain', '--untracked-files=all'], { cwd: entry.path }) : '';
    const relation = entry.branch ? output(['rev-list', '--left-right', '--count', `main...${entry.branch}`]) : '';
    const [behind = '0', ahead = '0'] = relation.split(/\s+/);
    console.log(JSON.stringify({ ...entry, present, dirtyFiles: dirty ? dirty.split(/\r?\n/).length : 0,
      aheadOfMain: Number(ahead), behindMain: Number(behind), base: registration ? `${registration.baseRef}@${registration.baseSha}` : null }));
  }
}

try {
  const args = parse(process.argv.slice(2));
  if (args.command === 'new') create(args);
  else if (args.command === 'status') status();
  else if (['help', '--help'].includes(args.command)) console.log('pnpm wt:new <name> --branch <branch> [--base main] [--existing-branch]\npnpm wt:status');
  else throw new Error(`Unknown command: ${args.command}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
