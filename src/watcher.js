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
  logFilePath:
    process.env.AUTOMATED_INGEST_LOG_FILE ||
    path.join(process.cwd(), "logs", "automated-brief-watcher.log.txt"),
  folderConfigMap: parseFolderConfigMap(process.env.AUTOMATED_INGEST_FOLDER_CONFIG_MAP),
};

let authToken = null;
let sessionCookie = "";
const inFlight = new Set();
let logStream = null;

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

function toSingleLineJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function initializeLogger() {
  const logDirectory = path.dirname(CONFIG.logFilePath);
  await fs.promises.mkdir(logDirectory, { recursive: true });

  logStream = fs.createWriteStream(CONFIG.logFilePath, { flags: "a" });
  logStream.on("error", (error) => {
    console.error(`[${formatNow()}] [ERROR] Failed writing log file`, {
      error: error?.message || String(error),
      logFilePath: CONFIG.logFilePath,
    });
  });
}

async function closeLogger() {
  if (!logStream) return;

  await new Promise((resolve) => {
    logStream.end(resolve);
  });
}

function log(message, extra = null, level = "INFO") {
  const baseLine = `[${formatNow()}] [${level}] ${message}`;
  const fullLine = extra ? `${baseLine} ${toSingleLineJson(extra)}` : baseLine;

  console.log(fullLine);

  if (logStream && !logStream.destroyed) {
    logStream.write(`${fullLine}\n`);
  }
}

function createStepLogger(context = {}) {
  let step = 0;
  return (message, extra = null, level = "INFO") => {
    step += 1;
    const stepContext = {
      ...context,
      step,
    };
    log(message, extra ? { ...stepContext, ...extra } : stepContext, level);
  };
}

function getFileEvaluation(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!CONFIG.allowedExtensions.includes(extension)) {
    return {
      shouldProcess: false,
      extension,
      reason: "extension-not-allowed",
      folderName: null,
    };
  }

  const folderName = getFolderNameForFile(filePath);
  if (!folderName) {
    return {
      shouldProcess: false,
      extension,
      reason: "file-outside-watch-root",
      folderName: null,
    };
  }

  const isWatchedFolder = CONFIG.watchFolders.some(
    (allowedFolder) => allowedFolder.toLowerCase() === folderName.toLowerCase(),
  );

  if (!isWatchedFolder) {
    return {
      shouldProcess: false,
      extension,
      reason: "folder-not-configured",
      folderName,
    };
  }

  return {
    shouldProcess: true,
    extension,
    reason: "eligible",
    folderName,
  };
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
  const stepLog = createStepLogger({ flow: "login", loginUrl });

  stepLog("Preparing watcher authentication", { username: CONFIG.username });

  stepLog("Sending login request");

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

  stepLog("Received login response", {
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const text = await response.text();
    stepLog("Login response indicates failure", { responseBody: text }, "ERROR");
    throw new Error(`Login failed (${response.status} ${response.statusText}): ${text}`);
  }

  stepLog("Parsing login response body");
  const responseJson = await response.json();
  authToken = responseJson?.token || null;

  stepLog("Extracting session cookie from response headers");
  const rawSetCookie = response.headers.raw()["set-cookie"] || [];
  sessionCookie = rawSetCookie.map((cookie) => cookie.split(";")[0]).join("; ");

  if (!authToken) {
    throw new Error("Login succeeded but no token was returned");
  }

  if (!sessionCookie) {
    throw new Error("Login succeeded but no session cookie was returned");
  }

  stepLog("Authentication completed successfully");
}

function getFolderNameForFile(filePath) {
  const relative = path.relative(CONFIG.watchRoot, filePath);
  if (!relative || relative.startsWith("..")) return null;
  const parts = relative.split(path.sep);
  return parts[0] || null;
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
  const stepLog = createStepLogger({
    flow: "process-api-call",
    filePath,
    folderName,
    retryCount,
  });

  if (!authToken || !sessionCookie) {
    stepLog("Missing authentication context. Logging in again before upload.");
    await login();
  }

  const processUrl = new URL(CONFIG.processEndpoint, CONFIG.apiBaseUrl).toString();
  const formData = new FormData();
  stepLog("Preparing upload payload", { processUrl });

  formData.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: getMimeType(filePath),
  });
  formData.append("folderName", folderName);

  const mappedConfigId = CONFIG.folderConfigMap[folderName.toLowerCase()];
  if (mappedConfigId && Number.isInteger(mappedConfigId)) {
    formData.append("configId", String(mappedConfigId));
    stepLog("Attached mapped config ID", { mappedConfigId });
  }

  stepLog("Sending file to automated ingestion API");
  const response = await fetch(processUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      Cookie: sessionCookie,
      ...formData.getHeaders(),
    },
    body: formData,
  });

  stepLog("Received ingestion API response", {
    status: response.status,
    statusText: response.statusText,
  });

  if ((response.status === 401 || response.status === 403) && retryCount < 1) {
    stepLog("Session/token expired. Re-authenticating and retrying once.", null, "WARN");
    authToken = null;
    sessionCookie = "";
    await login();
    return postFileToAutomatedBriefEndpoint(filePath, folderName, retryCount + 1);
  }

  const text = await response.text();

  if (!response.ok) {
    stepLog("Ingestion API returned failure", { responseBody: text }, "ERROR");
    throw new Error(
      `Automated brief API failed (${response.status} ${response.statusText}): ${text}`,
    );
  }

  stepLog("Parsing successful ingestion response body");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  stepLog("Ingestion API call finished successfully");

  return parsed;
}

