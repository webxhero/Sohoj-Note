# Sohoj Note v0.8.4 — Release notes

## Branding
- Changed the visible app name from SmartNote to Sohoj Note.
- Updated the logo and PWA icons to `#0842A0`.
- Updated browser title and installable-app manifest name.

## Interaction polish
- Added smooth scrolling for page and course navigation.
- Added restrained entrance and touch feedback animations.
- Respects `prefers-reduced-motion`.

## Compatibility
- Preserved the existing IndexedDB database name.
- Preserved the `smartnote-backup` backup format and `.smartnote.json` extension.
- No dependencies were added or changed.

## Mobile page gallery and scrolling
- Restored two page thumbnails per row on phone screens.
- Reduced image preview height and preserved image proportions without cropping.
- Reworked page actions into a compact responsive grid so controls remain accessible.
- Added lazy image loading and asynchronous image decoding for smoother long notebooks.
- Kept smooth scrolling on the document while nested touch areas use native scrolling.
- No database, backup-format, or dependency changes.

## v0.8.3 — Full-page page editor
- Edit page now opens as a dedicated page instead of a modal.
- Rotate left, rotate right, and crop/straighten actions are icon-only buttons with accessible labels and tooltips.
- Added a mobile-friendly sticky header and save/cancel action bar with safe-area spacing.
- Returns to the previous notebook scroll position after closing the editor.
- Existing IndexedDB data and `.smartnote.json` backups remain compatible.

## v0.8.4 — Mobile notebook layout
- Fixed page thumbnail height and clipping so long portrait images cannot hide page actions.
- Moved all five page actions into a dedicated, always-visible toolbar below each thumbnail.
- Removed the large add-notes heading and description block.
- Made Photo, Scan, and Upload compact one-row actions on mobile.
- Moved PDF export controls to the bottom, after the complete page grid.
- Kept two page thumbnails per row on mobile and preserved existing local data/backup compatibility.
