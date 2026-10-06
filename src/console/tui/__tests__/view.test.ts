import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { OutputEvent } from '../../../protocol/index.ts';
import { TuiState, DISPLAY_LIMITS } from '../state.ts';
import { TuiView } from '../view.ts';
import { width } from '../text.ts';

it('keeps a scrolled viewport and draft stable while new diagnostics arrive', () => {
  const state = new TuiState('running'), view = new TuiView();
  for (let index = 0; index < 30; index++) state.append(`activity ${index}`);
  state.editor.insert('草稿👩‍💻'); state.editor.left();
  view.scroll(state, 50, 16, -1);
  const before = view.frame(state, 50, 16).lines.slice(1, 11);
  const cursor = state.editor.cursor;
  state.append('new activity');
  assert.deepEqual(view.frame(state, 50, 16).lines.slice(1, 11), before);
  assert.equal(state.editor.text, '草稿👩‍💻'); assert.equal(state.editor.cursor, cursor);
  assert.equal(state.unread, 1);
  state.follow();
  assert.match(view.frame(state, 50, 16).lines.join('\n'), /new activity/);
});

it('bounds retained diagnostics and exposes eviction while keeping the draft intact', () => {
  const state = new TuiState('running'), view = new TuiView();
  state.editor.insert('retained draft');
  state.append('old'); state.selectedId = state.entries[0]!.id;
  state.anchor = { entryId: state.selectedId, line: 0 };
  for (let index = 0; index < DISPLAY_LIMITS.entries + 1; index++) state.append('x'.repeat(DISPLAY_LIMITS.fieldBytes));
  assert.ok(state.entries.length <= DISPLAY_LIMITS.entries);
  assert.ok(state.entries.reduce((sum, entry) => sum + entry.bytes, 0) <= DISPLAY_LIMITS.bytes);
  assert.match(view.frame(state, 60, 16).lines.join('\n'), /回看位置已淘汰/);
  state.mode = 'details';
  assert.match(view.frame(state, 60, 16).lines.join('\n'), /展示缓存淘汰/);
  assert.equal(state.editor.text, 'retained draft');
});

it('keeps the anchored entry visible when a wider terminal removes its wrapped rows', () => {
  const state = new TuiState('running'), view = new TuiView();
  for (let index = 0; index < 12; index++) state.append(`entry ${index} ` + 'x'.repeat(80));
  const entry = state.entries[6]!;
  state.anchor = { entryId: entry.id, line: 4 };
  assert.match(view.frame(state, 100, 16).lines[1]!, /entry 6/);
  assert.equal(state.anchor.entryId, entry.id);
});

it('fits Unicode and inert control text in frames down to a one-cell terminal', () => {
  const state = new TuiState('running'), view = new TuiView();
  state.append('中文👨‍👩‍👧‍👦e\u0301\x1b]2;bad-title\x07\nlong line '.repeat(10));
  state.editor.insert('中文\n👩‍💻e\u0301');
  for (const [columns, rows] of [[80, 24], [12, 8], [3, 2], [1, 1]]) {
    const frame = view.frame(state, columns!, rows!);
    assert.equal(frame.lines.length, rows);
    for (const line of frame.lines) { assert.ok(width(line) < columns!); assert.doesNotMatch(line, /[\x00-\x1f\x7f-\x9f]/); }
    assert.ok(frame.cursor && frame.cursor.row < rows! && frame.cursor.column < columns!);
  }
});

it('pages through complete details and retains public final-result distinctions', () => {
  const state = new TuiState('running'), view = new TuiView();
  const event: OutputEvent = { type: 'run_finished', seq: 2, inputId: 'full-input-id', runId: 'run-id',
    sessionId: 'session-id', generation: 1, at: '2026-10-06',
    result: { status: 'failed', persisted: false, code: 'storage_error', message: 'append failed' } };
  state.event(event);
  assert.equal(state.gap, true);
  const transcript = view.frame(state, 80, 24).lines.join('\n');
  assert.match(transcript, /failed · persisted=false · storage_error/);
  assert.match(transcript, /等待触发/);
  state.mode = 'details';
  assert.match(view.frame(state, 50, 10).lines.join('\n'), /full-input-id/);
  view.scroll(state, 50, 10, 1);
  assert.ok(state.detailOffset > 0);
  view.scroll(state, 50, 10, 1);
  assert.match(view.frame(state, 50, 10).lines.join('\n'), /storage_error/);
});
