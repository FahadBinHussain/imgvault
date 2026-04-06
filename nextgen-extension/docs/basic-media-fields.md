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
17. `internalAddedTimestamp`
18. `tags`
19. `description`
20. `collectionId`

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
10. `internalAddedTimestamp`
11. `duration`
12. `width`
13. `height`
14. `tags`
15. `description`
16. `collectionId`
17. `isVideo`
18. `filemoonWatchUrl`
19. `filemoonDirectUrl`
20. `udropWatchUrl`
21. `udropDirectUrl`

## Notes

- Image records currently include host-management fields such as delete URLs because the extension still saves and manages hosted image copies directly.
- Video records currently use normalized watch/direct URL fields for Filemoon and UDrop.
- `isVideo` is explicitly saved for videos and is part of the lightweight gallery snapshot used for correct modal routing.

## Modal Mapping

The Gallery item modal currently uses these fields like this:

- `For Noobs` shows the stable base saved fields for the current media type.
- `For Nerds` shows technical and variable metadata fields, such as hashes and source-specific extras.

### For Noobs

The `For Noobs` tab shows stable user-facing fields, plus one extra visible field at the top:

- `firestoreDocumentId`

That means the current counted rows in `For Noobs` are:

- Images: 20 counted rows
- Videos: 21 counted rows

`collectionId` and `internalAddedTimestamp` are included in both the count badge and the numbered base-field list.

For images, the `pixvidUrl` and `imgbbUrl` rows are shown directly in `For Noobs`, and each row includes an inline download button.

In the upload modal for videos, this same stable base-field model is shown as a numbered `Video Fields To Save` section under `For Noobs`.

### For Nerds

The `For Nerds` tab currently shows:

1. `sha256`
2. `pHash`
3. `aHash`
4. `dHash`

After those fixed technical fields, the tab shows any remaining variable metadata fields from the full Firestore document that are not part of the stable base schema.

In the upload modal, `For Nerds` is dynamic and only appears when extra metadata fields are detected. If none are detected, the UI shows that no extra metadata fields were found.

## Upload Modal Note

The old aggregate `Total Firestore Fields` panel was removed from the upload modal because it could become stale and confusing as save logic evolved.
