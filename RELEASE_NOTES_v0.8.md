# Sohoj Note v0.8.2 — Release notes

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
