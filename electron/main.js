import { app, BrowserWindow, ipcMain, session } from 'electron';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';
const normalizeBaseUrl = (value) => (value.endsWith('/') ? value : `${value}/`);
const LEGACY_ENGINE_DOWNLOAD_BASE_URL =
  process.env.VIBE_ENGINE_DOWNLOAD_BASE_URL || process.env.VITE_ENGINE_DOWNLOAD_BASE_URL;
const STOCKFISH_DOWNLOAD_BASE_URL = normalizeBaseUrl(
  process.env.VIBE_STOCKFISH_DOWNLOAD_BASE_URL ||
    process.env.STOCKFISH_DOWNLOAD_BASE_URL ||
    'https://cdn.jsdelivr.net/npm/stockfish@17.1.0/src/',
);
const ZEROFISH_DOWNLOAD_BASE_URL = normalizeBaseUrl(
  process.env.VIBE_ZEROFISH_DOWNLOAD_BASE_URL ||
    process.env.ZEROFISH_DOWNLOAD_BASE_URL ||
    'https://cdn.jsdelivr.net/npm/zerofish@0.0.36/dist/',
);
const MAIA_DOWNLOAD_BASE_URL = normalizeBaseUrl(
  process.env.VIBE_MAIA_DOWNLOAD_BASE_URL ||
    process.env.MAIA_DOWNLOAD_BASE_URL ||
    'https://github.com/CSSLab/maia-chess/releases/download/v1.0/',
);
const VIBECHESS_DIR_NAME = '.vibeChess';
const ENGINE_DIR_NAME = 'engine';
const MAIA_DIR_NAME = 'maia';
const STOCKFISH_JS = 'stockfish-17.1-lite-single-03e3232.js';
const STOCKFISH_WASM = 'stockfish-17.1-lite-single-03e3232.wasm';
const ZEROFISH_JS = 'zerofishEngine.js';
const ZEROFISH_WASM = 'zerofishEngine.wasm';
const MAIA_ELOS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];
const ENGINE_ASSETS = LEGACY_ENGINE_DOWNLOAD_BASE_URL
  ? [
      {
        id: 'stockfish-js',
        label: 'Stockfish (JS)',
        baseUrl: normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL),
        remotePath: `engine/${STOCKFISH_JS}`,
        dir: ENGINE_DIR_NAME,
        file: STOCKFISH_JS,
      },
      {
        id: 'stockfish-wasm',
        label: 'Stockfish (WASM)',
        baseUrl: normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL),
        remotePath: `engine/${STOCKFISH_WASM}`,
        dir: ENGINE_DIR_NAME,
        file: STOCKFISH_WASM,
      },
      {
        id: 'zerofish-js',
        label: 'Zerofish (JS)',
        baseUrl: normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL),
        remotePath: `engine/${ZEROFISH_JS}`,
        dir: ENGINE_DIR_NAME,
        file: ZEROFISH_JS,
      },
      {
        id: 'zerofish-wasm',
        label: 'Zerofish (WASM)',
        baseUrl: normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL),
        remotePath: `engine/${ZEROFISH_WASM}`,
        dir: ENGINE_DIR_NAME,
        file: ZEROFISH_WASM,
      },
      ...MAIA_ELOS.map((elo) => ({
        id: `maia-${elo}`,
        label: `Maia ${elo}`,
        baseUrl: normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL),
        remotePath: `maia/maia-${elo}.pb.gz`,
        dir: MAIA_DIR_NAME,
        file: `maia-${elo}.pb.gz`,
      })),
    ]
  : [
      {
        id: 'stockfish-js',
        label: 'Stockfish (JS)',
        baseUrl: STOCKFISH_DOWNLOAD_BASE_URL,
        remotePath: STOCKFISH_JS,
        dir: ENGINE_DIR_NAME,
        file: STOCKFISH_JS,
      },
      {
        id: 'stockfish-wasm',
        label: 'Stockfish (WASM)',
        baseUrl: STOCKFISH_DOWNLOAD_BASE_URL,
        remotePath: STOCKFISH_WASM,
        dir: ENGINE_DIR_NAME,
        file: STOCKFISH_WASM,
      },
      {
        id: 'zerofish-js',
        label: 'Zerofish (JS)',
        baseUrl: ZEROFISH_DOWNLOAD_BASE_URL,
        remotePath: ZEROFISH_JS,
        dir: ENGINE_DIR_NAME,
        file: ZEROFISH_JS,
      },
      {
        id: 'zerofish-wasm',
        label: 'Zerofish (WASM)',
        baseUrl: ZEROFISH_DOWNLOAD_BASE_URL,
        remotePath: ZEROFISH_WASM,
        dir: ENGINE_DIR_NAME,
        file: ZEROFISH_WASM,
      },
      ...MAIA_ELOS.map((elo) => ({
        id: `maia-${elo}`,
        label: `Maia ${elo}`,
        baseUrl: MAIA_DOWNLOAD_BASE_URL,
        remotePath: `maia-${elo}.pb.gz`,
        dir: MAIA_DIR_NAME,
        file: `maia-${elo}.pb.gz`,
      })),
    ];

const getVibeChessDir = () => path.join(app.getPath('home'), VIBECHESS_DIR_NAME);

