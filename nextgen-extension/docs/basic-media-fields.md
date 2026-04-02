# Basic Media Fields

This document lists the stable base fields currently written to Firestore for ImgVault media records.

It intentionally excludes variable metadata fields that may differ by file or extraction path, such as:

- hashes like `sha256`, `pHash`, `aHash`, `dHash`
- EXIF payloads
- other source-specific metadata that is not guaranteed for every record

All current save paths come from [background.js](C:\Users\Admin\Downloads\ImgVault\nextgen-extension\src\background\background.js).

## Image Fields

Image records currently save these base fields:

1. `pixvidUrl`
2. `pixvidDeleteUrl`
3. `imgbbUrl`
4. `imgbbDeleteUrl`
5. `imgbbThumbUrl`
6. `sourceImageUrl`
7. `sourcePageUrl`
8. `pageTitle`
9. `fileName`
10. `fileSize`
11. `width`
12. `height`
13. `fileType`
14. `fileTypeSource`
15. `creationDate`
16. `creationDateSource`
17. `tags`
18. `description`
19. `collectionId`

## Video Fields

Video records currently save these base fields:

1. `sourceImageUrl`
2. `sourcePageUrl`
3. `pageTitle`
4. `fileName`
5. `fileSize`
6. `fileType`
7. `fileTypeSource`
8. `creationDate`
9. `creationDateSource`
10. `duration`
11. `width`
12. `height`
13. `tags`
14. `description`
15. `collectionId`
16. `isVideo`
17. `filemoonWatchUrl`
18. `filemoonDirectUrl`
19. `udropWatchUrl`
20. `udropDirectUrl`

## Notes

- Image records currently include host-management fields such as delete URLs because the extension still saves and manages hosted image copies directly.
- Video records currently use normalized watch/direct URL fields for Filemoon and UDrop.
- `isVideo` is explicitly saved for videos and is part of the lightweight gallery snapshot used for correct modal routing.
