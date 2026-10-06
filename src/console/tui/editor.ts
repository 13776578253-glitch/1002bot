/** Owns only the local draft and grapheme-boundary cursor; Runtime output cannot edit it. */
import { graphemes, plainText, width, wrapText } from './text.ts';

/** 本地草稿上限，单位 UTF-8 字节；Runtime 的受理容量由公共接口决定。 */
export const DRAFT_BYTES = 64 * 1024;
export class DraftEditor {
  text = '';
  /** 原文 UTF-16 偏移，停在字素边界；不直接作为终端列号。 */
  cursor = 0;
  /** 只随正文改变递增，用于判断回执是否仍对应当前草稿。 */
  revision = 0;
  /** 跨短行移动时保留目标显示列，避免连续纵向移动丢失原列位置。 */
  private desiredColumn: number | undefined;

  /** 插入超限时整批拒绝，正文、光标与版本均保持。 */
  insert(text: string): boolean {
    const inserted = plainText(text);
    const next = this.text.slice(0, this.cursor) + inserted + this.text.slice(this.cursor);
    if (Buffer.byteLength(next, 'utf8') > DRAFT_BYTES) return false;
    const desired = this.cursor + inserted.length;
    this.text = next;
    // 插入可能与邻接字符组成新字素，重新寻找边界，避免光标落入组合字符内部。
    this.cursor = graphemes(next).map(part => part.index).find(index => index >= desired) ?? next.length;
    this.changed();
    return true;
  }
  clear(): void { this.text = ''; this.cursor = 0; this.changed(); }
  /** 异步受理期间的新编辑必须保留；仅清理提交时捕获的同一版本。 */
  clearIfUnchanged(revision: number): void { if (this.revision === revision) this.clear(); }
  left(): void { this.cursor = this.previous(); this.desiredColumn = undefined; }
  right(): void { this.cursor = this.next(); this.desiredColumn = undefined; }
  home(): void { this.cursor = this.cursor ? this.text.lastIndexOf('\n', this.cursor - 1) + 1 : 0; this.desiredColumn = undefined; }
  end(): void {
    const index = this.text.indexOf('\n', this.cursor);
    this.cursor = index < 0 ? this.text.length : index; this.desiredColumn = undefined;
  }
  backspace(): void {
    if (!this.cursor) return;
    const previous = this.previous();
    this.text = this.text.slice(0, previous) + this.text.slice(this.cursor);
    this.cursor = previous; this.changed();
  }
  delete(): void {
    if (this.cursor === this.text.length) return;
    this.text = this.text.slice(0, this.cursor) + this.text.slice(this.next()); this.changed();
  }
  /** 按当前折行与显示列跨行移动，最后将位置约束到原文区间。 */
  vertical(direction: number, columns: number): void {
    const rows = wrapText(this.text, columns);
    const position = this.position(columns);
    this.desiredColumn ??= position.column;
    const target = rows[position.row + direction];
    if (!target) return;
    let cells = 0, cursor = target.start;
    for (const part of graphemes(target.text)) {
      const size = width(part.segment);
      if (cells + size > this.desiredColumn) break;
      cells += size; cursor = target.start + part.index + part.segment.length;
    }
    this.cursor = Math.min(cursor, target.end);
  }
  /** 返回从零开始的显示行列；软折行边界归属于后一个显示行。 */
  position(columns: number): { row: number; column: number } {
    const rows = wrapText(this.text, columns);
    let row = 0;
    for (let index = 0; index < rows.length; index++) if (rows[index]!.start <= this.cursor) row = index;
    return { row, column: width(this.text.slice(rows[row]!.start, this.cursor)) };
  }
  private previous(): number { return graphemes(this.text).map(part => part.index).filter(index => index < this.cursor).at(-1) ?? 0; }
  private next(): number { return graphemes(this.text).map(part => part.index).find(index => index > this.cursor) ?? this.text.length; }
  private changed(): void { this.revision++; this.desiredColumn = undefined; }
}
