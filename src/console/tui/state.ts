/** Bounded public diagnostics and local view state, independent of Runtime scheduling. */
import type { InputReceipt, OutputEvent } from '../../protocol/index.ts';
import { DraftEditor } from './editor.ts';
import { plainText } from './text.ts';

/** 仅限制显示缓存；bytes 计摘要和详情的 UTF-8 字节，不限制 Session 历史。 */
export const DISPLAY_LIMITS = Object.freeze({ entries: 128, bytes: 512 * 1024, fieldBytes: 16 * 1024 });
/** id 是本地展示标识；摘要发布后保持不变，供布局缓存和回看引用。 */
export interface ActivityEntry { id: number; text: string; details: string; bytes: number }
/** 按本地条目与折行号定位，不用可能被新输出或淘汰改变的全局屏幕行号。 */
export interface ViewAnchor { entryId: number; line: number }

export class TuiState {
  readonly editor = new DraftEditor();
  readonly entries: ActivityEntry[] = [];
  /** 仅跟踪本端已受理且尚未收到终态的 ID；不拥有执行队列。 */
  readonly pending = new Set<string>();
  status: string;
  /** 最近开始且尚未结束的 UserInput ID；不据此推断 Runtime 全局活动触发。 */
  activeId: string | undefined;
  selectedId: number | undefined;
  /** undefined 跟随最新；指定锚点时新活动只增加未读数量。 */
  anchor: ViewAnchor | undefined;
  focus: 'editor' | 'activity' = 'editor';
  mode: 'main' | 'help' | 'details' = 'main';
  detailOffset = 0;
  notice = '';
  /** 缺口使基于诊断的统计不完整；不据此推断执行失败或自动恢复。 */
  gap = false;
  unread = 0;
  submitting = false;
  closing = false;
  private nextId = 0;
  private displayBytes = 0;
  /** 消费位置只属于公开诊断通道，不是 Session 提交或持久化游标。 */
  private seq = 0;

  constructor(status: string) { this.status = status; }
  /** 调用方提供公开诊断或本地反馈；截断先于保留总量计量。 */
  append(text: string, details = text): void {
    const bounded = (value: string) => {
      const clean = plainText(value);
      if (Buffer.byteLength(clean) <= DISPLAY_LIMITS.fieldBytes) return clean;
      return Buffer.from(clean).subarray(0, DISPLAY_LIMITS.fieldBytes).toString('utf8') + '\n[展示内容已截断]';
    };
    const entry = { id: ++this.nextId, text: bounded(text), details: bounded(details), bytes: 0 };
    entry.bytes = Buffer.byteLength(entry.text) + Buffer.byteLength(entry.details);
    this.entries.push(entry); this.displayBytes += entry.bytes;
    while (this.entries.length > DISPLAY_LIMITS.entries || this.displayBytes > DISPLAY_LIMITS.bytes) {
      this.displayBytes -= this.entries.shift()!.bytes;
    }
    if (this.anchor || this.mode !== 'main' || this.focus === 'activity') this.unread++;
    else this.selectedId = entry.id;
  }
  receipt(receipt: InputReceipt, text: string): void {
    const label = `[${receipt.inputId.slice(0, 8)}]`;
    this.append(receipt.status === 'accepted' ? `${label} 已受理 #${receipt.queueSequence}\n${text}` :
      `${label} 拒绝 ${receipt.code}: ${receipt.message}`, JSON.stringify({ receipt, text }, null, 2));
  }
  /** 终态、运行状态和工具结果沿用公共事实；忽略已消费通知并标记缺口。 */
  event(event: OutputEvent): void {
    if (event.seq <= this.seq) return;
    if (event.seq > this.seq + 1) this.gap = true;
    this.seq = event.seq;
    if (event.type === 'runtime_status') {
      this.status = event.status ?? this.status;
      this.append(`Runtime · ${this.status}`, JSON.stringify(event, null, 2)); return;
    }
    if (event.type === 'run_started') this.activeId = event.inputId ?? undefined;
    if (event.type === 'run_finished' && event.inputId) {
      this.pending.delete(event.inputId);
      if (this.activeId === event.inputId) this.activeId = undefined;
    }
    // 摘要允许缩短身份；详情保留完整公共字段，非用户触发不进入本端 pending。
    const label = event.inputId?.slice(0, 8) ?? `${event.triggerKind ?? 'runtime'}:${event.triggerId?.slice(0, 8) ?? 'tick'}`;
    const prefix = `[${label}]${!event.inputId && event.source ? ` source=${event.source}` : ''}`;
    let text: string;
    if (event.type === 'run_finished' && event.result) {
      const result = event.result;
      text = `${prefix} ${result.status} · persisted=${result.persisted}${result.code ? ` · ${result.code}` : ''}${result.message ? `: ${result.message}` : ''}${result.reply ? `\n${result.reply}` : ''}`;
    } else {
      text = `${prefix} ${event.type}${event.round !== undefined ? ` · round=${event.round}` : ''}${event.toolName ? ` · ${event.toolName}` : ''}${event.status ? ` · ${event.status}` : ''}${event.error ? ` · ${event.error.code}: ${event.error.message}` : ''}`;
    }
    this.append(text, JSON.stringify(event, null, 2));
  }
  follow(): void { this.anchor = undefined; this.unread = 0; this.selectedId = this.entries.at(-1)?.id; }
  select(direction: number): void {
    const current = this.entries.findIndex(entry => entry.id === this.selectedId);
    this.selectedId = this.entries[Math.max(0, Math.min(this.entries.length - 1, current + direction))]?.id;
  }
}
