/** Runs the full-screen Console through public admission, diagnostics and lifecycle APIs. */
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { runTerminal, type ConsoleRuntime } from '../terminal.ts';
import { TerminalInputDecoder, type KeyAction } from './input.ts';
import { TuiState } from './state.ts';
import { TuiView } from './view.ts';

/** 流可注入用于离线验证；全屏入口要求实际 TTY 与原始模式控制能力。 */
export interface TuiInput extends Readable { isTTY?: boolean; isRaw?: boolean; setRawMode?: (mode: boolean) => unknown }
/** columns/rows 为终端显示列行数，缺省采用 80×24；resize 后重新读取。 */
export interface TuiOutput extends Writable { isTTY?: boolean; columns?: number; rows?: number }
/** 未指定流时使用进程标准流；initialMessage 只进入本地活动展示。 */
export interface TuiOptions { input?: TuiInput; output?: TuiOutput; initialMessage?: string }
/** 本次启用备用屏幕和标准粘贴标记；退出时关闭并返回原屏幕。 */
export const SCREEN_ENTER = '\x1b[?1049h\x1b[?2004h\x1b[2J';
export const SCREEN_LEAVE = '\x1b[?2004l\x1b[?25h\x1b[0m\x1b[?1049l';

/** Runtime 由调用方装配和启动，退出由本入口停止；非原始 TTY 回退到行式 Console。 */
export async function runTui(runtime: ConsoleRuntime, options: TuiOptions = {}): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  if (!input.isTTY || !output.isTTY || !input.setRawMode) return runTerminal(runtime, { input, output });
  const state = new TuiState(runtime.status);
  const view = new TuiView();
  if (options.initialMessage) state.append(options.initialMessage);
  // 原始模式与流读取状态分别恢复；默认标准输入在退出后应停止读取。
  const rawBefore = !!input.isRaw;
  const flowingBefore = input.readableFlowing;
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  // blocked 仅表示输出流背压，不改变 Runtime 的受理或执行。
  let blocked = false, disposed = false, draining = false;
  // 保留首个异常，终端恢复失败不能覆盖最初的故障原因。
  let failure: unknown;
  let complete!: () => void;
  const closed = new Promise<void>(resolve => { complete = resolve; });
  const dimensions = () => ({ columns: Math.max(1, output.columns ?? 80), rows: Math.max(1, output.rows ?? 24) });

  /** EOF 等待可转为显式停止；完成信号必须晚于 Runtime 停止操作收束。 */
  function requestExit(drain = false): void {
    if (state.closing) {
      if (!drain && draining) { draining = false; void runtime.stop().catch(error => { failure ??= error; }); }
      return;
    }
    // 同步关闭本地提交入口，再等待现有 Runtime 的取消与写入屏障。
    state.closing = true;
    draining = drain;
    state.notice = drain ? '等待已受理输入完成后退出' : '停止中，等待执行与写入收束';
    schedule();
    void (async () => {
      try { if (drain) await runtime.inputs.idle(); await runtime.stop(); }
      catch (error) { failure ??= error; }
      finally { complete(); }
    })();
  }
  function fail(error: unknown): void { failure ??= error; requestExit(); }
  /** 一次写入一屏；write=false 后不继续堆积帧，等待 drain 绘制最新状态。 */
  function draw(): void {
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = undefined;
    if (disposed || blocked) return;
    try {
      const size = dimensions();
      const frame = view.frame(state, size.columns, size.rows);
      const screen = '\x1b[?25l' + frame.lines.map((line, row) => `\x1b[${row + 1};1H\x1b[2K${line}`).join('');
      const cursor = frame.cursor ? `\x1b[${frame.cursor.row + 1};${Math.min(size.columns, frame.cursor.column + 1)}H\x1b[?25h` : '';
      blocked = !output.write(screen + cursor);
    } catch (error) { fail(error); }
  }
  /** 16 ms 延后用于合并待绘状态，不是心跳或业务调度器。 */
  function schedule(): void { if (!disposed && !frameTimer && !blocked) frameTimer = setTimeout(draw, 16); }
  const onDrain = () => { blocked = false; schedule(); };

  /** 一次本地操作尚未取得回执时忽略重复提交；公共接口拥有实际受理结果。 */
  async function submit(): Promise<void> {
    if (state.submitting || state.closing) return;
    // 捕获正文及版本；编辑仍可继续，回执不得无条件清空后续修改。
    const draft = state.editor.text, revision = state.editor.revision;
    if (!draft.trim()) { state.notice = '请输入正文或命令'; schedule(); return; }
    state.submitting = true; state.notice = ''; schedule();
    try {
      if (draft.startsWith('/') && !draft.startsWith('//')) {
        // 命令仅调用已有生命周期/诊断接口；正文的 // 转义保持原行式语义。
        const line = draft.trim();
        if (line.includes('\n')) throw new Error('本地命令使用一行；以 // 发送 / 开头的正文');
        const [command, ...args] = line.split(/\s+/);
        if (command === '/help') { state.mode = 'help'; state.detailOffset = 0; }
        else if (command === '/quit') requestExit();
        else if (command === '/status') state.append(`Runtime=${runtime.status} active=${state.activeId ?? 'none'} 本端未完成=${state.pending.size}${state.gap ? '（诊断有缺口）' : ''}`);
        else if (command === '/inspect') {
          if (!args[0]) throw new Error('/inspect 需要输入 ID');
          state.append(`检查 ${args[0]}`, JSON.stringify(runtime.inputs.inspect(args[0]) ?? { status: 'expired_or_not_found' }, null, 2));
          state.selectedId = state.entries.at(-1)?.id; state.mode = 'details'; state.detailOffset = 0;
        } else if (command === '/cancel') {
          const id = args[0] ?? state.activeId;
          if (!id) throw new Error('没有可确定的活动输入；请指定 /cancel ID');
          state.append(`取消请求 · ${id}`);
          const receipt = await runtime.inputs.cancel(id);
          state.append(`取消回执 · ${receipt.status}${receipt.status === 'cancelled' ? ' · 最终状态以诊断结果为准' : ''}`, JSON.stringify(receipt, null, 2));
        } else if (command === '/stop' || command === '/start') {
          state.append(`${command} · 执行中`);
          await (command === '/stop' ? runtime.stop() : runtime.start());
          state.append(`${command} · 完成 · Runtime=${runtime.status}`);
        } else throw new Error('未知命令；F1 查看帮助；// 发送 / 开头的正文');
        state.editor.clearIfUnchanged(revision);
      } else {
        const text = draft.startsWith('//') ? draft.slice(1) : draft;
        const receipt = await runtime.inputs.submit({ inputId: randomUUID(), source: 'console-tui', content: { kind: 'text', text } });
        state.receipt(receipt, text);
        if (receipt.status === 'accepted') {
          // 回执交付前可能已经出现终态，先查公共快照再统计本端未完成数。
          const snapshot = runtime.inputs.inspect(receipt.inputId);
          if (!snapshot || ['queued', 'running', 'write_pending'].includes(snapshot.status)) state.pending.add(receipt.inputId);
          state.editor.clearIfUnchanged(revision);
          if (state.editor.text) state.notice = '已受理；受理期间编辑的草稿已保留';
        } else state.notice = `拒绝 ${receipt.code}: ${receipt.message}`;
      }
    } catch (error) {
      state.notice = error instanceof Error ? error.message : String(error);
      state.append(`操作失败 · ${state.notice}`);
    } finally { state.submitting = false; state.status = runtime.status; schedule(); }
  }
  /** 焦点决定编辑对象；退出键在 closing 期间仍可将等待切换为取消停止。 */
  function action(key: KeyAction): void {
    if (key.type === 'quit') { requestExit(); return; }
    if (key.type === 'drain') { requestExit(true); return; }
    if (state.closing) return;
    const size = dimensions();
    const editor = state.editor;
    switch (key.type) {
      case 'submit': if (state.mode === 'main' && state.focus === 'editor') void submit(); break;
      case 'insert':
        if (state.mode === 'main' && state.focus === 'editor' && !editor.insert(key.text)) state.notice = '草稿超过 64 KiB，输入未插入';
        break;
      case 'notice': state.notice = key.text; break;
      case 'escape': state.mode = 'main'; state.focus = 'editor'; break;
      case 'help': state.mode = state.mode === 'help' ? 'main' : 'help'; state.detailOffset = 0; break;
      case 'details': state.mode = state.mode === 'details' ? 'main' : 'details'; state.detailOffset = 0; break;
      case 'focus':
        state.mode = 'main'; state.focus = state.focus === 'editor' ? 'activity' : 'editor';
        if (state.focus === 'activity') view.pause(state, size.columns, size.rows);
        break;
      case 'follow': state.follow(); state.mode = 'main'; state.focus = 'editor'; break;
      case 'page_up': view.scroll(state, size.columns, size.rows, -1); break;
      case 'page_down': view.scroll(state, size.columns, size.rows, 1); break;
      case 'up': case 'down':
        if (state.focus === 'activity') { state.select(key.type === 'up' ? -1 : 1); state.mode = 'main'; view.reveal(state, size.columns, size.rows); }
        else if (state.mode === 'main') editor.vertical(key.type === 'up' ? -1 : 1, Math.max(1, size.columns - 3));
        break;
      case 'left': case 'right': case 'home': case 'end': case 'backspace': case 'delete': case 'clear':
        if (state.mode === 'main' && state.focus === 'editor') editor[key.type]();
        break;
    }
    schedule();
  }
  const decoder = new TerminalInputDecoder(action);
  const onData = (chunk: Buffer | string) => {
    try {
      if (escapeTimer) clearTimeout(escapeTimer);
      decoder.feed(chunk);
      // 为分块 Escape 序列留 100 ms；超时清理未完成前缀，不进入 Runtime。
      if (decoder.pendingEscape) escapeTimer = setTimeout(() => { decoder.flushEscape(); schedule(); }, 100);
    } catch (error) { fail(error); }
  };
  const onEnd = () => { decoder.finish(); requestExit(true); };
  const onSignal = () => requestExit();
  const onResize = () => schedule();
  // 先订阅再同步补读保留窗口，用公共 seq 排重；缺口只提示诊断不完整。
  const unsubscribe = runtime.inputs.subscribe(event => { state.event(event); schedule(); });
  try {
    const retained = runtime.inputs.eventsSince(0);
    state.gap = retained.gap;
    for (const event of retained.events) state.event(event);
    state.status = runtime.status;
    input.setRawMode(true);
    output.on('error', fail); input.on('error', fail);
    output.on('drain', onDrain); output.on('resize', onResize);
    input.on('data', onData); input.on('end', onEnd);
    process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
    output.write(SCREEN_ENTER); input.resume(); draw();
    await closed;
    draw();
  } catch (error) {
    failure ??= error; requestExit(); await closed;
  } finally {
    // 先禁止后续重绘并撤销监听，再恢复输入模式和屏幕；不丢弃 Runtime 已进入的写入。
    disposed = true;
    if (frameTimer) clearTimeout(frameTimer);
    if (escapeTimer) clearTimeout(escapeTimer);
    unsubscribe();
    input.off('data', onData); input.off('end', onEnd); input.off('error', fail);
    output.off('drain', onDrain); output.off('resize', onResize);
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    try { input.setRawMode(rawBefore); }
    catch (error) { failure ??= error; }
    if (flowingBefore !== true) input.pause();
    try { if (!output.destroyed && output.writable) output.write(SCREEN_LEAVE); } catch (error) { failure ??= error; }
    output.off('error', fail);
  }
  if (failure) throw failure;
}
