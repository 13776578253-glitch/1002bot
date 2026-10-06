import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DRAFT_BYTES } from '../editor.ts';
import { TerminalInputDecoder, type KeyAction } from '../input.ts';

it('decodes byte-split UTF-8 and bracketed paste without executing pasted control keys', () => {
  const actions: KeyAction[] = [];
  const decoder = new TerminalInputDecoder(action => actions.push(action));
  const paste = Buffer.from('\x1b[200~中文\r\n👩‍💻\x13\x03\x1b[201~');
  for (const byte of paste) decoder.feed(Buffer.from([byte]));
  assert.deepEqual(actions, [{ type: 'insert', text: '中文\r\n👩‍💻\x13\x03' }]);
  decoder.feed('\x13');
  assert.equal(actions.at(-1)?.type, 'submit');
});

it('treats plain multiline input as editing and collapses CRLF split between chunks', () => {
  const actions: KeyAction[] = [];
  const decoder = new TerminalInputDecoder(action => actions.push(action));
  decoder.feed('first\r'); decoder.feed('\nsecond\n');
  assert.deepEqual(actions, [
    { type: 'insert', text: 'first' }, { type: 'insert', text: '\n' },
    { type: 'insert', text: 'second' }, { type: 'insert', text: '\n' },
  ]);
});

it('discards an oversized paste through its terminator and resumes actual key handling', () => {
  const actions: KeyAction[] = [];
  const decoder = new TerminalInputDecoder(action => actions.push(action));
  decoder.feed('\x1b[200~' + 'x'.repeat(DRAFT_BYTES + 1));
  decoder.feed('\x13\x03\x1b[201'); decoder.feed('~\x13');
  assert.deepEqual(actions.map(action => action.type), ['notice', 'submit']);
});

it('recognizes split arrow sequences and a standalone Escape without inserting escape bytes', () => {
  const actions: KeyAction[] = [];
  const decoder = new TerminalInputDecoder(action => actions.push(action));
  decoder.feed('\x1b['); decoder.feed('D');
  decoder.feed('\x1b'); decoder.flushEscape();
  decoder.feed('\x1b[999~');
  assert.deepEqual(actions, [{ type: 'left' }, { type: 'escape' }]);
});
