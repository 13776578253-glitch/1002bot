/** Builds terminal-sized frames and anchors activity scrolling to retained entries. */
import type { TuiState, ViewAnchor } from './state.ts';
import { fitText, wrapText } from './text.ts';

interface ActivityRow extends ViewAnchor { text: string }
/** 行文本已限制列宽；光标行列从零开始，undefined 要求驱动隐藏光标。 */
export interface TuiFrame { lines: string[]; cursor: { row: number; column: number } | undefined }
const help = [
  '操作帮助', '', 'Enter 换行 · Ctrl+S 提交 · Ctrl+U 清空草稿',
  '方向键编辑 · Home / End 行首与行尾',
  'Tab 切换输入/活动 · 活动中 ↑↓ 选择 · F2 查看详情',
  'PgUp / PgDn 回看 · Ctrl+L 跟随最新 · F1 帮助 · Esc 返回输入',
  '/status · /inspect ID · /cancel [ID] · /stop · /start · /quit',
  '// 发送以 / 开头的正文 · Ctrl+C 停止退出 · Ctrl+D 等待完成退出',
];

export class TuiView {
  /** 仅缓存当前保留条目的折行；窗口宽度变化后重算，不缓存运行事实。 */
  private readonly cache = new Map<number, { columns: number; rows: ActivityRow[] }>();
  private activityRows(state: TuiState, columns: number): ActivityRow[] {
    const retained = new Set(state.entries.map(entry => entry.id));
    for (const id of this.cache.keys()) if (!retained.has(id)) this.cache.delete(id);
    const result: ActivityRow[] = [];
    for (const entry of state.entries) {
      let cached = this.cache.get(entry.id);
      if (!cached || cached.columns !== columns) {
        const rows = wrapText(entry.text, columns).map((row, line) => ({ text: row.text, entryId: entry.id, line }));
        rows.push({ text: '', entryId: entry.id, line: rows.length });
        cached = { columns, rows }; this.cache.set(entry.id, cached);
      }
      result.push(...cached.rows);
    }
    return result;
  }
  private start(state: TuiState, rows: ActivityRow[], height: number): number {
    const end = Math.max(0, rows.length - height);
    if (!state.anchor) return end;
    let index = rows.findIndex(row => row.entryId === state.anchor!.entryId && row.line === state.anchor!.line);
    // 变宽可能消除原折行，仍定位到同一条目；淘汰则回到当前保留窗口开头。
    if (index < 0) index = rows.findIndex(row => row.entryId === state.anchor!.entryId);
    return Math.min(end, Math.max(0, index));
  }
  /** 每次按可见高度翻页；只有活动视图到达底部才恢复跟随。 */
  scroll(state: TuiState, columns: number, height: number, direction: number): void {
    const frameHeight = this.activityHeight(state, columns, height);
    if (state.mode !== 'main') {
      const text = state.mode === 'help' ? help.join('\n') : state.entries.find(entry => entry.id === state.selectedId)?.details ?? '';
      const length = wrapText(text, Math.max(1, columns - 1)).length;
      state.detailOffset = Math.max(0, Math.min(Math.max(0, length - frameHeight), state.detailOffset + direction * frameHeight));
      return;
    }
    const rows = this.activityRows(state, Math.max(1, columns - 3));
    const top = Math.max(0, Math.min(Math.max(0, rows.length - frameHeight), this.start(state, rows, frameHeight) + direction * frameHeight));
    if (direction > 0 && top === Math.max(0, rows.length - frameHeight)) state.follow();
    else {
      const row = rows[top];
      state.anchor = row ? { entryId: row.entryId, line: row.line } : undefined;
    }
  }
  /** 将当前可见首行变为回看锚点，使活动焦点不被新输出带走。 */
  pause(state: TuiState, columns: number, height: number): void {
    const rows = this.activityRows(state, Math.max(1, columns - 3));
    const row = rows[this.start(state, rows, this.activityHeight(state, columns, height))];
    state.anchor = row ? { entryId: row.entryId, line: row.line } : undefined;
  }
  reveal(state: TuiState, columns: number, height: number): void {
    const rows = this.activityRows(state, Math.max(1, columns - 3));
    const index = rows.findIndex(row => row.entryId === state.selectedId);
    const frameHeight = this.activityHeight(state, columns, height);
    const top = this.start(state, rows, frameHeight);
    if (index >= 0 && (index < top || index >= top + frameHeight)) {
      const row = rows[Math.min(index, Math.max(0, rows.length - frameHeight))]!;
      state.anchor = { entryId: row.entryId, line: row.line };
    }
  }
  private activityHeight(state: TuiState, columns: number, height: number): number {
    const draftRows = wrapText(state.editor.text, Math.max(1, columns - 3)).length;
    return Math.max(1, height - Math.min(Math.max(1, height - 5), Math.min(6, draftRows)) - 4);
  }
  /** 生成一屏本地展示，不修改草稿或 Runtime；高度不足时优先保留当前编辑行。 */
  frame(state: TuiState, columns: number, height: number): TuiFrame {
    columns = Math.max(1, columns); height = Math.max(1, height);
    // 留出前缀和末列；正文不触发终端自动换行，行位置由驱动显式控制。
    const contentWidth = Math.max(1, columns - 3);
    const lines: string[] = [];
    const active = state.activeId ? `处理 ${state.activeId.slice(0, 8)}` : state.status === 'running' ? '等待触发' : '无活动';
    lines.push(fitText(`Console · ${state.status} · ${active} · 本端未完成=${state.gap ? '?' : state.pending.size}`, columns - 1));
    if (height < 7) {
      const draft = wrapText(state.editor.text, contentWidth);
      const position = state.editor.position(contentWidth);
      if (height > 1) lines.push(fitText(`› ${draft[position.row]!.text}`, columns - 1));
      if (height > 2) lines.push(fitText(state.notice || 'Ctrl+S 提交 · Ctrl+C 退出', columns - 1));
      while (lines.length < height) lines.push('');
      return { lines, cursor: state.focus === 'editor' ? { row: Math.min(1, height - 1), column: Math.min(columns - 1, position.column + 2) } : undefined };
    }
    const draft = wrapText(state.editor.text, contentWidth);
    const editorHeight = Math.min(6, draft.length, height - 5);
    const activityHeight = height - editorHeight - 4;
    const rows = this.activityRows(state, contentWidth);
    const top = this.start(state, rows, activityHeight);
    let activity: string[];
    if (state.mode === 'help') activity = help.flatMap(line => wrapText(line, columns - 1).map(row => row.text)).slice(state.detailOffset);
    else if (state.mode === 'details') {
      const selected = state.entries.find(entry => entry.id === state.selectedId);
      activity = wrapText(selected?.details ?? '该条目已从展示缓存淘汰', columns - 1).map(row => row.text).slice(state.detailOffset);
    } else {
      activity = rows.slice(top, top + activityHeight).map(row =>
        `${row.entryId === state.selectedId && state.focus === 'activity' ? '› ' : '  '}${row.text}`);
    }
    const dropped = state.anchor && !rows.some(row => row.entryId === state.anchor!.entryId);
    if (dropped && state.mode === 'main') activity[0] = '回看位置已淘汰；Ctrl+L 返回最新';
    for (let index = 0; index < activityHeight; index++) lines.push(fitText(activity[index] ?? '', columns - 1));
    lines.push(fitText(`${state.mode === 'main' ? state.focus === 'activity' ? '活动' : '输入' : state.mode === 'help' ? '帮助' : '详情'} · ${state.anchor ? '回看' : '跟随'}${state.unread ? ` · 新增 ${state.unread}` : ''}${state.gap ? ' · 诊断记录不完整' : ''}${state.submitting ? ' · 受理中' : ''}`, columns - 1));
    const position = state.editor.position(contentWidth);
    // 编辑区最多六行，视口随草稿光标移动，不受活动回看位置影响。
    const draftTop = Math.max(0, position.row - editorHeight + 1);
    const editorStart = lines.length;
    for (let index = 0; index < editorHeight; index++) lines.push(fitText(`${index ? '  ' : '› '}${draft[draftTop + index]?.text ?? ''}`, columns - 1));
    lines.push(fitText(state.notice, columns - 1));
    lines.push(fitText('Ctrl+S 提交 · Enter 换行 · Tab 活动 · F1 帮助 · F2 详情 · Ctrl+C 退出', columns - 1));
    return { lines, cursor: state.focus === 'editor' && state.mode === 'main' ? { row: editorStart + position.row - draftTop, column: position.column + 2 } : undefined };
  }
}
