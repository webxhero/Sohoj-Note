# SmartNote

A local-first, installable PWA for organizing handwritten notes by course and notebook.

## Current starter features

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

## Requirements

- Node.js 20.19+ recommended.
- npm.
- A modern browser. Camera capture requires a secure context (HTTPS or localhost).

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. On a phone, the development server and phone must be on the same Wi-Fi network; use the Network URL printed by Vite. Camera permissions may require HTTPS, so test camera capture on the deployed HTTPS version or localhost.

## Build for production

```bash
npm run build
npm run preview
```

The production files are generated in `dist/`.

## Free hosting target

Cloudflare Pages can host the static PWA. Use:

- Build command: `npm run build`
- Build output directory: `dist`

No paid backend or cloud database is used by this starter.

## Data and privacy

Course, notebook, and page data are stored in this browser's IndexedDB on this device. There is no account, cloud sync, or automatic cross-device backup. Clearing this site's browser storage can permanently remove notes. A ZIP backup/restore feature is planned for a later phase; until it exists, do not clear browser data for this app if you have notes you need to keep.

## Next development steps

1. Add chapter grouping and page reordering.
2. Add ZIP backup and restore before relying on the app for important notes.
3. Improve scanner cropping, rotation, and image enhancement.
4. Add a storage usage indicator and optional export of a whole course.
5. Test PWA install and offline behavior on Android and desktop browsers.


## Version 0.3 update
- White-first, restrained professional interface with neutral slate accents.
- Removed reliance on remote font loading; system font stack is used for faster first paint.
- Lazy-loaded page thumbnails and reduced image processing size/quality to limit storage and memory use.
- Existing course, notebook, page, PDF, backup and restore workflows retained.

Scanner note: this release includes image normalization/compression, but does not yet include automatic page-edge detection or a manual perspective-crop editor. Those require a dedicated scanner interaction and should be implemented and tested as the next focused feature rather than presented as complete.


## v0.4 page editing

- Open the page editor from a page card.
- Rotate a page left or right in 90-degree steps.
- Apply Original, Grayscale, or Document contrast treatment.
- Preview changes before saving; the edited image replaces that page while keeping its notebook and page order.

The editor does not yet include automatic page-boundary detection, four-corner perspective correction, or freeform cropping.


## v0.5 — Warm ivory theme
- Replaced the green-tinted interface accents with a warm ivory (`#fffef2`), soft cream, and muted champagne palette.
- Updated page, sidebar, cards, buttons, editor, and mobile navigation colors for a consistent appearance.
- Updated browser/PWA theme color and app icon to match.


## v0.6
- Replaced the full warm-ivory canvas with a clean white workspace and subtle warm-white notebook/card surfaces.
- Moved Backup & Storage into a Settings dialog, with backup, restore, and local storage usage together.
- Settings is available in the sidebar and remains visible on mobile layouts.


## v0.7 — Material 3 Light refresh
- Applied the requested cool-blue and crisp-white palette through shared CSS tokens.
- Restyled the canvas, sidebar, course pills, notebook/page cards, CTAs, badges, settings dialog, and page editor.
- Preserved existing React state, IndexedDB/Dexie data handling, exports, backup/restore, and responsive layout logic.
- Updated browser and PWA theme colors to `#F8FAFD`.

Scanner crop and four-corner perspective correction are not part of v0.7; they remain the next feature milestone.
