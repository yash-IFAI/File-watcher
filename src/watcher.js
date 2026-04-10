#!/usr/bin/env node

import "dotenv/config";
import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import fetch from "node-fetch";
import FormData from "form-data";

const DEFAULT_ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];
const DEFAULT_WATCH_FOLDERS = ["us bank", "newell"];

const CONFIG = {
  apiBaseUrl: process.env.AUTOMATED_INGEST_API_BASE_URL || "http://localhost:5000",
  loginEndpoint: process.env.AUTOMATED_INGEST_LOGIN_ENDPOINT || "/api/auth/login",
  processEndpoint:
    process.env.AUTOMATED_INGEST_PROCESS_ENDPOINT || "/api/extractai/process-automated-brief",
  username: process.env.AUTOMATED_INGEST_USERNAME || "",
  password: process.env.AUTOMATED_INGEST_PASSWORD || "",
  watchRoot:
    process.env.AUTOMATED_INGEST_WATCH_ROOT ||
    path.join(process.cwd(), "uploads", "automated-briefs"),
  processedRoot:
    process.env.AUTOMATED_INGEST_PROCESSED_ROOT ||
    path.join(process.cwd(), "uploads", "automated-briefs", ".processed"),
  watchFolders: (process.env.AUTOMATED_INGEST_WATCH_FOLDERS || DEFAULT_WATCH_FOLDERS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  allowedExtensions: (
    process.env.AUTOMATED_INGEST_ALLOWED_EXTENSIONS || DEFAULT_ALLOWED_EXTENSIONS.join(",")
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  folderConfigMap: parseFolderConfigMap(process.env.AUTOMATED_INGEST_FOLDER_CONFIG_MAP),
};

let authToken = null;
let sessionCookie = "";
const inFlight = new Set();

function parseFolderConfigMap(rawValue) {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          key.trim().toLowerCase(),
          Number.isInteger(Number(value)) ? Number(value) : null,
        ]),
      );
    }
  } catch {
    console.warn("[watcher] Invalid AUTOMATED_INGEST_FOLDER_CONFIG_MAP JSON. Ignoring.");
  }
  return {};
}

function formatNow() {
  return new Date().toISOString();
}

function log(message, extra = null) {
  if (extra) {
    console.log(`[${formatNow()}] ${message}`, extra);
  } else {
    console.log(`[${formatNow()}] ${message}`);
  }
}

function assertRequiredConfig() {
  const missing = [];
  if (!CONFIG.username) missing.push("AUTOMATED_INGEST_USERNAME");
  if (!CONFIG.password) missing.push("AUTOMATED_INGEST_PASSWORD");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

async function login() {
  const loginUrl = new URL(CONFIG.loginEndpoint, CONFIG.apiBaseUrl).toString();

  log("Authenticating watcher user", { loginUrl, username: CONFIG.username });

  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: CONFIG.username,
      password: CONFIG.password,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed (${response.status} ${response.statusText}): ${text}`);
  }

  const responseJson = await response.json();
  authToken = responseJson?.token || null;

  const rawSetCookie = response.headers.raw()["set-cookie"] || [];
  sessionCookie = rawSetCookie.map((cookie) => cookie.split(";")[0]).join("; ");

  if (!authToken) {
    throw new Error("Login succeeded but no token was returned");
  }

  if (!sessionCookie) {
    throw new Error("Login succeeded but no session cookie was returned");
  }

  log("Authentication successful");
}

function getFolderNameForFile(filePath) {
  const relative = path.relative(CONFIG.watchRoot, filePath);
  if (!relative || relative.startsWith("..")) return null;
  const parts = relative.split(path.sep);
  return parts[0] || null;
}

function shouldProcessFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!CONFIG.allowedExtensions.includes(extension)) return false;

  const folderName = getFolderNameForFile(filePath);
  if (!folderName) return false;

  return CONFIG.watchFolders.some(
    (allowedFolder) => allowedFolder.toLowerCase() === folderName.toLowerCase(),
  );
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

async function moveToProcessed(filePath, folderName) {
  const destinationDir = path.join(CONFIG.processedRoot, folderName);
  await fs.promises.mkdir(destinationDir, { recursive: true });

  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const stampedName = `${Date.now()}_${sanitizeFileName(base)}${ext}`;
  const destinationPath = path.join(destinationDir, stampedName);

  await fs.promises.rename(filePath, destinationPath);
  return destinationPath;
}

async function postFileToAutomatedBriefEndpoint(filePath, folderName, retryCount = 0) {
  if (!authToken || !sessionCookie) {
    await login();
  }

  const processUrl = new URL(CONFIG.processEndpoint, CONFIG.apiBaseUrl).toString();
  const formData = new FormData();

  formData.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: getMimeType(filePath),
  });
  formData.append("folderName", folderName);

  const mappedConfigId = CONFIG.folderConfigMap[folderName.toLowerCase()];
  if (mappedConfigId && Number.isInteger(mappedConfigId)) {
    formData.append("configId", String(mappedConfigId));
  }

  const response = await fetch(processUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      Cookie: sessionCookie,
      ...formData.getHeaders(),
    },
    body: formData,
  });

  if ((response.status === 401 || response.status === 403) && retryCount < 1) {
    log("Session/token expired. Re-authenticating and retrying once.");
    authToken = null;
    sessionCookie = "";
    await login();
    return postFileToAutomatedBriefEndpoint(filePath, folderName, retryCount + 1);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Automated brief API failed (${response.status} ${response.statusText}): ${text}`,
    );
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  return parsed;
}

