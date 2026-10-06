/** Unicode layout and plain-text projection shared by the editor and screen renderer. */
import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (text: string) => [...segmenter.segment(text)];
/** 显示列宽与字符串 UTF-16 索引分开计量；编辑和布局使用同一宽度规则。 */
export const width = (text: string) => stringWidth(text);

/** 仅驱动生成控制序列；正文中的控制字符显示为替代字符。 */
export function plainText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '�');
}

/** 折行保留原文 UTF-16 区间 [start, end)，换行符不属于行内文本。 */
export interface TextRow { text: string; start: number; end: number }
/** columns 为正的显示列数；过宽字素仅替换显示，仍保留原文位置。 */
export function wrapText(text: string, columns: number): TextRow[] {
  const rows: TextRow[] = [];
  let row = '', start = 0, end = 0, cells = 0;
  for (const part of graphemes(text)) {
    if (part.segment === '\n') {
      rows.push({ text: row, start, end: part.index });
      row = ''; cells = 0; start = end = part.index + 1;
      continue;
    }
    const partWidth = width(part.segment);
    if (cells && cells + partWidth > columns) {
      rows.push({ text: row, start, end });
      row = ''; cells = 0; start = part.index;
    }
    row += partWidth > columns ? '�' : part.segment;
    cells += Math.min(partWidth, columns);
    end = part.index + part.segment.length;
  }
  rows.push({ text: row, start, end });
  return rows;
}

/** 将单行显示限制在非负列数内，不截断字素；不返回终端控制字符。 */
export function fitText(text: string, columns: number): string {
  let result = '', cells = 0;
  for (const part of graphemes(plainText(text).replaceAll('\n', ' '))) {
    const size = width(part.segment);
    if (cells + size > columns) break;
    result += part.segment; cells += size;
  }
  return result;
}