async function processFile(filePath) {
  const traceId = `${Date.now()}-${path.basename(filePath)}`;
  const stepLog = createStepLogger({ flow: "process-file", traceId, filePath });

  stepLog("Received file for processing");

  if (inFlight.has(filePath)) {
    stepLog("File already being processed. Skipping duplicate trigger.", null, "WARN");
    return;
  }

  const evaluation = getFileEvaluation(filePath);
  stepLog("Evaluated file eligibility", {
    shouldProcess: evaluation.shouldProcess,
    reason: evaluation.reason,
    extension: evaluation.extension,
    folderName: evaluation.folderName,
  });

  if (!evaluation.shouldProcess || !evaluation.folderName) {
    stepLog("Skipping file because it is not eligible for processing", {
      reason: evaluation.reason,
    });
    return;
  }

  const folderName = evaluation.folderName;
  inFlight.add(filePath);
  stepLog("Marked file as in-flight");

  try {
    stepLog("Starting automated ingestion workflow", { folderName });

    const result = await postFileToAutomatedBriefEndpoint(filePath, folderName);
    stepLog("File uploaded successfully. Moving to processed folder.");
    const movedPath = await moveToProcessed(filePath, folderName);

    stepLog("Automated ingestion completed", {
      filePath,
      movedPath,
      action: result?.action || "unknown",
      smartInboxId: result?.smartInboxId || null,
      hashedJobId: result?.hashedJobId || null,
    });
  } catch (error) {
    stepLog("Automated ingestion failed", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    }, "ERROR");
  } finally {
    inFlight.delete(filePath);
    stepLog("Removed file from in-flight set");
  }
}

async function processExistingFilesOnce() {
  const stepLog = createStepLogger({ flow: "once-mode" });
  stepLog("Starting one-time processing of existing files");

  for (const folder of CONFIG.watchFolders) {
    const folderPath = path.join(CONFIG.watchRoot, folder);
    if (!fs.existsSync(folderPath)) {
      stepLog("Watch folder does not exist. Skipping.", { folderPath }, "WARN");
      continue;
    }

    stepLog("Scanning folder for existing files", { folderPath });

    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(folderPath, entry.name);
      stepLog("Found existing file. Processing.", { filePath });
      await processFile(filePath);
    }
  }

  stepLog("Completed one-time processing run");
}

async function ensureFolders() {
  const stepLog = createStepLogger({ flow: "bootstrap-folders" });
  stepLog("Ensuring watch and processed directories exist");

  await fs.promises.mkdir(CONFIG.watchRoot, { recursive: true });
  await fs.promises.mkdir(CONFIG.processedRoot, { recursive: true });
  stepLog("Ensured root directories", {
    watchRoot: CONFIG.watchRoot,
    processedRoot: CONFIG.processedRoot,
  });

  for (const folder of CONFIG.watchFolders) {
    await fs.promises.mkdir(path.join(CONFIG.watchRoot, folder), { recursive: true });
    stepLog("Ensured watched subfolder", { folder });
  }
}

async function run() {
  await initializeLogger();
  log("Logger initialized", { logFilePath: CONFIG.logFilePath });

  assertRequiredConfig();
  await ensureFolders();
  await login();

  const onceMode = process.argv.includes("--once");

  if (onceMode) {
    log("Running in one-time mode");
    await processExistingFilesOnce();
    log("One-time run complete");
    await closeLogger();
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
    await closeLogger();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    log("Shutting down watcher (SIGTERM)");
    await watcher.close();
    await closeLogger();
    process.exit(0);
  });
}

run().catch((error) => {
  log("Watcher startup failed", { error: error?.message || String(error) }, "ERROR");
  closeLogger().finally(() => process.exit(1));
});
