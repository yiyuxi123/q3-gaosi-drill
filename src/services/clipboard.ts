export interface ClipboardDependencies {
  writeText?: (text: string) => Promise<void>;
  legacyCopy?: (text: string) => boolean;
}

const legacyCopyText = (text: string): boolean => {
  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
    activeElement?.focus();
  }
};

export const copyTextToClipboard = async (
  text: string,
  dependencies?: ClipboardDependencies
): Promise<void> => {
  const writeText = dependencies
    ? dependencies.writeText
    : typeof navigator !== 'undefined' && navigator.clipboard?.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined;
  const fallback = dependencies ? dependencies.legacyCopy : legacyCopyText;
  let clipboardError: unknown;

  if (writeText) {
    try {
      await writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  if (fallback?.(text)) return;

  if (clipboardError instanceof Error) throw clipboardError;
  throw new Error('浏览器未授权访问剪贴板');
};
