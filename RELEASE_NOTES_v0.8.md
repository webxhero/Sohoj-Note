# SmartNote v0.8 — Release notes

## Included

- Kept the existing React, TypeScript, Vite, Dexie/IndexedDB, PDF and PWA architecture.
- Preserved the existing course, notebook, page, backup/restore and PDF export flows.
- Kept the PDF `BlobPart` ArrayBuffer compatibility fix already present in v0.7.
- Reworked page cards so the image preview and action toolbar occupy separate layout regions. Tall images no longer control or clip the action toolbar.
- Added a mobile top-right menu with Settings, backup, restore and storage actions.
- Added a local document scanner for new photos and existing pages.
- Added four draggable crop corners with pointer/touch support.
- Added local Sobel + Hough document-edge suggestions with manual fallback.
- Added perspective correction through an inverse homography and bilinear sampling.
- Added a corrected-image preview and 90-degree rotation controls.
- Existing-page scans update only the image and dimensions; chapter, filename, page order and ID remain unchanged.
- New scans append one page to the selected notebook using the current chapter draft.
- No new paid service, cloud dependency or computer-vision package was added.

## Validation performed

- TypeScript syntax transpilation passed for all source `.ts` and `.tsx` files.
- The scanner utility passed a strict standalone TypeScript check.
- A temporary type-check using local ambient stubs found no type errors in the application source; this is not a substitute for the real dependency-backed build.
- CSS parsed successfully.
- Automatic edge detection was exercised against synthetic trapezoid, rotated quadrilateral, rectangle, low-contrast page and no-document images.

## Not verified in this environment

The dependency registry could not be reached (`EAI_AGAIN registry.npmjs.org`). `npm ci` could not finish, the offline install lacked a cached package tarball, and `npm run build` therefore could not complete with the real project dependencies. `npm audit` and `npm outdated` could not retrieve current registry data.

The lockfile identifies `glob@11.1.0` through `workbox-build@7.4.1`, which is brought in by `vite-plugin-pwa@0.21.2`. Dependency versions were deliberately left unchanged rather than applying unverified upgrades.

Before deployment, run:

```bash
npm ci
npm run build
npm audit
npm outdated
```

Resolve any reported build or security issues before publishing the release.
