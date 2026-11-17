export interface Course {
  id?: number;
  name: string;
  createdAt: number;
}

export interface Notebook {
  id?: number;
  courseId: number;
  name: string;
  createdAt: number;
}

export interface NotePage {
  id?: number;
  notebookId: number;
  chapter: string;
  image: Blob;
  createdAt: number;
  sortOrder: number;
  fileName: string;
  width: number;
  height: number;
}
