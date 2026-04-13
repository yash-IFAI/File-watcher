# New User Setup Guide (Non-Technical)

This guide is for people who do not want to use terminal commands.

## Recommended: Double-Click Setup (Easiest)

### First-time setup (1-2 minutes)

1. Open the watcher folder.
2. Make a copy of `config.example.json`.
3. Rename the copy to `config.json`.
4. Open `config.json` in Notepad.
5. Update these two values and save:
   - `username`
   - `password`

That is it for setup.

### Daily use

1. Double-click `start-watcher.bat`.
2. A window opens and starts monitoring files.
3. On first run after ZIP extraction, the app may install required packages automatically.
4. Wait until the start message appears.
5. Drop files into:
  - `uploads/automated-briefs/us bank`
  - `uploads/automated-briefs/newell`
6. The watcher uploads files automatically.
7. Successfully processed files move to:
  - `uploads/automated-briefs/.processed/us bank`
  - `uploads/automated-briefs/.processed/newell`

What you will see in the window:
- Watcher started
- Monitoring folder paths
- New file detected: report.pdf
- Upload successful

You get the same visibility as terminal logs, with no manual command steps.

## Option 2: Terminal/Advanced Setup (For Technical Users)

Use this only if you prefer command-line workflows.

1. Install Node.js LTS from https://nodejs.org/en/download
2. Open terminal in this folder.
3. Install dependencies:

```powershell
npm install
```

4. Create config:

```powershell
Copy-Item config.example.json config.json
```

5. Run watcher:

```powershell
npm run start
```

One-time mode (process current files and exit):

```powershell
npm run start -- --once
```

## Troubleshooting

- If startup says setup is required:
  - Check that `config.json` exists in the same folder as `start-watcher.bat`.
- If login fails:
  - Re-check `username`, `password`, and `apiBaseUrl` in `config.json`.
- If no files are picked up:
  - Confirm files are in the correct watched folders.
  - Confirm extensions are allowed (`.pdf`, `.doc`, `.docx` by default).
- Logs are saved in:
  - `logs/automated-brief-watcher.log.txt`
