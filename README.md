# SmartNote v0.8

A local-first, installable PWA for organizing handwritten notes by course and notebook.

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




## v0.8 updates

- Four-corner document crop with touch-friendly handles.
- Perspective correction using an inverse homography and bilinear image sampling.
- Local document-edge suggestions using Sobel gradients and a Hough line transform, with manual-corner fallback.
- Corrected-image preview and rotation before saving.
- Scanned pages can be added to a notebook or replace an existing page while preserving its chapter and sort order.
- Mobile Settings, backup and storage actions are available from the top-right menu.
- Page action controls are kept in a separate toolbar below the image preview.
