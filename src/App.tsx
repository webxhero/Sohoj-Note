import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  Pencil,
  RotateCw,
  Image as ImageIcon,
  Layers3,
  Menu,
  Plus,
  ArrowUp,
  ArrowDown,
  Archive,
  HardDrive,
  RotateCcw,
  Search,
  Scan,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { db, deleteCourseAndContents, deleteNotebookAndPages } from './db';
import { prepareImage, downloadBlob, safeFileName } from './lib/image';
import { exportPagesAsPdf } from './lib/pdf';
import type { Course, Notebook, NotePage } from './types';
import { createBackup, parseBackup, restorePageImage } from './lib/backup';
import DocumentScanner from './components/DocumentScanner';
import type { CorrectedImage } from './lib/scanner';

interface ScannerRequest {
  source: Blob;
  sourceName: string;
  target: 'new' | 'existing';
  notebookId: number;
  page?: NotePage;
}

function App() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [pages, setPages] = useState<NotePage[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<number[]>([]);
  const [newCourseName, setNewCourseName] = useState('');
  const [newNotebookName, setNewNotebookName] = useState('');
  const [chapterDraft, setChapterDraft] = useState('');
  const [courseSearch, setCourseSearch] = useState('');
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showNotebookForm, setShowNotebookForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [scannerRequest, setScannerRequest] = useState<ScannerRequest | null>(null);
  const [storageBytes, setStorageBytes] = useState(0);
  const [editingPage, setEditingPage] = useState<NotePage | null>(null);
  const [editRotation, setEditRotation] = useState(0);
  const [editFilter, setEditFilter] = useState<'original' | 'grayscale' | 'document'>('original');
  const [isApplyingEdit, setIsApplyingEdit] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const selectedNotebook = notebooks.find((notebook) => notebook.id === selectedNotebookId) ?? null;

  const imageUrls = useMemo(() => {
    const urls = new Map<number, string>();
    for (const page of pages) {
      if (page.id !== undefined) urls.set(page.id, URL.createObjectURL(page.image));
    }
    return urls;
  }, [pages]);

  useEffect(() => {
    return () => imageUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [imageUrls]);

  useEffect(() => {
    let active = true;
    db.courses.orderBy('createdAt').toArray().then((items) => {
      if (!active) return;
      setCourses(items);
      if (items.length > 0) setSelectedCourseId(items[0].id ?? null);
    }).catch(() => setError('Could not load your courses. Please refresh the app.'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setSelectedNotebookId(null);
    setPages([]);
    setSelectedPageIds([]);
    if (selectedCourseId === null) {
      setNotebooks([]);
      return;
    }
    db.notebooks.where('courseId').equals(selectedCourseId).sortBy('createdAt').then((items) => {
      if (active) setNotebooks(items);
    }).catch(() => setError('Could not load notebooks for this course.'));
    return () => { active = false; };
  }, [selectedCourseId]);

  useEffect(() => {
    let active = true;
    setSelectedPageIds([]);
    if (selectedNotebookId === null) {
      setPages([]);
      return;
    }
    db.pages.where('notebookId').equals(selectedNotebookId).sortBy('sortOrder').then((items) => {
      if (active) setPages(items);
    }).catch(() => setError('Could not load pages for this notebook.'));
    return () => { active = false; };
  }, [selectedNotebookId]);

  useEffect(() => {
    let active = true;
    db.pages.toArray().then((items) => {
      if (active) setStorageBytes(items.reduce((total, page) => total + page.image.size, 0));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [pages]);

  async function handleBackup() {
    setIsBackingUp(true);
    setError('');
    try {
      const allCourses = await db.courses.toArray();
      const allNotebooks = await db.notebooks.toArray();
      const allPages = await db.pages.toArray();
      const backup = await createBackup(allCourses, allNotebooks, allPages);
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      downloadBlob(blob, `sohoj-note-backup-${new Date().toISOString().slice(0, 10)}.smartnote.json`);
      setNotice(`Backup created: ${allCourses.length} courses, ${allNotebooks.length} notebooks and ${allPages.length} pages.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create your backup.');
    } finally { setIsBackingUp(false); }
  }

  async function handleRestore(file?: File) {
    if (!file) return;
    setIsRestoring(true);
    setError('');
    try {
      const payload = parseBackup(JSON.parse(await file.text()));
      const alreadyImported = await db.meta.get(`backup:${payload.backupId}`);
      if (alreadyImported) throw new Error('This exact backup has already been restored on this device.');
      const confirmed = window.confirm(`Restore ${payload.courses.length} courses, ${payload.notebooks.length} notebooks and ${payload.pages.length} pages? Existing notes will be kept; restored items will be added as new copies.`);
      if (!confirmed) return;
      await db.transaction('rw', db.courses, db.notebooks, db.pages, db.meta, async () => {
        const courseMap = new Map<number, number>();
        const notebookMap = new Map<number, number>();
        for (const course of payload.courses) {
          const oldId = course.id;
          const newId = await db.courses.add({ name: course.name, createdAt: course.createdAt });
          if (oldId !== undefined) courseMap.set(oldId, newId);
        }
        for (const notebook of payload.notebooks) {
          const newCourseId = courseMap.get(notebook.courseId);
          if (newCourseId === undefined) throw new Error('A notebook refers to a missing course in this backup.');
          const oldId = notebook.id;
          const newId = await db.notebooks.add({ courseId: newCourseId, name: notebook.name, createdAt: notebook.createdAt });
          if (oldId !== undefined) notebookMap.set(oldId, newId);
        }
        const restoredPages = payload.pages.map((page) => {
          const newNotebookId = notebookMap.get(page.notebookId);
          if (newNotebookId === undefined) throw new Error('A page refers to a missing notebook in this backup.');
          return { ...restorePageImage(page), id: undefined, notebookId: newNotebookId };
        });
        await db.pages.bulkAdd(restoredPages);
        await db.meta.put({ key: `backup:${payload.backupId}`, value: new Date().toISOString() });
      });
      const refreshedCourses = await db.courses.orderBy('createdAt').toArray();
      setCourses(refreshedCourses);
      setSelectedCourseId(refreshedCourses[0]?.id ?? null);
      const refreshedPages = await db.pages.toArray();
      setStorageBytes(refreshedPages.reduce((total, page) => total + page.image.size, 0));
      setNotice(`Restore complete: ${payload.courses.length} courses and ${payload.pages.length} pages added. Existing notes were kept.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not restore this backup.');
    } finally {
      setIsRestoring(false);
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  }

  async function movePage(page: NotePage, direction: -1 | 1) {
    const index = pages.findIndex((item) => item.id === page.id);
    const target = pages[index + direction];
    if (index < 0 || !target || page.id === undefined || target.id === undefined) return;
    await db.transaction('rw', db.pages, async () => {
      await db.pages.update(page.id!, { sortOrder: target.sortOrder });
      await db.pages.update(target.id!, { sortOrder: page.sortOrder });
    });
    const refreshed = await db.pages.where('notebookId').equals(page.notebookId).sortBy('sortOrder');
    setPages(refreshed);
    setNotice('Page order updated.');
  }

  const filteredCourses = courses.filter((course) =>
    course.name.toLowerCase().includes(courseSearch.toLowerCase().trim())
  );

  async function handleAddCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCourseName.trim();
    if (!name) return;
    try {
      const id = await db.courses.add({ name, createdAt: Date.now() });
      const created = await db.courses.get(id);
      if (created) setCourses((current) => [...current, created].sort((a, b) => a.createdAt - b.createdAt));
      setSelectedCourseId(id);
      setNewCourseName('');
      setShowCourseForm(false);
      setNotice('Course created. Add a notebook to get started.');
      setError('');
    } catch {
      setError('Could not create this course. Please try again.');
    }
  }

  async function handleAddNotebook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newNotebookName.trim();
    if (!name || selectedCourseId === null) return;
    try {
      const id = await db.notebooks.add({ courseId: selectedCourseId, name, createdAt: Date.now() });
      const created = await db.notebooks.get(id);
      if (created) setNotebooks((current) => [...current, created].sort((a, b) => a.createdAt - b.createdAt));
      setSelectedNotebookId(id);
      setNewNotebookName('');
      setShowNotebookForm(false);
      setNotice('Notebook created. You can now add your first page.');
      setError('');
    } catch {
      setError('Could not create this notebook. Please try again.');
    }
  }

  async function handleDeleteCourse(course: Course) {
    if (course.id === undefined) return;
    const confirmed = window.confirm(`Delete “${course.name}” and all its notebooks and pages? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await deleteCourseAndContents(course.id);
      const remaining = await db.courses.orderBy('createdAt').toArray();
      setCourses(remaining);
      if (selectedCourseId === course.id) setSelectedCourseId(remaining[0]?.id ?? null);
      setNotice('Course deleted.');
      setError('');
    } catch {
      setError('Could not delete this course.');
    }
  }

  async function handleDeleteNotebook(notebook: Notebook) {
    if (notebook.id === undefined) return;
    const confirmed = window.confirm(`Delete “${notebook.name}” and all its pages? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await deleteNotebookAndPages(notebook.id);
      setNotebooks((current) => current.filter((item) => item.id !== notebook.id));
      setSelectedNotebookId(null);
      setPages([]);
      setNotice('Notebook deleted.');
      setError('');
    } catch {
      setError('Could not delete this notebook.');
    }
  }

  async function handleFiles(files: FileList | File[]) {
    if (selectedNotebookId === null || files.length === 0) return;
    setIsSaving(true);
    setNotice('');
    setError('');
    try {
      const existingPages = await db.pages.where('notebookId').equals(selectedNotebookId).toArray();
      let nextOrder = existingPages.reduce((max, page) => Math.max(max, page.sortOrder), -1) + 1;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const prepared = await prepareImage(file);
        await db.pages.add({
          notebookId: selectedNotebookId,
          chapter: chapterDraft.trim() || 'Unsorted',
          image: prepared.blob,
          createdAt: Date.now(),
          sortOrder: nextOrder,
          fileName: file.name || `note-${nextOrder + 1}.jpg`,
          width: prepared.width,
          height: prepared.height
        });
        nextOrder += 1;
      }
      const refreshed = await db.pages.where('notebookId').equals(selectedNotebookId).sortBy('sortOrder');
      setPages(refreshed);
      setNotice(`${files.length} ${files.length === 1 ? 'page' : 'pages'} added to ${selectedNotebook?.name ?? 'your notebook'}.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not save these images.';
      setError(message);
    } finally {
      setIsSaving(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  async function startNewScan(file?: File) {
    if (!file || selectedNotebookId === null) return;
    setError('');
    setNotice('');
    try {
      const prepared = await prepareImage(file);
      setScannerRequest({
        source: prepared.blob,
        sourceName: file.name || 'scanned-page.jpg',
        target: 'new',
        notebookId: selectedNotebookId,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare this image for scanning.');
    } finally {
      if (scanInputRef.current) scanInputRef.current.value = '';
    }
  }

  function openPageScanner(page: NotePage) {
    setEditingPage(null);
    setScannerRequest({
      source: page.image,
      sourceName: page.fileName || 'note-page.jpg',
      target: 'existing',
      notebookId: page.notebookId,
      page,
    });
  }

  async function saveScannedImage(result: CorrectedImage) {
    if (!scannerRequest) return;
    let persisted = false;
    try {
      if (scannerRequest.target === 'new') {
        const existingPages = await db.pages.where('notebookId').equals(scannerRequest.notebookId).toArray();
        const nextOrder = existingPages.reduce((max, page) => Math.max(max, page.sortOrder), -1) + 1;
        await db.pages.add({
          notebookId: scannerRequest.notebookId,
          chapter: chapterDraft.trim() || 'Unsorted',
          image: result.blob,
          createdAt: Date.now(),
          sortOrder: nextOrder,
          fileName: scannerRequest.sourceName || `scan-${nextOrder + 1}.jpg`,
          width: result.width,
          height: result.height,
        });
        persisted = true;
        setScannerRequest(null);
        const refreshed = await db.pages.where('notebookId').equals(scannerRequest.notebookId).sortBy('sortOrder');
        if (selectedNotebookId === scannerRequest.notebookId) setPages(refreshed);
        setNotice('Scanned page added to this notebook.');
      } else {
        const page = scannerRequest.page;
        if (!page || page.id === undefined) throw new Error('The original page could not be found.');
        await db.pages.update(page.id, { image: result.blob, width: result.width, height: result.height });
        persisted = true;
        setScannerRequest(null);
        const refreshed = await db.pages.where('notebookId').equals(page.notebookId).sortBy('sortOrder');
        if (selectedNotebookId === page.notebookId) setPages(refreshed);
        setNotice('Scanned page updated. Its chapter and page order were preserved.');
      }
      setError('');
    } catch (caught) {
      const message = persisted
        ? 'The scanned image was saved, but the page list could not refresh. Reopen the notebook to reload it.'
        : caught instanceof Error ? caught.message : 'Could not save the scanned page.';
      setError(message);
      if (!persisted) throw new Error(message);
    }
  }

  function openPageEditor(page: NotePage) {
    setEditingPage(page);
    setEditRotation(0);
    setEditFilter('original');
  }

  async function savePageEdit() {
    if (!editingPage || editingPage.id === undefined) return;
    setIsApplyingEdit(true);
    setError('');
    try {
      const bitmap = await createImageBitmap(editingPage.image);
      const rotated = Math.abs(editRotation % 180) === 90;
      const width = rotated ? bitmap.height : bitmap.width;
      const height = rotated ? bitmap.width : bitmap.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not edit this page. Please try again.');
      if (editFilter === 'grayscale') context.filter = 'grayscale(1) contrast(1.12)';
      if (editFilter === 'document') context.filter = 'grayscale(1) contrast(1.55) brightness(1.08)';
      context.translate(width / 2, height / 2);
      context.rotate((editRotation * Math.PI) / 180);
      context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not save the edited image.')), 'image/jpeg', 0.88);
      });
      await db.pages.update(editingPage.id, { image: blob, width, height });
      const refreshed = await db.pages.where('notebookId').equals(editingPage.notebookId).sortBy('sortOrder');
      setPages(refreshed);
      setEditingPage(null);
      setNotice('Page edits saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not edit this page.');
    } finally {
      setIsApplyingEdit(false);
    }
  }

  async function handleDeletePage(page: NotePage) {
    if (page.id === undefined) return;
    const confirmed = window.confirm('Delete this page?');
    if (!confirmed) return;
    await db.pages.delete(page.id);
    setPages((current) => current.filter((item) => item.id !== page.id));
    setSelectedPageIds((current) => current.filter((id) => id !== page.id));
    setNotice('Page deleted.');
  }

  async function handleExportPdf(selectedOnly: boolean) {
    if (!selectedNotebook || pages.length === 0) return;
    const chosenPages = selectedOnly
      ? pages.filter((page) => page.id !== undefined && selectedPageIds.includes(page.id))
      : pages;
    if (chosenPages.length === 0) {
      setError('Select at least one page to export.');
      return;
    }
    setIsExporting(true);
    setError('');
    try {
      const name = selectedOnly ? `${selectedNotebook.name}-selected` : selectedNotebook.name;
      await exportPagesAsPdf(chosenPages, name);
      setNotice(`${chosenPages.length} pages exported as PDF.`);
    } catch {
      setError('PDF export failed. Please try again with fewer pages.');
    } finally {
      setIsExporting(false);
    }
  }

  function handleDownloadImage(page: NotePage) {
    downloadBlob(page.image, `${safeFileName(page.chapter)}-${(page.sortOrder + 1).toString().padStart(2, '0')}.jpg`);
  }

  function togglePageSelection(pageId: number) {
    setSelectedPageIds((current) => current.includes(pageId)
      ? current.filter((id) => id !== pageId)
      : [...current, pageId]);
  }

  function selectAllPages() {
    const ids = pages.map((page) => page.id).filter((id): id is number => id !== undefined);
    setSelectedPageIds(ids.length === selectedPageIds.length ? [] : ids);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark"><BookOpen size={21} strokeWidth={2.2} /></div>
          <div>
            <div className="brand-name">Sohoj Note</div>
            <div className="brand-subtitle">Your notes, in order.</div>
          </div>
          <div className="mobile-menu-wrap">
            <button
              type="button"
              className="mobile-menu-button"
              aria-label={showMobileMenu ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={showMobileMenu}
              aria-controls="mobile-app-menu"
              onClick={() => setShowMobileMenu((value) => !value)}
            >
              {showMobileMenu ? <X size={20} /> : <Menu size={20} />}
            </button>
            {showMobileMenu && (
              <>
                <button type="button" className="mobile-menu-scrim" aria-label="Close menu" onClick={() => setShowMobileMenu(false)} />
                <div id="mobile-app-menu" className="mobile-menu-panel" role="group" aria-label="App menu">
                  <button type="button" onClick={() => { setShowMobileMenu(false); setShowSettings(true); }}>
                    <Settings size={16} /> Settings
                  </button>
                  <div className="mobile-menu-heading">Backup &amp; storage</div>
                  <button type="button" onClick={() => { setShowMobileMenu(false); void handleBackup(); }} disabled={isBackingUp}>
                    <Archive size={16} /> {isBackingUp ? 'Creating backup…' : 'Backup all notes'}
                  </button>
                  <button type="button" onClick={() => { setShowMobileMenu(false); backupInputRef.current?.click(); }} disabled={isRestoring}>
                    <RotateCcw size={16} /> {isRestoring ? 'Restoring…' : 'Restore backup'}
                  </button>
                  <button type="button" onClick={() => { setShowMobileMenu(false); setShowSettings(true); }}>
                    <HardDrive size={16} /> Storage usage
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="sidebar-section-heading">
          <span>YOUR COURSES</span>
          <button className="icon-button small" aria-label="Add course" onClick={() => setShowCourseForm((value) => !value)}>
            {showCourseForm ? <X size={16} /> : <Plus size={16} />}
          </button>
        </div>

        <label className="search-box">
          <Search size={15} />
          <input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="Find a course" />
        </label>

        {showCourseForm && (
          <form className="inline-create" onSubmit={handleAddCourse}>
            <input autoFocus value={newCourseName} onChange={(event) => setNewCourseName(event.target.value)} placeholder="e.g. Mathematics" maxLength={60} />
            <button className="primary-button compact" type="submit" disabled={!newCourseName.trim()}>Add</button>
          </form>
        )}

        <div className="course-list">
          {filteredCourses.map((course) => (
            <div className={`course-row ${selectedCourseId === course.id ? 'active' : ''}`} key={course.id}>
              <button className="course-select" onClick={() => setSelectedCourseId(course.id ?? null)}>
                <span className="course-icon"><BookOpen size={17} /></span>
                <span className="course-name">{course.name}</span>
                {selectedCourseId === course.id && <ChevronRight size={16} className="course-chevron" />}
              </button>
              <button className="row-delete" aria-label={`Delete ${course.name}`} title="Delete course" onClick={() => void handleDeleteCourse(course)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {filteredCourses.length === 0 && (
            <div className="sidebar-empty">{courses.length ? 'No matching courses.' : 'Your courses will appear here.'}</div>
          )}
        </div>

        <button className="settings-entry" onClick={() => setShowSettings(true)}>
          <Settings size={16} />
          <span>Settings</span>
          <ChevronRight size={15} className="settings-chevron" />
        </button>
        <input ref={backupInputRef} className="visually-hidden" type="file" accept=".json,.smartnote.json,application/json" onChange={(event) => void handleRestore(event.target.files?.[0])} />

        <div className="sidebar-bottom">
          <div className="privacy-card">
            <div className="privacy-icon"><ShieldCheck size={17} /></div>
            <div>
              <strong>Stored on this device</strong>
              <span>Your notes stay in this browser.</span>
            </div>
          </div>
          <div className="sidebar-version">SOHOJ NOTE · LOCAL FIRST</div>
        </div>
      </aside>

      {showSettings && (
        <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettings(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header className="settings-header">
              <div>
                <span className="settings-kicker">PREFERENCES</span>
                <h2 id="settings-title">Settings</h2>
                <p>Manage your local notes and storage.</p>
              </div>
              <button className="icon-button" aria-label="Close settings" onClick={() => setShowSettings(false)}><X size={18} /></button>
            </header>
            <div className="settings-section">
              <div className="settings-section-title"><HardDrive size={16} /><div><strong>Backup & storage</strong><span>Your notes are stored in this browser.</span></div></div>
              <div className="settings-storage">Approx. image storage <strong>{(storageBytes / (1024 * 1024)).toFixed(1)} MB</strong></div>
              <button className="secondary-button settings-action" onClick={() => void handleBackup()} disabled={isBackingUp}>
                <Archive size={16} /> {isBackingUp ? 'Creating backup…' : 'Backup all notes'}
              </button>
              <button className="secondary-button settings-action" onClick={() => backupInputRef.current?.click()} disabled={isRestoring}>
                <RotateCcw size={16} /> {isRestoring ? 'Restoring…' : 'Restore backup'}
              </button>
            </div>
            <footer className="settings-footer">
              <span>Sohoj Note · Local first</span>
              <button className="primary-button compact" onClick={() => setShowSettings(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            {selectedCourse && <><ChevronRight size={14} /><strong>{selectedCourse.name}</strong></>}
            {selectedNotebook && <><ChevronRight size={14} /><strong>{selectedNotebook.name}</strong></>}
          </div>
          <div className="topbar-actions">
            <div className="local-pill"><span className="status-dot" /> Local storage</div>
          </div>
        </header>

        <div className="content-wrap">
          {(notice || error) && (
            <div className={`notice ${error ? 'notice-error' : ''}`} role="status">
              <span>{error || notice}</span>
              <button className="notice-close" aria-label="Dismiss message" onClick={() => { setNotice(''); setError(''); }}><X size={15} /></button>
            </div>
          )}

          {selectedNotebook ? (
            <>
              <div className="page-heading notebook-heading">
                <div>
                  <button className="back-link" onClick={() => setSelectedNotebookId(null)}><ArrowLeft size={15} /> Back to notebooks</button>
                  <div className="eyebrow">{selectedCourse?.name ?? 'COURSE'} / NOTEBOOK</div>
                  <h1>{selectedNotebook.name}</h1>
                  <p className="page-subtitle">Keep adding pages. Sohoj Note stores each image separately and builds a PDF when you export.</p>
                </div>
                <button className="text-button danger-text" onClick={() => void handleDeleteNotebook(selectedNotebook)}><Trash2 size={15} /> Delete notebook</button>
              </div>

              <section className="capture-panel">
                <div className="capture-copy">
                  <div className="capture-icon"><Sparkles size={20} /></div>
                  <div>
                    <h2>Add notes to this notebook</h2>
                    <p>Take a photo or choose images from your device.</p>
                  </div>
                </div>
                <div className="capture-controls">
                  <input className="chapter-input" value={chapterDraft} onChange={(event) => setChapterDraft(event.target.value)} placeholder="Chapter name (optional)" aria-label="Chapter name" />
                  <button className="secondary-button" onClick={() => cameraInputRef.current?.click()} disabled={isSaving}>
                    <Camera size={17} /> Take photo
                  </button>
                  <button className="secondary-button" onClick={() => scanInputRef.current?.click()} disabled={isSaving}>
                    <Scan size={17} /> Scan document
                  </button>
                  <button className="primary-button" onClick={() => uploadInputRef.current?.click()} disabled={isSaving}>
                    <Upload size={17} /> Upload images
                  </button>
                  <input ref={cameraInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => event.target.files && void handleFiles(event.target.files)} />
                  <input ref={scanInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void startNewScan(event.target.files?.[0])} />
                  <input ref={uploadInputRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => event.target.files && void handleFiles(event.target.files)} />
                </div>
                {isSaving && <div className="saving-line"><span className="spinner" /> Preparing and saving your pages…</div>}
              </section>

              <div className="section-toolbar">
                <div>
                  <h2>Your pages <span className="count-badge">{pages.length}</span></h2>
                  <p>{pages.length ? 'Select pages to export, or download an individual image.' : 'Your notebook is ready for its first page.'}</p>
                </div>
                <div className="export-actions">
                  <button className="secondary-button" onClick={() => void handleExportPdf(true)} disabled={isExporting || selectedPageIds.length === 0}>
                    <FileText size={16} /> Export selected ({selectedPageIds.length})
                  </button>
                  <button className="primary-button" onClick={() => void handleExportPdf(false)} disabled={isExporting || pages.length === 0}>
                    <Download size={16} /> {isExporting ? 'Preparing PDF…' : 'Export all PDF'}
                  </button>
                </div>
              </div>

              {pages.length > 0 ? (
                <>
                  <div className="select-all-row">
                    <label className="check-label">
                      <input type="checkbox" checked={selectedPageIds.length === pages.length && pages.length > 0} onChange={selectAllPages} />
                      <span>Select all pages</span>
                    </label>
                    <span>{selectedPageIds.length} selected</span>
                  </div>
                  <div className="page-grid">
                    {pages.map((page, index) => (
                      <article className={`page-card ${page.id !== undefined && selectedPageIds.includes(page.id) ? 'page-card-selected' : ''}`} key={page.id}>
                        <div className="page-image-wrap">
                          <img src={page.id === undefined ? '' : imageUrls.get(page.id)} alt={`Scanned note page ${index + 1}`} loading="lazy" decoding="async" />
                          <label className="page-check" aria-label={`Select page ${index + 1}`}>
                            <input type="checkbox" checked={page.id !== undefined && selectedPageIds.includes(page.id)} onChange={() => page.id !== undefined && togglePageSelection(page.id)} />
                            <span><Check size={13} /></span>
                          </label>
                        </div>
                        <div className="page-card-footer">
                          <div className="page-card-meta">
                            <strong>Page {index + 1}</strong>
                            <span>{page.chapter}</span>
                          </div>
                          <div className="page-card-actions">
                            <button className="icon-button" title="Move page up" aria-label="Move page up" disabled={index === 0} onClick={() => void movePage(page, -1)}><ArrowUp size={15} /></button>
                            <button className="icon-button" title="Move page down" aria-label="Move page down" disabled={index === pages.length - 1} onClick={() => void movePage(page, 1)}><ArrowDown size={15} /></button>
                            <button className="icon-button" title="Edit page" aria-label="Edit page" onClick={() => openPageEditor(page)}><Pencil size={15} /></button>
                            <button className="icon-button" title="Download image" aria-label="Download image" onClick={() => handleDownloadImage(page)}><ImageIcon size={15} /></button>
                            <button className="icon-button delete-icon" title="Delete page" aria-label="Delete page" onClick={() => void handleDeletePage(page)}><Trash2 size={15} /></button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-pages">
                  <div className="empty-illustration"><FileImage size={34} /></div>
                  <h3>No pages yet</h3>
                  <p>Take a photo of your handwritten notes or upload an existing image. It will be saved in this notebook.</p>
                  <button className="primary-button" onClick={() => cameraInputRef.current?.click()}><Camera size={17} /> Capture first page</button>
                </div>
              )}
            </>
          ) : selectedCourse ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR COURSE</div>
                  <h1>{selectedCourse.name}</h1>
                  <p className="page-subtitle">Create separate notebooks for lectures, viva, tutorials and chapters.</p>
                </div>
                <button className="primary-button" onClick={() => setShowNotebookForm((value) => !value)}>
                  {showNotebookForm ? <X size={17} /> : <Plus size={17} />} New notebook
                </button>
              </div>

              {showNotebookForm && (
                <form className="create-notebook-panel" onSubmit={handleAddNotebook}>
                  <div className="create-panel-icon"><FolderOpen size={20} /></div>
                  <div className="create-panel-field">
                    <label htmlFor="notebook-name">Notebook name</label>
                    <input id="notebook-name" autoFocus value={newNotebookName} onChange={(event) => setNewNotebookName(event.target.value)} placeholder="e.g. Viva Notes, Lecture Notes" maxLength={70} />
                  </div>
                  <button className="primary-button" type="submit" disabled={!newNotebookName.trim()}>Create notebook</button>
                </form>
              )}

              <div className="section-toolbar notebook-list-toolbar">
                <div>
                  <h2>Your notebooks <span className="count-badge">{notebooks.length}</span></h2>
                  <p>Each notebook has its own pages and PDF export.</p>
                </div>
              </div>

              {notebooks.length > 0 ? (
                <div className="notebook-grid">
                  {notebooks.map((notebook) => (
                    <button className="notebook-card" key={notebook.id} onClick={() => setSelectedNotebookId(notebook.id ?? null)}>
                      <div className="notebook-card-top">
                        <div className="notebook-icon"><Layers3 size={21} /></div>
                        <ChevronRight size={18} className="notebook-arrow" />
                      </div>
                      <strong>{notebook.name}</strong>
                      <span>Open notebook <ChevronRight size={13} /></span>
                    </button>
                  ))}
                  <button className="notebook-card add-notebook-card" onClick={() => setShowNotebookForm(true)}>
                    <div className="add-notebook-circle"><Plus size={20} /></div>
                    <strong>Create another notebook</strong>
                    <span>Keep a new set of notes separate</span>
                  </button>
                </div>
              ) : (
                <div className="empty-pages empty-notebooks">
                  <div className="empty-illustration"><FolderOpen size={34} /></div>
                  <h3>Start with your first notebook</h3>
                  <p>Create a notebook such as “Viva Notes” or “Class Notes”. You can add pages whenever you need.</p>
                  <button className="primary-button" onClick={() => setShowNotebookForm(true)}><Plus size={17} /> Create notebook</button>
                </div>
              )}
            </>
          ) : (
            <div className="welcome-state">
              <div className="welcome-badge"><Sparkles size={15} /> YOUR PERSONAL STUDY SPACE</div>
              <div className="welcome-art"><BookOpen size={46} /><span className="welcome-spark spark-one">✦</span><span className="welcome-spark spark-two">✧</span></div>
              <h1>Make room for<br /><em>better notes.</em></h1>
              <p>Create your first course to organize handwritten notes into notebooks. Your notes stay on this device.</p>
              {showCourseForm ? (
                <form className="welcome-form" onSubmit={handleAddCourse}>
                  <input autoFocus value={newCourseName} onChange={(event) => setNewCourseName(event.target.value)} placeholder="e.g. Computer Science" maxLength={60} />
                  <button className="primary-button" type="submit" disabled={!newCourseName.trim()}>Create course <ChevronRight size={16} /></button>
                </form>
              ) : (
                <button className="primary-button welcome-cta" onClick={() => setShowCourseForm(true)}><Plus size={17} /> Create your first course</button>
              )}
              <div className="welcome-points">
                <span><ShieldCheck size={15} /> Private by default</span>
                <span><FileText size={15} /> Export to PDF</span>
                <span><ImageIcon size={15} /> Keep original images</span>
              </div>
            </div>
          )}

          {editingPage && (
            <div className="editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isApplyingEdit) setEditingPage(null); }}>
              <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
                <div className="editor-header">
                  <div><span className="eyebrow">PAGE TOOLS</span><h2 id="editor-title">Edit page</h2></div>
                  <button className="icon-button" aria-label="Close editor" onClick={() => setEditingPage(null)} disabled={isApplyingEdit}><X size={17} /></button>
                </div>
                <div className="editor-preview">
                  <img
                    src={editingPage.id === undefined ? '' : imageUrls.get(editingPage.id)}
                    alt="Page preview"
                    style={{ transform: `rotate(${editRotation}deg)`, filter: editFilter === 'grayscale' ? 'grayscale(1) contrast(1.12)' : editFilter === 'document' ? 'grayscale(1) contrast(1.55) brightness(1.08)' : 'none' }}
                  />
                </div>
                <div className="editor-tools">
                  <div className="editor-tool-row">
                    <strong>Rotate</strong>
                    <button className="secondary-button" onClick={() => setEditRotation((value) => (value + 270) % 360)}><RotateCw size={15} /> Rotate left</button>
                    <button className="secondary-button" onClick={() => setEditRotation((value) => (value + 90) % 360)}><RotateCw size={15} /> Rotate right</button>
                    <button className="secondary-button" onClick={() => openPageScanner(editingPage)}><Scan size={15} /> Crop &amp; straighten</button>
                  </div>
                  <div className="editor-filter-row">
                    <strong>Appearance</strong>
                    <div className="filter-options">
                      <button className={`filter-option ${editFilter === 'original' ? 'active' : ''}`} onClick={() => setEditFilter('original')}>Original</button>
                      <button className={`filter-option ${editFilter === 'grayscale' ? 'active' : ''}`} onClick={() => setEditFilter('grayscale')}>Grayscale</button>
                      <button className={`filter-option ${editFilter === 'document' ? 'active' : ''}`} onClick={() => setEditFilter('document')}>Document</button>
                    </div>
                  </div>
                  <p className="editor-help">Document mode increases contrast for handwritten notes. The original page is replaced only when you choose Save changes.</p>
                </div>
                <div className="editor-footer">
                  <button className="secondary-button" onClick={() => setEditingPage(null)} disabled={isApplyingEdit}>Cancel</button>
                  <button className="primary-button" onClick={() => void savePageEdit()} disabled={isApplyingEdit}>{isApplyingEdit ? 'Saving…' : 'Save changes'}</button>
                </div>
              </section>
            </div>
          )}

          {scannerRequest && (
            <DocumentScanner
              source={scannerRequest.source}
              sourceName={scannerRequest.sourceName}
              onCancel={() => setScannerRequest(null)}
              onSave={saveScannedImage}
            />
          )}

          <footer className="main-footer">
            <span>Sohoj Note · Built for your study routine</span>
            <span><ShieldCheck size={13} /> Your notes are stored locally</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;
