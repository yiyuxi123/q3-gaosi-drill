import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface ExportFile {
  blob: Blob;
  filename: string;
}

export interface DeliverFilesOptions {
  title: string;
  text?: string;
  preferShare?: boolean;
  desktopClipboard?: boolean;
}

export type FileDeliveryMode = 'shared' | 'copied' | 'downloaded';

export function isMobileLike(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('文件编码失败'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(file: ExportFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function shareNativeFiles(files: ExportFile[], options: DeliverFilesOptions): Promise<void> {
  const stamp = Date.now();
  const uris: string[] = [];
  for (const [index, file] of files.entries()) {
    const safeName = file.filename.replace(/[\\/:*?"<>|]/g, '_');
    const result = await Filesystem.writeFile({
      path: `strj-exports/${stamp}-${index + 1}-${safeName}`,
      data: await blobToBase64(file.blob),
      directory: Directory.Cache,
      recursive: true
    });
    uris.push(result.uri);
  }
  await Share.share({
    title: options.title,
    text: options.text,
    files: uris,
    dialogTitle: options.title
  });
}

async function shareWebFiles(files: ExportFile[], options: DeliverFilesOptions): Promise<boolean> {
  if (!navigator.share || typeof navigator.canShare !== 'function' || typeof File === 'undefined') return false;
  const webFiles = files.map(file => new File([file.blob], file.filename, { type: file.blob.type }));
  if (!navigator.canShare({ files: webFiles })) return false;
  try {
    await navigator.share({ title: options.title, text: options.text, files: webFiles });
    return true;
  } catch {
    // A lost user activation, unsupported file type, or dismissed share sheet
    // must still leave the user with a retrievable export.
    return false;
  }
}

async function copyImageToClipboard(file: ExportFile): Promise<boolean> {
  if (
    !file.blob.type.startsWith('image/')
    || typeof navigator === 'undefined'
    || !navigator.clipboard?.write
    || typeof ClipboardItem === 'undefined'
  ) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [file.blob.type]: file.blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function deliverFiles(
  files: ExportFile[],
  options: DeliverFilesOptions
): Promise<FileDeliveryMode> {
  if (files.length === 0) throw new Error('没有可导出的文件');
  if (Capacitor.isNativePlatform()) {
    await shareNativeFiles(files, options);
    return 'shared';
  }

  if (options.preferShare && isMobileLike() && await shareWebFiles(files, options)) return 'shared';
  if (options.desktopClipboard && files.length === 1 && await copyImageToClipboard(files[0])) return 'copied';
  files.forEach(downloadBlob);
  return 'downloaded';
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('图片编码失败'));
    }, type, quality);
  });
}
