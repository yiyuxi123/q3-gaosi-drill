/** Return vertical placements for rendering one tall image across PDF pages. */
export function calculatePdfPageOffsets(contentHeight: number, pageHeight: number): number[] {
  if (!Number.isFinite(contentHeight) || !Number.isFinite(pageHeight) || contentHeight <= 0 || pageHeight <= 0) {
    return [0];
  }

  const pageCount = Math.max(1, Math.ceil(contentHeight / pageHeight));
  return Array.from({ length: pageCount }, (_, index) => index === 0 ? 0 : -index * pageHeight);
}

export const PAPER_EXPORT_ROOT_ID = 'printable-paper';

export function requirePaperExportRoot(
  documentLike: Pick<Document, 'getElementById'> = document
): HTMLElement {
  const root = documentLike.getElementById(PAPER_EXPORT_ROOT_ID);
  if (!root) {
    throw new Error('找不到可导出的试卷内容，请重新生成试卷后再试。');
  }
  return root;
}

export function sanitizeDownloadFilename(value: string, fallback = '模拟试卷'): string {
  const withoutControlCharacters = Array.from(value, character => (
    character.charCodeAt(0) < 32 ? '_' : character
  )).join('');
  const sanitized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 120);
  return sanitized || fallback;
}
