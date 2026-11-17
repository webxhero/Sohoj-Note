import { PDFDocument } from "pdf-lib";
import type { NotePage } from "../types";
import { downloadBlob, safeFileName } from "./image";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 24;

export async function exportPagesAsPdf(
  pages: NotePage[],
  notebookName: string,
): Promise<void> {
  if (pages.length === 0) return;

  const pdf = await PDFDocument.create();
  const orderedPages = [...pages].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const notePage of orderedPages) {
    const imageBytes = await notePage.image.arrayBuffer();
    const image = await pdf.embedJpg(imageBytes);
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);

    const maxWidth = A4_WIDTH - PAGE_MARGIN * 2;
    const maxHeight = A4_HEIGHT - PAGE_MARGIN * 2;

    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);

    const width = image.width * scale;
    const height = image.height * scale;

    page.drawImage(image, {
      x: (A4_WIDTH - width) / 2,
      y: (A4_HEIGHT - height) / 2,
      width,
      height,
    });
  }

  const pdfBytes = await pdf.save();

  // Convert Uint8Array into a compatible ArrayBuffer
  const pdfArrayBuffer = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(pdfArrayBuffer).set(pdfBytes);

  const pdfBlob = new Blob([pdfArrayBuffer], { type: "application/pdf" });

  downloadBlob(pdfBlob, `${safeFileName(notebookName)}.pdf`);
}
