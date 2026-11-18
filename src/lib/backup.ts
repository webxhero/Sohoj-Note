import type { Course, Notebook, NotePage } from '../types';

export interface BackupPayload {
  format: 'smartnote-backup';
  version: 1;
  backupId: string;
  createdAt: string;
  courses: Course[];
  notebooks: Notebook[];
  pages: Array<Omit<NotePage, 'image'> & { imageData: string; imageType: string }>;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read an image from this backup.'));
    reader.onerror = () => reject(new Error('Could not read an image from this backup.'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string, fallbackType: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('This backup contains an invalid image.');
  const header = dataUrl.slice(0, comma);
  const mime = header.match(/^data:([^;]+)/)?.[1] || fallbackType || 'image/jpeg';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function createBackup(courses: Course[], notebooks: Notebook[], pages: NotePage[]): Promise<BackupPayload> {
  const backupPages = await Promise.all(pages.map(async ({ image, ...page }) => ({
    ...page,
    imageData: await blobToDataUrl(image),
    imageType: image.type || 'image/jpeg'
  })));
  return {
    format: 'smartnote-backup',
    version: 1,
    backupId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    courses,
    notebooks,
    pages: backupPages
  };
}

export function parseBackup(input: unknown): BackupPayload {
  if (!input || typeof input !== 'object') throw new Error('This is not a valid Sohoj Note backup.');
  const data = input as Partial<BackupPayload>;
  if (data.format !== 'smartnote-backup' || data.version !== 1 || !Array.isArray(data.courses) || !Array.isArray(data.notebooks) || !Array.isArray(data.pages)) {
    throw new Error('Unsupported or damaged Sohoj Note backup file.');
  }
  if (!data.courses.every((item) => item && typeof item.name === 'string' && typeof item.createdAt === 'number')) throw new Error('The backup has invalid course data.');
  if (!data.notebooks.every((item) => item && typeof item.name === 'string' && typeof item.courseId === 'number')) throw new Error('The backup has invalid notebook data.');
  if (!data.pages.every((item) => item && typeof item.notebookId === 'number' && typeof item.imageData === 'string' && typeof item.sortOrder === 'number')) throw new Error('The backup has invalid page data.');
  return data as BackupPayload;
}

export function restorePageImage(page: BackupPayload['pages'][number]): NotePage {
  const { imageData, imageType, ...metadata } = page;
  return { ...metadata, image: dataUrlToBlob(imageData, imageType) };
}
