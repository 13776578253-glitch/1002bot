import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DraftEditor, DRAFT_BYTES } from '../editor.ts';

it('edits Chinese, combining marks and joined emoji at grapheme boundaries', () => {
  const editor = new DraftEditor();
  editor.insert('甲👩‍💻e\u0301乙');
  editor.left(); editor.backspace();
  assert.equal(editor.text, '甲👩‍💻乙');
  editor.backspace();
  assert.equal(editor.text, '甲乙');
  editor.home(); editor.delete();
  assert.equal(editor.text, '乙');
  editor.insert('👨‍👩‍👧‍👦'); editor.left(); editor.delete();
  assert.equal(editor.text, '乙');
});

it('keeps the desired display column across lines with different Unicode widths', () => {
  const editor = new DraftEditor();
  editor.insert('abcd\n中\nabcdef');
  editor.home(); editor.right(); editor.right(); editor.right(); editor.right();
  editor.vertical(-1, 10);
  assert.deepEqual(editor.position(10), { row: 1, column: 2 });
  editor.vertical(-1, 10);
  assert.deepEqual(editor.position(10), { row: 0, column: 4 });
});

it('retains edits made during admission and rejects an oversized paste without changing the draft', () => {
  const editor = new DraftEditor();
  editor.insert('first');
  const revision = editor.revision;
  editor.insert(' next'); editor.clearIfUnchanged(revision);
  assert.equal(editor.text, 'first next');
  assert.equal(editor.insert('x'.repeat(DRAFT_BYTES)), false);
  assert.equal(editor.text, 'first next');
  editor.clearIfUnchanged(editor.revision);
  assert.equal(editor.text, '');
});

it('keeps Home at the beginning of a draft starting with a newline', () => {
  const editor = new DraftEditor();
  editor.insert('\ntext');
  for (let i = 0; i < 5; i++) editor.left();
  editor.home();
  assert.equal(editor.cursor, 0);
});
