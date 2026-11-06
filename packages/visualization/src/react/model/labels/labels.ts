/** Label dimensions shared by placement and saved view records. */
export function measureLabel(text: string): { width: number; height: number } {
  return { width: Math.max(44, Array.from(text).reduce((sum, character) => sum + (/[^\u0000-\u007f]/.test(character) ? 12 : 7), 0) + 16), height: 24 };
}
