#!/usr/bin/env node
/** Manual TTY capability probe; it never creates a Runtime or sends input to a model. */
import { TerminalInputDecoder } from './input.ts';
import { width, plainText } from './text.ts';

const input = process.stdin, output = process.stdout;
if (!input.isTTY || !output.isTTY) {
  process.stderr.write('终端探针需要交互式 TTY，请在终端运行 pnpm probe:tui\n');
  process.exitCode = 1;
} else {
  const rawBefore = input.isRaw;
  const flowingBefore = input.readableFlowing;
  let complete!: () => void, reject!: (error: Error) => void;
  const closed = new Promise<void>((resolve, fail) => { complete = resolve; reject = fail; });
  const decoder = new TerminalInputDecoder(action => {
    // 摘要最多显示 80 个 UTF-16 单元；字节数与列宽仍按实际收到的整段计量。
    output.write(JSON.stringify(action.type === 'insert' || action.type === 'notice' ?
      { type: action.type, text: action.text.slice(0, 80), bytes: Buffer.byteLength(action.text), cells: width(plainText(action.text)) } : action) + '\r\n');
    if (action.type === 'quit' || action.type === 'drain') complete();
  });
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  const onData = (chunk: Buffer) => {
    if (escapeTimer) clearTimeout(escapeTimer);
    decoder.feed(chunk);
    if (decoder.pendingEscape) escapeTimer = setTimeout(() => decoder.flushEscape(), 100);
  };
  const onResize = () => output.write(JSON.stringify({ columns: output.columns, rows: output.rows }) + '\r\n');
  try {
    input.setRawMode(true); output.write('\x1b[?2004h');
    output.write(`TTY 探针 · Node ${process.versions.node} · ${process.platform}\r\n`);
    output.write('测试中文输入法、Enter、Ctrl+S、多行粘贴、方向键、F1/F2 和缩放；Ctrl+C 退出\r\n');
    onResize();
    input.on('data', onData); input.on('end', complete); input.on('error', reject);
    output.on('resize', onResize); output.on('error', reject); process.on('SIGINT', complete);
    input.resume(); await closed;
  } finally {
    // 探针也需要解除原始模式和粘贴模式，避免影响后续终端命令。
    if (escapeTimer) clearTimeout(escapeTimer);
    input.off('data', onData); input.off('end', complete); input.off('error', reject);
    output.off('resize', onResize); output.off('error', reject); process.off('SIGINT', complete);
    input.setRawMode(rawBefore); output.write('\x1b[?2004l');
    if (flowingBefore !== true) input.pause();
  }
}
