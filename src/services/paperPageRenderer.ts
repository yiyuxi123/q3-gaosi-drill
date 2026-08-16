import html2canvas from 'html2canvas-pro';
import { canvasToBlob } from './fileDelivery';

export interface PaperBlockLayout {
  height: number;
  forceBreakBefore?: boolean;
  keepTogether?: boolean;
}

export interface PaperBlockSlice {
  blockIndex: number;
  pageIndex: number;
  y: number;
  sourceY: number;
  height: number;
}

export interface RenderedPaperPage {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

export function calculateContinuousImageSize(
  sourceWidth: number,
  sourceHeight: number,
  preferredWidth = 820,
  maxHeight = 24_000,
  maxPixels = 12_000_000
): { width: number; height: number } {
  const safeWidth = Math.max(1, Number.isFinite(sourceWidth) ? sourceWidth : 1);
  const safeHeight = Math.max(1, Number.isFinite(sourceHeight) ? sourceHeight : 1);
  const ratio = safeHeight / safeWidth;
  const heightLimitedWidth = Math.floor(maxHeight / ratio);
  const pixelLimitedWidth = Math.floor(Math.sqrt(maxPixels / ratio));
  const width = Math.max(1, Math.min(preferredWidth, heightLimitedWidth, pixelLimitedWidth));
  return { width, height: Math.max(1, Math.round(width * ratio)) };
}

export function calculateLongImageSize(
  pageCount: number,
  pageRatio = 297 / 210,
  preferredWidth = 1240,
  maxHeight = 30_000,
  maxPixels = 18_000_000
): { width: number; height: number } {
  const count = Math.max(1, Math.floor(pageCount));
  const ratio = Number.isFinite(pageRatio) && pageRatio > 0 ? pageRatio : 297 / 210;
  const heightLimitedWidth = Math.floor(maxHeight / ratio / count);
  const pixelLimitedWidth = Math.floor(Math.sqrt(maxPixels / ratio / count));
  const width = Math.max(1, Math.min(preferredWidth, heightLimitedWidth, pixelLimitedWidth));
  return { width, height: Math.round(width * ratio * count) };
}

export function paginatePaperBlocks(
  blocks: PaperBlockLayout[],
  contentHeight: number,
  gap: number
): PaperBlockSlice[] {
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return [];
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;
  const slices: PaperBlockSlice[] = [];
  let pageIndex = 0;
  let y = 0;

  blocks.forEach((block, blockIndex) => {
    let remaining = Math.max(0, block.height);
    let sourceY = 0;
    if (remaining === 0) return;

    if ((block.forceBreakBefore || remaining > contentHeight) && y > 0) {
      pageIndex++;
      y = 0;
    } else if (block.keepTogether && remaining <= contentHeight && y > 0 && y + remaining > contentHeight) {
      pageIndex++;
      y = 0;
    }

    while (remaining > 0) {
      const available = contentHeight - y;
      if (available <= 0) {
        pageIndex++;
        y = 0;
        continue;
      }
      const height = Math.min(remaining, available);
      slices.push({ blockIndex, pageIndex, y, sourceY, height });
      remaining -= height;
      sourceY += height;
      y += height;
      if (remaining > 0) {
        pageIndex++;
        y = 0;
      } else {
        y = Math.min(contentHeight, y + safeGap);
      }
    }
  });

  return slices;
}

async function waitForCloneAssets(root: HTMLElement): Promise<void> {
  if (document.fonts?.ready) await document.fonts.ready;
  await Promise.all(Array.from(root.querySelectorAll('img')).map(async image => {
    if (!image.complete) {
      await new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }
    if (typeof image.decode === 'function') await image.decode().catch(() => undefined);
  }));
}

function createWhiteCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前设备无法创建打印画布');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  return canvas;
}

