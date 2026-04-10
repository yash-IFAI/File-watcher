# Automated Brief Watcher (Standalone)

This is a standalone service that watches brief files and posts them to Planx's automated ingestion API.

## Why this exists

Use this repository when you want watcher dependencies isolated from the main Planx application.

## Requirements

- Node.js 18+
- Reachable Planx API
- A watcher user account with access to the login and ingestion endpoints

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create local config by copying `.env.example` to `.env`.

3. Update `.env` with your credentials and folder paths.

## Run

Continuous watch mode:

```bash
npm run start
```

One-time mode (process existing files and exit):

```bash
npm run start:once
```

Run through the CLI command directly:

```bash
file-watcher
file-watcher --once
```

## Publish as npm package

1. Ensure the package is logged in and ready:

```bash
npm login
```

2. Publish:

```bash
npm publish
```

3. Install globally (on any machine):

```bash
npm install -g file-watcher-service
```

4. Run:

```bash
file-watcher
```

## Environment variables

- `AUTOMATED_INGEST_USERNAME` (required)
- `AUTOMATED_INGEST_PASSWORD` (required)
- `AUTOMATED_INGEST_API_BASE_URL` (default: `http://localhost:5000`)
- `AUTOMATED_INGEST_LOGIN_ENDPOINT` (default: `/api/auth/login`)
- `AUTOMATED_INGEST_PROCESS_ENDPOINT` (default: `/api/extractai/process-automated-brief`)
- `AUTOMATED_INGEST_WATCH_ROOT` (default: `./uploads/automated-briefs`)
- `AUTOMATED_INGEST_PROCESSED_ROOT` (default: `./uploads/automated-briefs/.processed`)
- `AUTOMATED_INGEST_WATCH_FOLDERS` (default: `us bank,newell`)
- `AUTOMATED_INGEST_ALLOWED_EXTENSIONS` (default: `.pdf,.doc,.docx`)
- `AUTOMATED_INGEST_FOLDER_CONFIG_MAP` (optional JSON object mapping folder names to config IDs)

## Push as separate repo

From the `automated-brief-watcher` folder:

```bash
git init
git add .
git commit -m "Initial standalone automated brief watcher"
git branch -M main
git remote add origin <your-new-repo-url>
git push -u origin main
```
