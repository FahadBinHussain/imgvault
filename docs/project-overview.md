# Project Overview

## Repo Layout

- `nextgen-extension`: main browser extension (React + Vite + Tailwind + DaisyUI)
- `native-host`: Windows native messaging host (Rust/Tauri backend + minimal React UI)
- `web`: Next.js app with NextAuth + Drizzle + Neon-backed config/share storage
- `old extension`: legacy implementation kept for reference

## Product Model

ImgVault has two main media paths:

- Image path: capture from page -> metadata extraction + duplicate checks -> upload providers -> save record
- Video path: host-assisted download -> file handoff into gallery modal -> upload providers -> save record

## Core Data Stores

- `chrome.storage.sync`/`chrome.storage.local`: extension settings and session state
- IndexedDB in extension: persisted `FileSystemDirectoryHandle` for local download-folder reuse
- Firestore: media records, collections, trash, synced settings (via extension/web APIs)
- Neon/Postgres: web-side auth, user config, share link records

## Current Provider Setup

- Images: Pixvid, ImgBB
- Videos: Filemoon, UDrop

## Active Direction

- `nextgen-extension` is the primary user-facing surface
- `native-host` is required for host-assisted video downloads and local file path handling
- `web` is the authenticated remote UI and API layer
