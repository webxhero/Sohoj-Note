import Dexie, { type Table } from 'dexie';
import type { Course, Notebook, NotePage } from './types';

class SmartNoteDatabase extends Dexie {
  courses!: Table<Course, number>;
  notebooks!: Table<Notebook, number>;
  pages!: Table<NotePage, number>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super('SmartNoteDatabase');
    this.version(1).stores({
      courses: '++id, name, createdAt',
      notebooks: '++id, courseId, name, createdAt',
      pages: '++id, notebookId, chapter, sortOrder, createdAt'
    });
    this.version(2).stores({
      courses: '++id, name, createdAt',
      notebooks: '++id, courseId, name, createdAt',
      pages: '++id, notebookId, chapter, sortOrder, createdAt',
      meta: '&key'
    });
  }
}

export const db = new SmartNoteDatabase();

export async function deleteCourseAndContents(courseId: number): Promise<void> {
  await db.transaction('rw', db.courses, db.notebooks, db.pages, async () => {
    const notebookIds = await db.notebooks.where('courseId').equals(courseId).primaryKeys();
    for (const notebookId of notebookIds) {
      await db.pages.where('notebookId').equals(Number(notebookId)).delete();
    }
    await db.notebooks.bulkDelete(notebookIds);
    await db.courses.delete(courseId);
  });
}

export async function deleteNotebookAndPages(notebookId: number): Promise<void> {
  await db.transaction('rw', db.notebooks, db.pages, async () => {
    await db.pages.where('notebookId').equals(notebookId).delete();
    await db.notebooks.delete(notebookId);
  });
}
