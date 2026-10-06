/** Decodes terminal keys and bounded bracketed paste across arbitrary UTF-8 chunks. */
import { StringDecoder } from 'node:string_decoder';
import { DRAFT_BYTES } from './editor.ts';

/** 本地编辑/控制意图；解码器不受理输入、不查询 Runtime。 */
export type KeyAction = { type: 'insert' | 'notice'; text: string } | {
  type: 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'backspace' | 'delete' |
    'submit' | 'quit' | 'drain' | 'escape' | 'help' | 'details' | 'focus' | 'page_up' | 'page_down' | 'follow' | 'clear';
};
const keys: Record<string, KeyAction['type']> = {
  '\x01': 'home', '\x03': 'quit', '\x04': 'drain', '\x05': 'end', '\x08': 'backspace',
  '\x09': 'focus', '\x0c': 'follow', '\x13': 'submit', '\x15': 'clear', '\x7f': 'backspace',
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[1~': 'home', '\x1b[4~': 'end',
  '\x1b[7~': 'home', '\x1b[8~': 'end', '\x1b[3~': 'delete',
  '\x1b[5~': 'page_up', '\x1b[6~': 'page_down', '\x1bOP': 'help', '\x1bOQ': 'details',
  '\x1b[11~': 'help', '\x1b[12~': 'details', '\x1bOA': 'up', '\x1bOB': 'down',
  '\x1bOC': 'right', '\x1bOD': 'left', '\x1bOH': 'home', '\x1bOF': 'end',
};
const pasteStart = '\x1b[200~', pasteEnd = '\x1b[201~';

export class TerminalInputDecoder {
  /** 字节块边界可能截断 UTF-8 字符，必须先解码再识别控制序列。 */
  private readonly decoder = new StringDecoder('utf8');
  /** 保留尚未完整的控制序列或粘贴结束标记前缀。 */
  private buffer = '';
  /** undefined 表示按键模式；空字符串也表示已经进入粘贴模式。 */
  private paste: string | undefined;
  /** 超限后继续消费到结束标记，不能将剩余粘贴当成快捷键执行。 */
  private pasteOverflow = false;
  /** 即使 CR 与 LF 分块到达，也只插入一次换行。 */
  private afterCR = false;
  private readonly emit: (action: KeyAction) => void;
  constructor(emit: (action: KeyAction) => void) { this.emit = emit; }
  get pendingEscape(): boolean { return this.paste === undefined && this.buffer.startsWith('\x1b'); }
  feed(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.parse();
  }
  /** 由驱动超时调用；独立 Escape 返回界面，未完成序列被丢弃。 */
  flushEscape(): void {
    if (this.buffer === '\x1b') this.emit({ type: 'escape' });
    this.buffer = '';
  }
  /** EOF 消费可解码尾部并丢弃未结束粘贴，不将半段粘贴提交给编辑器。 */
  finish(): void { this.buffer += this.decoder.end(); this.parse(); this.buffer = ''; this.paste = undefined; }
  private parse(): void {
    while (this.buffer) {
      if (this.paste !== undefined) {
        const end = this.buffer.indexOf(pasteEnd);
        if (end >= 0) {
          this.appendPaste(this.buffer.slice(0, end));
          this.emit(this.pasteOverflow ? { type: 'notice', text: '粘贴超过 64 KiB，草稿未改变' } : { type: 'insert', text: this.paste });
          this.buffer = this.buffer.slice(end + pasteEnd.length);
          this.paste = undefined; this.pasteOverflow = false;
          continue;
        }
        let suffix = 0;
        // 结束标记可跨块到达，仅保留匹配前缀，其余内容进入有限粘贴缓冲。
        for (let size = 1; size < pasteEnd.length; size++) if (this.buffer.endsWith(pasteEnd.slice(0, size))) suffix = size;
        this.appendPaste(this.buffer.slice(0, this.buffer.length - suffix));
        this.buffer = this.buffer.slice(this.buffer.length - suffix);
        return;
      }
      if (this.buffer.startsWith(pasteStart)) {
        this.paste = ''; this.afterCR = false; this.buffer = this.buffer.slice(pasteStart.length); continue;
      }
      if (this.buffer.startsWith('\x1b')) {
        const sequence = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.)/.exec(this.buffer)?.[0];
        if (!sequence) {
          if (this.buffer.length === 1 || this.buffer.startsWith('\x1b[') || this.buffer.startsWith('\x1bO')) {
            // 控制序列最多保留 32 个 UTF-16 单元，缺失结束符不能无限积压。
            if (this.buffer.length > 32) this.buffer = '';
            return;
          }
          this.buffer = this.buffer.slice(2); continue;
        }
        this.key(sequence); this.buffer = this.buffer.slice(sequence.length); this.afterCR = false; continue;
      }
      const text = /^[^\x00-\x1f\x7f-\x9f]+/u.exec(this.buffer)?.[0];
      if (text) {
        this.emit({ type: 'insert', text }); this.buffer = this.buffer.slice(text.length); this.afterCR = false; continue;
      }
      const character = this.buffer[0]!;
      if (character === '\r' || character === '\n') {
        if (!(character === '\n' && this.afterCR)) this.emit({ type: 'insert', text: '\n' });
        this.afterCR = character === '\r';
      } else { this.key(character); this.afterCR = false; }
      this.buffer = this.buffer.slice(1);
    }
  }
  private key(sequence: string): void {
    const type = keys[sequence];
    if (type && type !== 'insert' && type !== 'notice') this.emit({ type });
  }
  private appendPaste(text: string): void {
    if (this.pasteOverflow) return;
    if (Buffer.byteLength(this.paste! + text) > DRAFT_BYTES) { this.paste = ''; this.pasteOverflow = true; }
    else this.paste += text;
  }
}