const buildEnginePaths = (baseDir) => {
  const engineDir = path.join(baseDir, ENGINE_DIR_NAME);
  const maiaDir = path.join(baseDir, MAIA_DIR_NAME);
  return {
    stockfishJsUrl: pathToFileURL(path.join(engineDir, STOCKFISH_JS)).toString(),
    stockfishWasmUrl: pathToFileURL(path.join(engineDir, STOCKFISH_WASM)).toString(),
    zerofishJsUrl: pathToFileURL(path.join(engineDir, ZEROFISH_JS)).toString(),
    zerofishWasmUrl: pathToFileURL(path.join(engineDir, ZEROFISH_WASM)).toString(),
    maiaBaseUrl: pathToFileURL(`${maiaDir}${path.sep}`).toString(),
  };
};

const fileExists = async (filePath) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const toNodeStream = (body) => {
  if (!body) return null;
  if (typeof body.pipe === 'function') return body;
  if (typeof Readable.fromWeb === 'function') return Readable.fromWeb(body);
  return null;
};

const downloadFile = async ({ url, destPath, onProgress }) => {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : null;
  const tempPath = `${destPath}.tmp`;
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  let receivedBytes = 0;
  const progressStream = new Transform({
    transform(chunk, encoding, callback) {
      receivedBytes += chunk.length;
      onProgress(receivedBytes, totalBytes);
      callback(null, chunk);
    },
  });

  const nodeStream = toNodeStream(response.body);
  if (!nodeStream) {
    throw new Error(`Unable to stream download for ${url}`);
  }

  try {
    await pipeline(nodeStream, progressStream, fs.createWriteStream(tempPath));
    await fs.promises.rename(tempPath, destPath);
    return { receivedBytes, totalBytes };
  } catch (err) {
    try {
      await fs.promises.unlink(tempPath);
    } catch {}
    throw err;
  }
};

const sendDownloadEvent = (webContentsSet, payload) => {
  for (const wc of webContentsSet) {
    if (wc.isDestroyed()) continue;
    wc.send('engine:download-event', payload);
  }
};

let activeDownload = null;

const ensureEngineAssets = async (webContentsSet) => {
  const baseDir = getVibeChessDir();
  await fs.promises.mkdir(baseDir, { recursive: true });
  const assetsWithPaths = ENGINE_ASSETS.map((asset) => ({
    ...asset,
    destPath: path.join(baseDir, asset.dir, asset.file),
  }));

  const missingAssets = [];
  for (const asset of assetsWithPaths) {
    if (!(await fileExists(asset.destPath))) {
      missingAssets.push(asset);
    }
  }

  if (missingAssets.length === 0) {
    return { assets: buildEnginePaths(baseDir), downloaded: false };
  }

  sendDownloadEvent(webContentsSet, {
    type: 'start',
    totalFiles: missingAssets.length,
    totalBytes: null,
  });

  let overallDownloaded = 0;
  let overallTotal = 0;
  let overallTotalKnown = true;

  for (let index = 0; index < missingAssets.length; index += 1) {
    const asset = missingAssets[index];
    const url = new URL(asset.remotePath, asset.baseUrl).toString();
    const fileIndex = index + 1;
    let fileTotalBytes = null;

    const updateProgress = (receivedBytes, totalBytes) => {
      if (totalBytes === null && overallTotalKnown) {
        overallTotalKnown = false;
        overallTotal = null;
      }
      if (totalBytes !== null && fileTotalBytes === null) {
        fileTotalBytes = totalBytes;
        if (overallTotalKnown) {
          overallTotal += totalBytes;
        }
      }

      const overallProgress = overallDownloaded + receivedBytes;
      sendDownloadEvent(webContentsSet, {
        type: 'progress',
        file: {
          id: asset.id,
          label: asset.label,
          index: fileIndex,
          totalFiles: missingAssets.length,
          receivedBytes,
          totalBytes,
        },
        overall: {
          receivedBytes: overallProgress,
          totalBytes: overallTotalKnown ? overallTotal : null,
        },
      });
    };

    const result = await downloadFile({
      url,
      destPath: asset.destPath,
      onProgress: updateProgress,
    });

    overallDownloaded += result.receivedBytes;
  }

  sendDownloadEvent(webContentsSet, { type: 'done' });
  return { assets: buildEnginePaths(baseDir), downloaded: true };
};

ipcMain.handle('engine:ensure-assets', async (event) => {
  if (activeDownload) {
    activeDownload.webContents.add(event.sender);
    return activeDownload.promise;
  }

  const webContentsSet = new Set([event.sender]);
  const promise = ensureEngineAssets(webContentsSet).catch((err) => {
    sendDownloadEvent(webContentsSet, {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  });
  activeDownload = { promise, webContents: webContentsSet };

  try {
    return await promise;
  } finally {
    activeDownload = null;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, isDev ? '../public/icon.png' : '../dist/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Easier access to workers if needed; otherwise set true with preload
      webSecurity: false // Sometimes needed to load local resources in dev
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // In production, load the index.html from the Vite build
    // main.js is in electron/ and the build lives in dist/, so step up one level
    win.loadFile(path.join(__dirname, '../dist/index.html'));
    
    // Enable DevTools in production for debugging
    // win.webContents.openDevTools(); 
  }

  // Keyboard shortcut to open DevTools (Cmd+Option+I on Mac, Ctrl+Shift+I on Windows/Linux)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i' || input.meta && input.alt && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {};
    responseHeaders['Cross-Origin-Opener-Policy'] = ['same-origin'];
    responseHeaders['Cross-Origin-Embedder-Policy'] = ['require-corp'];
    callback({ responseHeaders });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
