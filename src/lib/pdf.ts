import { PDFDocument, type PDFImage } from 'pdf-lib';
import type { NotePage } from '../types';
import { downloadBlob, safeFileName } from './image';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 22;

async function embedImage(pdf: PDFDocument, blob: Blob): Promise<PDFImage> {
  const bytes = await blob.arrayBuffer();
  if (blob.type === 'image/png') return pdf.embedPng(bytes);
  return pdf.embedJpg(bytes);
}

function pageDimensions(image: PDFImage): [number, number] {
  return image.width > image.height ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
}

function drawImageOnPage(
  page: ReturnType<PDFDocument['addPage']>,
  image: PDFImage,
  pageWidth: number,
  pageHeight: number,
): void {
  const maxWidth = pageWidth - PAGE_MARGIN * 2;
  const maxHeight = pageHeight - PAGE_MARGIN * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });
}

async function savePdf(pdf: PDFDocument, fileName: string): Promise<void> {
  const pdfBytes = await pdf.save({ useObjectStreams: true });
  const pdfArrayBuffer = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(pdfArrayBuffer).set(pdfBytes);
  downloadBlob(new Blob([pdfArrayBuffer], { type: 'application/pdf' }), `${safeFileName(fileName)}.pdf`);
}

export async function exportPagesAsPdf(pages: NotePage[], notebookName: string): Promise<void> {
  if (pages.length === 0) return;
  const pdf = await PDFDocument.create();
  const orderedPages = [...pages].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const notePage of orderedPages) {
    const image = await embedImage(pdf, notePage.image);
    const [pageWidth, pageHeight] = pageDimensions(image);
    const page = pdf.addPage([pageWidth, pageHeight]);
    drawImageOnPage(page, image, pageWidth, pageHeight);
  }
  await savePdf(pdf, notebookName);
}

export async function exportImageAsPdf(imageBlob: Blob, fileName: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const image = await embedImage(pdf, imageBlob);
  const [pageWidth, pageHeight] = pageDimensions(image);
  const page = pdf.addPage([pageWidth, pageHeight]);
  drawImageOnPage(page, image, pageWidth, pageHeight);
  await savePdf(pdf, fileName);
}