async function processFile(filePath) {
  if (inFlight.has(filePath)) return;
  if (!shouldProcessFile(filePath)) return;

  const folderName = getFolderNameForFile(filePath);
  if (!folderName) return;

  inFlight.add(filePath);

  try {
    log("Detected file for automated ingestion", { filePath, folderName });

    const result = await postFileToAutomatedBriefEndpoint(filePath, folderName);
    const movedPath = await moveToProcessed(filePath, folderName);

    log("Automated ingestion completed", {
      filePath,
      movedPath,
      action: result?.action || "unknown",
      smartInboxId: result?.smartInboxId || null,
      hashedJobId: result?.hashedJobId || null,
    });
  } catch (error) {
    log("Automated ingestion failed", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    inFlight.delete(filePath);
  }
}

async function processExistingFilesOnce() {
  for (const folder of CONFIG.watchFolders) {
    const folderPath = path.join(CONFIG.watchRoot, folder);
    if (!fs.existsSync(folderPath)) continue;

    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(folderPath, entry.name);
      await processFile(filePath);
    }
  }
}

async function ensureFolders() {
  await fs.promises.mkdir(CONFIG.watchRoot, { recursive: true });
  await fs.promises.mkdir(CONFIG.processedRoot, { recursive: true });

  for (const folder of CONFIG.watchFolders) {
    await fs.promises.mkdir(path.join(CONFIG.watchRoot, folder), { recursive: true });
  }
}

async function run() {
  assertRequiredConfig();
  await ensureFolders();
  await login();

  const onceMode = process.argv.includes("--once");

  if (onceMode) {
    log("Running in one-time mode");
    await processExistingFilesOnce();
    log("One-time run complete");
    process.exit(0);
  }

  const watchPaths = CONFIG.watchFolders.map((folder) => path.join(CONFIG.watchRoot, folder));

  log("Starting watcher", {
    watchRoot: CONFIG.watchRoot,
    watchFolders: CONFIG.watchFolders,
    watchPaths,
    apiBaseUrl: CONFIG.apiBaseUrl,
  });

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
    depth: 0,
  });

  watcher.on("add", async (addedPath) => {
    await processFile(addedPath);
  });

  watcher.on("error", (error) => {
    log("Watcher error", { error: error?.message || String(error) });
  });

  process.on("SIGINT", async () => {
    log("Shutting down watcher (SIGINT)");
    await watcher.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    log("Shutting down watcher (SIGTERM)");
    await watcher.close();
    process.exit(0);
  });
}

run().catch((error) => {
  log("Watcher startup failed", { error: error?.message || String(error) });
  process.exit(1);
});
