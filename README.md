# file-watcher-service

CLI package that watches incoming brief files and sends them to the automated ingestion API.

## Install

Global install (recommended for operators and shared environments):

```bash
npm install -g file-watcher-service
```

Run with:

```bash
file-watcher
```

Run one-time mode (process existing files and exit):

```bash
file-watcher --once
```

## Local development

```bash
npm install
npm run start
```

One-time mode:

```bash
npm run start:once
```

## Required runtime setup

1. Node.js 18+
2. Reachable ingestion API
3. Service credentials with access to login and ingestion endpoints
4. Environment variables configured (see below)

Copy the example config and customize values:

```bash
copy .env.example .env
```

## Environment variables

Required:

- AUTOMATED_INGEST_USERNAME
- AUTOMATED_INGEST_PASSWORD

Optional (with defaults):

- AUTOMATED_INGEST_API_BASE_URL (default: http://localhost:5000)
- AUTOMATED_INGEST_LOGIN_ENDPOINT (default: /api/auth/login)
- AUTOMATED_INGEST_PROCESS_ENDPOINT (default: /api/extractai/process-automated-brief)
- AUTOMATED_INGEST_WATCH_ROOT (default: ./uploads/automated-briefs)
- AUTOMATED_INGEST_PROCESSED_ROOT (default: ./uploads/automated-briefs/.processed)
- AUTOMATED_INGEST_WATCH_FOLDERS (default: us bank,newell)
- AUTOMATED_INGEST_ALLOWED_EXTENSIONS (default: .pdf,.doc,.docx)
- AUTOMATED_INGEST_FOLDER_CONFIG_MAP (optional JSON object mapping folder names to config IDs)

Example for folder config mapping:

```env
AUTOMATED_INGEST_FOLDER_CONFIG_MAP={"us bank":101,"newell":102}
```

## Publishing

Pre-check:

```bash
npm whoami
npm publish --dry-run
```

Publish:

```bash
npm publish
```

If your npm account requires extra security, publish with OTP or a granular token that allows publish.

## What this service does

- Watches configured subfolders under the watch root
- Accepts configured file extensions
- Authenticates to the API
- Uploads files with folder metadata (and optional config mapping)
- Moves successfully processed files into a .processed path
