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

## First-time setup after global install

When installed globally, this CLI reads `.env` from the folder where you run `file-watcher`.

1. Create a working folder (example: `C:\watcher-run`).
2. In that folder, create a `.env` file.
3. Copy values from [.env.example](.env.example) and set your real credentials and paths.
4. Run the command from that same folder.

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Path C:\watcher-run -Force
Set-Location C:\watcher-run
Copy-Item C:\Users\admin\IFAI\File-watcher\.env.example .env
notepad .env
file-watcher
```

macOS/Linux:

```bash
mkdir -p ~/watcher-run
cd ~/watcher-run
cp /path/to/.env.example .env
nano .env
file-watcher
```

Notes:

- If you run from a different folder, the CLI will look for `.env` there.
- Relative paths in env values are resolved from the current working folder.
- Use absolute paths in `.env` if you plan to run from multiple locations.

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
- AUTOMATED_INGEST_LOG_FILE (default: ./logs/automated-brief-watcher.log.txt)
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

## Logging

- Every major watcher action is logged step-by-step (startup, auth, file eligibility, upload, response handling, and move-to-processed).
- Logs are printed to the console for interactive monitoring.
- The same logs are appended to a text file at `AUTOMATED_INGEST_LOG_FILE`.