export async function renderPaperShareImage(
  sourceRoot: HTMLElement,
  onProgress?: (message: string) => void
): Promise<RenderedPaperPage> {
  const staging = document.createElement('div');
  staging.setAttribute('aria-hidden', 'true');
  Object.assign(staging.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '794px',
    background: '#ffffff',
    zIndex: '-1',
    pointerEvents: 'none'
  });
  const clone = sourceRoot.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  Object.assign(clone.style, {
    width: '794px',
    maxWidth: 'none',
    boxSizing: 'border-box',
    padding: '42px',
    margin: '0',
    border: '0',
    borderRadius: '0',
    boxShadow: 'none',
    background: '#ffffff'
  });
  staging.appendChild(clone);
  document.body.appendChild(staging);

  try {
    onProgress?.('正在载入题图与字体…');
    await waitForCloneAssets(clone);
    const sourceWidth = Math.max(1, clone.scrollWidth, clone.getBoundingClientRect().width);
    const sourceHeight = Math.max(1, clone.scrollHeight, clone.getBoundingClientRect().height);
    const size = calculateContinuousImageSize(sourceWidth, sourceHeight);
    if (size.width < 540) {
      throw new Error('试卷内容过长，分享长图会看不清，请减少题量或改用 PDF');
    }
    onProgress?.('正在一次生成整张分享图…');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const canvas = await html2canvas(clone, {
      scale: size.width / sourceWidth,
      width: sourceWidth,
      height: sourceHeight,
      windowWidth: sourceWidth,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    canvas.width = 1;
    canvas.height = 1;
    return { blob, dataUrl: '', width: size.width, height: size.height };
  } finally {
    staging.remove();
  }
}

export async function renderPaperPages(
  sourceRoot: HTMLElement,
  onProgress?: (completed: number, total: number) => void
): Promise<RenderedPaperPage[]> {
  const pageWidth = 1240;
  const pageHeight = Math.round(pageWidth * 297 / 210);
  const margin = Math.round(pageWidth * 15 / 210);
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const gap = 18;

  const staging = document.createElement('div');
  staging.setAttribute('aria-hidden', 'true');
  Object.assign(staging.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '794px',
    background: '#ffffff',
    zIndex: '-1',
    pointerEvents: 'none'
  });
  const clone = sourceRoot.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  Object.assign(clone.style, {
    width: '794px',
    maxWidth: 'none',
    boxSizing: 'border-box',
    padding: '56px',
    margin: '0',
    border: '0',
    borderRadius: '0',
    boxShadow: 'none',
    background: '#ffffff'
  });
  staging.appendChild(clone);
  document.body.appendChild(staging);

  try {
    await waitForCloneAssets(clone);
    const elements = Array.from(clone.querySelectorAll<HTMLElement>('[data-paper-export-block]'));
    if (elements.length === 0) throw new Error('试卷没有可分页的内容');

    const blockCanvases: HTMLCanvasElement[] = [];
    const layouts: PaperBlockLayout[] = [];
    for (const [index, element] of elements.entries()) {
      const width = Math.max(1, element.getBoundingClientRect().width);
      const canvas = await html2canvas(element, {
        scale: contentWidth / width,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });
      blockCanvases.push(canvas);
      layouts.push({
        height: canvas.height,
        forceBreakBefore: element.dataset.paperPageBreakBefore === 'true',
        keepTogether: element.dataset.paperKeepTogether !== 'false'
      });
      onProgress?.(index + 1, elements.length);
    }

    const slices = paginatePaperBlocks(layouts, contentHeight, gap);
    const pageCount = Math.max(1, ...slices.map(slice => slice.pageIndex + 1));
    const pages = Array.from({ length: pageCount }, () => createWhiteCanvas(pageWidth, pageHeight));
    slices.forEach(slice => {
      const context = pages[slice.pageIndex].getContext('2d');
      if (!context) return;
      const block = blockCanvases[slice.blockIndex];
      context.drawImage(
        block,
        0,
        slice.sourceY,
        block.width,
        slice.height,
        margin,
        margin + slice.y,
        contentWidth,
        slice.height
      );
    });

    const rendered: RenderedPaperPage[] = [];
    for (const page of pages) {
      const blob = await canvasToBlob(page, 'image/jpeg', 0.92);
      rendered.push({
        blob,
        dataUrl: page.toDataURL('image/jpeg', 0.92),
        width: page.width,
        height: page.height
      });
      page.width = 1;
      page.height = 1;
    }
    blockCanvases.forEach(canvas => {
      canvas.width = 1;
      canvas.height = 1;
    });
    return rendered;
  } finally {
    staging.remove();
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('试卷页面图片读取失败'));
    image.src = dataUrl;
  });
}

export async function stitchPaperPages(pages: RenderedPaperPage[]): Promise<RenderedPaperPage> {
  if (pages.length === 0) throw new Error('没有可拼接的试卷页面');
  const ratio = pages[0].height / pages[0].width;
  const size = calculateLongImageSize(pages.length, ratio);
  if (size.width < 640) {
    throw new Error('试卷内容过长，单张长图会超出手机限制，请减少题量或改用 PDF');
  }
  const canvas = createWhiteCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前设备无法创建长图画布');
  const pageHeight = size.height / pages.length;
  for (const [index, page] of pages.entries()) {
    const image = await loadImage(page.dataUrl);
    context.drawImage(image, 0, index * pageHeight, size.width, pageHeight);
  }
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  canvas.width = 1;
  canvas.height = 1;
  return { blob, dataUrl, width: size.width, height: size.height };
}
