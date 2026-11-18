# Sohoj Note v0.8.4

Sohoj Note is a local-first, installable PWA for organizing handwritten notes by course and notebook.

## Core features

- Create and delete courses.
- Create and delete notebooks inside a course.
- Capture a photo from a mobile device or upload existing images.
- Normalize large images to JPEG before saving.
- Save page images and metadata in IndexedDB using Dexie.
- Add an optional chapter label to each page.
- Preview pages, select multiple pages, and delete individual pages.
- Download an individual page as an image.
- Export all pages or selected pages as an A4 PDF.
- PWA manifest and service-worker setup for installability and app-shell caching.

## v0.8 features

- Four-corner document crop with touch-friendly handles.
- Perspective correction using an inverse homography and bilinear image sampling.
- Local document-edge suggestions using Sobel gradients and a Hough line transform, with manual-corner fallback.
- Corrected-image preview and rotation before saving.
- Scanned pages can be added to a notebook or replace an existing page while preserving chapter and sort order.
- Mobile Settings, backup and storage actions are available from the top-right menu.
- Page action controls are kept in a separate toolbar below the image preview.

## v0.8.1 branding and motion polish

- Rebranded the visible app name to **Sohoj Note**.
- Updated the app logo and PWA icons to the requested `#0842A0` blue.
- Updated browser title and installable-app manifest name.
- Added restrained smooth scrolling and subtle entrance/press feedback.
- Respects the operating system's reduced-motion preference.

## v0.8.2 mobile page gallery and scrolling fix

- Restored a two-column page-image grid on phone-sized screens.
- Reduced thumbnail height while preserving each image's aspect ratio with `object-fit: contain`.
- Kept page selection and page actions accessible in a compact, wrapping toolbar.
- Lazy-loads page thumbnails and decodes them asynchronously to reduce initial mobile work.
- Keeps document scrolling smooth while leaving nested touch-scroll areas on native scrolling.
- Preserves the existing IndexedDB database and backup format.

## Data compatibility

The existing IndexedDB database name and backup format remain unchanged so existing local notes and `.smartnote.json` backup files remain compatible.

## v0.8.3 full-page page editor

- Replaced the page-edit modal with a dedicated full-page editor view.
- Added icon-only rotate-left, rotate-right, and crop/straighten controls with accessible labels and tooltips.
- Added a page header and safe-area-aware sticky save bar for mobile.
- Restores the previous notebook scroll position when returning from the editor.
- Supports Escape to return to the notebook when a save is not in progress.
- Keeps the existing image processing, IndexedDB schema, and backup format unchanged.


## v0.8.4 mobile notebook layout and page action fix

- Constrained page previews to a fixed thumbnail area with `object-fit: contain`, so portrait or very tall images cannot push the page toolbar off-screen.
- Kept all five page actions in a dedicated toolbar below each image.
- Removed the large “Add notes to this notebook” intro block.
- Arranged Photo, Scan, and Upload as three compact actions on one mobile row, with the optional chapter field above.
- Moved selected-page and full-notebook PDF export buttons below the entire page grid.
- Preserved the two-column mobile page grid, IndexedDB schema, and `.smartnote.json` backup format.

