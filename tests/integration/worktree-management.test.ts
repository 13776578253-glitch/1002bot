/** Project-local worktree commands are verified against disposable real Git repositories. */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'bot-worktree-test-'));
  const script = path.join(root, 'scripts', 'worktree.mjs');
  mkdirSync(path.dirname(script));
  copyFileSync(new URL('../../scripts/worktree.mjs', import.meta.url), script);
  writeFileSync(path.join(root, '.gitignore'), '/.worktrees/\n/.worktree-local/\n');
  writeFileSync(path.join(root, 'README.md'), 'Fixture baseline\n');
  const git = (args: string[], cwd = root) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['add', '--', '.gitignore', 'README.md', 'scripts/worktree.mjs']);
  git(['commit', '-m', 'fixture baseline']);
  const base = git(['rev-parse', 'HEAD']);
  const invoke = (args: string[], cwd = root) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', windowsHide: true });
    assert.ifError(result.error);
    return result;
  };
  const cleanup = () => {
    // 只删除本测试创建的临时目录；移除登记后再递归清理文件。
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('bot-worktree-test-'));
    for (const line of git(['worktree', 'list', '--porcelain']).split(/\r?\n/)) {
      if (!line.startsWith('worktree ')) continue;
      const worktree = path.resolve(line.slice(9));
      if (worktree === resolved) continue;
      const relative = path.relative(resolved, worktree);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      git(['worktree', 'remove', '--force', worktree]);
    }
    rmSync(resolved, { recursive: true, force: true });
  };
  return { root, base, git, invoke, cleanup };
}

test('TUI worktree isolates files and commits while recording its main baseline', t => {
  const repo = fixture();
  t.after(repo.cleanup);
  const child = path.join(repo.root, '.worktrees', 'TUI');
  const created = repo.invoke(['new', 'TUI', '--branch', 'feat/TUI', '--base', 'main']);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(repo.git(['branch', '--show-current']), 'main');
  assert.equal(repo.git(['branch', '--show-current'], child), 'feat/TUI');
  assert.equal(repo.git(['rev-parse', 'HEAD'], child), repo.base);
  const registration = JSON.parse(readFileSync(path.join(child, '.worktree-local', 'worktree.json'), 'utf8'));
  assert.equal(registration.baseSha, repo.base);
  assert.equal(registration.baseRef, 'main');
  assert.equal(path.resolve(registration.path), child);
  assert.equal(repo.git(['status', '--porcelain']), '');
  assert.equal(repo.git(['status', '--porcelain'], child), '');
  writeFileSync(path.join(child, 'README.md'), 'TUI-only edit\n');
  assert.equal(readFileSync(path.join(repo.root, 'README.md'), 'utf8'), 'Fixture baseline\n');
  repo.git(['add', '--', 'README.md'], child);
  repo.git(['commit', '-m', 'fixture TUI change'], child);
  assert.equal(repo.git(['rev-parse', 'main']), repo.base);
  const status = repo.invoke(['status'], child);
  assert.equal(status.status, 0, status.stderr);
  const entries = status.stdout.trim().split(/\r?\n/).slice(1).map(line => JSON.parse(line));
  assert.equal(entries.length, 2);
  const feature = entries.find(entry => entry.branch === 'feat/TUI');
  assert.equal(feature.aheadOfMain, 1);
  assert.equal(feature.behindMain, 0);
  assert.equal(feature.dirtyFiles, 0);
  const nested = repo.invoke(['new', 'Other'], child);
  assert.notEqual(nested.status, 0);
  assert.match(nested.stderr, /primary checkout on main/);
});

test('worktree creation refuses dirty main, invalid paths, missing bases and collisions', t => {
  const repo = fixture();
  t.after(repo.cleanup);
  const before = repo.git(['worktree', 'list', '--porcelain']);
  for (const args of [
    ['new', '../outside'],
    ['new', 'Missing', '--base', 'missing-baseline'],
    ['new', 'Existing', '--branch', 'main'],
  ]) {
    assert.notEqual(repo.invoke(args).status, 0);
    assert.equal(repo.git(['worktree', 'list', '--porcelain']), before);
  }
  const pending = path.join(repo.root, 'pending.txt');
  writeFileSync(pending, 'Uncommitted main work\n');
  const dirty = repo.invoke(['new', 'TUI', '--branch', 'feat/TUI']);
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /uncommitted files/);
  assert.equal(readFileSync(pending, 'utf8'), 'Uncommitted main work\n');
  assert.equal(repo.git(['worktree', 'list', '--porcelain']), before);
  rmSync(pending);
  assert.equal(repo.invoke(['new', 'TUI', '--branch', 'feat/TUI']).status, 0);
  const duplicate = repo.invoke(['new', 'TUI', '--branch', 'feat/TUI']);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /Directory already exists/);
  assert.equal(repo.git(['branch', '--list', 'feat/TUI']), '+ feat/TUI');
});

test('existing branches require explicit adoption and an unchanged base', t => {
  const repo = fixture();
  t.after(repo.cleanup);
  repo.git(['branch', 'feat/TUI']);
  const implicit = repo.invoke(['new', 'TUI', '--branch', 'feat/TUI']);
  assert.notEqual(implicit.status, 0);
  assert.match(implicit.stderr, /use --existing-branch/);
  writeFileSync(path.join(repo.root, 'README.md'), 'New main baseline\n');
  repo.git(['add', '--', 'README.md']);
  repo.git(['commit', '-m', 'fixture next main']);
  const mismatched = repo.invoke(['new', 'TUI', '--branch', 'feat/TUI', '--existing-branch']);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /differs from the requested base/);
  assert.equal(repo.git(['rev-parse', 'feat/TUI']), repo.base);
  assert.equal(existsSync(path.join(repo.root, '.worktrees', 'TUI')), false);
  const adopted = repo.invoke(['new', 'TUI', '--branch', 'feat/TUI', '--existing-branch', '--base', repo.base]);
  assert.equal(adopted.status, 0, adopted.stderr);
  assert.equal(repo.git(['rev-parse', 'HEAD'], path.join(repo.root, '.worktrees', 'TUI')), repo.base);
});
