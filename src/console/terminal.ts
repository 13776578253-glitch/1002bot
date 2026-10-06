/** Console consumes admission, diagnostics and lifecycle APIs without owning World or model execution. */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { InputChannel, OutputEvent } from '../protocol/index.ts';

/** Console depends on this public capability boundary rather than Runtime internals. */
export interface ConsoleRuntime {
  readonly inputs: InputChannel;
  readonly status: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** 将终端编辑和本地命令转换为通用输入；options 可替换流以支持离线交互测试。 */
export async function runTerminal(runtime: ConsoleRuntime, options: { input?: Readable; output?: Writable } = {}): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const write = (text: string) => { output.write(`${text}\n`); };
  /** 只统计本终端受理后尚未收到最终事件的输入，不代表 Runtime 的完整快照。 */
  const pending = new Set<string>();
  let active: string | undefined;
  let interrupted = false;
  /** undefined 表示单行模式，空数组表示已经开始编辑多行正文。 */
  let block: string[] | undefined;
  const unsubscribe = runtime.inputs.subscribe((event) => {
    if (event.type === 'run_started') active = event.inputId ?? undefined;
    if (event.type === 'run_finished' && event.inputId) { pending.delete(event.inputId); if (active === event.inputId) active = undefined; }
    if (event.type !== 'queued') write(format(event));
  });
  const lines = createInterface({ input, output, terminal: !!(input as NodeJS.ReadStream).isTTY, crlfDelay: Infinity });
  lines.on('SIGINT', () => { interrupted = true; lines.close(); void runtime.stop().catch((error: unknown) => write(`stop: ${String(error)}`)); });
  write('Console · /help · /begin 多行 · /quit 取消并退出；EOF 等待队列完成后退出');
  try {
    for await (const line of lines) {
      if (interrupted) break;
      if (block) {
        // 多行编辑仅识别发送和丢弃，其余以 / 开头的行也属于正文。
        if (line === '/discard') { block = undefined; write('多行输入已丢弃'); continue; }
        if (line !== '/send') { block.push(line); continue; }
      } else if (line === '/begin') { block = []; continue; }
      else if (line.startsWith('/') && !line.startsWith('//')) {
        // 本地命令不进入模型；// 转义后作为普通正文提交。
        const [command, ...args] = line.trim().split(/\s+/);
        if (command === '/help') write('/begin → /send 多行提交；/discard 丢弃；/cancel [ID]；/inspect ID；/status；/stop；/start；/quit；// 开头发送单个 /');
        else if (command === '/status') write(`Runtime=${runtime.status} active=${active ?? 'none'} pending=${pending.size}`);
        else if (command === '/inspect') write(JSON.stringify(runtime.inputs.inspect(args[0] ?? '') ?? { status: 'expired_or_not_found' }));
        else if (command === '/cancel') write(JSON.stringify(await runtime.inputs.cancel(args[0] ?? active ?? '')));
        else if (command === '/stop') await runtime.stop();
        else if (command === '/start') await runtime.start();
        else if (command === '/quit') { interrupted = true; await runtime.stop(); break; }
        else write('未知命令；/help 查看命令；// 开头发送单个 /');
        continue;
      }
      const text = block ? block.join('\n') : line.startsWith('//') ? line.slice(1) : line;
      block = undefined;
      const inputId = randomUUID();
      const receipt = await runtime.inputs.submit({ inputId, source: 'console', content: { kind: 'text', text } });
      if (receipt.status === 'accepted') { pending.add(inputId); write(`[${inputId}] accepted #${receipt.queueSequence}`); }
      else write(`[${inputId}] rejected ${receipt.code}: ${receipt.message}`);
    }
    if (block) write('EOF：未提交的多行输入已丢弃');
    // EOF 等待已受理输入完成；显式退出和 SIGINT 已走停止取消路径。
    if (!interrupted) await runtime.inputs.idle();
  } finally { lines.close(); await runtime.stop(); unsubscribe(); }
}

/** 只格式化公共诊断字段，完整回复仅在最终结果中展示。 */
function format(event: OutputEvent): string {
  if (event.type === 'runtime_status') return `Runtime=${event.status}`;
  const prefix = `[${event.inputId}]${event.round !== undefined ? ` round=${event.round}` : ''}`;
  if (event.type === 'run_finished' && event.result) {
    const result = event.result;
    return `${prefix} ${result.status}${result.code ? ` ${result.code}` : ''} persisted=${result.persisted}${result.message ? `: ${result.message}` : ''}${result.reply ? `\n${result.reply}` : ''}`;
  }
  return `${prefix} ${event.type}${event.callId ? ` ${event.callId} ${event.toolName}` : ''}${event.status ? ` ${event.status}` : ''}${event.error ? ` ${event.error.code}: ${event.error.message}` : ''}`;
}
