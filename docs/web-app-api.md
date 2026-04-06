# Web App and API Notes

## Stack

- Next.js App Router
- NextAuth
- Drizzle ORM + Neon serverless Postgres
- Firestore API proxy for media data

Key files:

- `web/src/app/api/images/route.js`
- `web/src/app/api/share/route.js`
- `web/src/app/components/GalleryLightbox.jsx`
- `web/src/db/schema.js`

## Auth and Config Model

- User auth/session handled by NextAuth
- Per-user Firebase config stored in `user_configs` table
- API handlers read Firebase config and call Firestore REST API

## Images API (`/api/images`)

- `GET`: fetches image docs from Firestore `images` collection, parses Firestore value types (scalar, array, map)
- `PATCH`: updates editable fields with Firestore patch and update mask

Firestore base URL pattern in API:

- `.../databases/(default)/documents/images`

## Gallery Lightbox in Web App

- shows Noobs and Nerds tabs
- field counts shown beside tab labels
- Firestore document link included in Noobs section
- collection path in link derives from:
  - `image.collectionId` if present
  - fallback `trash` when deleted flag exists
  - fallback `images` otherwise

Working Firebase console link format:

- `https://console.firebase.google.com/u/1/project/<projectId>/firestore/databases/-default-/data/~2F<collection>~2F<documentId>?view=panel-view`

## Share Flow

- `POST /api/share` creates or updates reusable share token per `(userId, imageId)`
- share payload removes sensitive delete URLs before storing
- shared page uses `GalleryLightbox` with redacted fields list to display `REDACTED` for sensitive values

## Database Tables (high level)

- NextAuth: `users`, `accounts`, `sessions`
- Config: `user_configs`
- Sharing: `share_links`
