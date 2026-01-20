import { app, BrowserWindow, ipcMain, session, protocol } from 'electron';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';
import http from 'http';
import { lookup } from 'mime-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';
const userDataProfile = process.env.VIBECHESS_PROFILE ?? '';
const safeProfile = userDataProfile
  ? userDataProfile.replace(/[^a-zA-Z0-9_-]/g, '')
  : '';
if (safeProfile) {
  app.setPath('userData', path.join(app.getPath('userData'), safeProfile));
}
const normalizeBaseUrl = (value) => (value.endsWith('/') ? value : `${value}/`);
const LEGACY_ENGINE_DOWNLOAD_BASE_URL =
  process.env.VIBE_ENGINE_DOWNLOAD_BASE_URL || process.env.VITE_ENGINE_DOWNLOAD_BASE_URL;
const STOCKFISH_DOWNLOAD_BASE_URL = normalizeBaseUrl(
  process.env.VIBE_STOCKFISH_DOWNLOAD_BASE_URL ||
    process.env.STOCKFISH_DOWNLOAD_BASE_URL ||
    'https://unpkg.com/stockfish@17.1.0/src/',
);
const ZEROFISH_DOWNLOAD_BASE_URL = normalizeBaseUrl(
  process.env.VIBE_ZEROFISH_DOWNLOAD_BASE_URL ||
    process.env.ZEROFISH_DOWNLOAD_BASE_URL ||
    'https://unpkg.com/zerofish@0.0.36/dist/',
);
const MAIA_DOWNLOAD_BASE_URL = normalizeBaseUrl(
  process.env.VIBE_MAIA_DOWNLOAD_BASE_URL ||
    process.env.MAIA_DOWNLOAD_BASE_URL ||
    'https://github.com/CSSLab/maia-chess/releases/download/v1.0/',
);
const VIBECHESS_DIR_NAME = '.vibeChess';
const ENGINE_DIR_NAME = 'engine';
const MAIA_DIR_NAME = 'maia';
const CONFIG_FILE_NAME = safeProfile ? `config.${safeProfile}.json` : 'config.json';
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
const getConfigPath = () => path.join(getVibeChessDir(), CONFIG_FILE_NAME);

const buildEnginePaths = (baseDir, serverPort) => {
  if (serverPort) {
    // Use HTTP URLs when server is running (production)
    const baseUrl = `http://127.0.0.1:${serverPort}/local-engines`;
    return {
      stockfishJsUrl: `${baseUrl}/engine/${STOCKFISH_JS}`,
      stockfishWasmUrl: `${baseUrl}/engine/${STOCKFISH_WASM}`,
      zerofishJsUrl: `${baseUrl}/engine/${ZEROFISH_JS}`,
      zerofishWasmUrl: `${baseUrl}/engine/${ZEROFISH_WASM}`,
      maiaBaseUrl: `${baseUrl}/maia/`,
    };
  }
  // Use file:// URLs in development
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

const readConfigFile = async () => {
  const configPath = getConfigPath();
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const writeConfigFile = async (payload) => {
  const configPath = getConfigPath();
  await fs.promises.mkdir(getVibeChessDir(), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  const json = JSON.stringify(payload ?? {}, null, 2);
  await fs.promises.writeFile(tempPath, json, 'utf8');
  await fs.promises.rename(tempPath, configPath);
  return true;
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

ipcMain.handle('config:read', async () => {
  return readConfigFile();
});

ipcMain.handle('config:write', async (_event, payload) => {
  return writeConfigFile(payload);
});

const ensureEngineAssets = async (webContentsSet, serverPort) => {
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
    return { assets: buildEnginePaths(baseDir, serverPort), downloaded: false };
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
  return { assets: buildEnginePaths(baseDir, serverPort), downloaded: true };
};

ipcMain.handle('engine:ensure-assets', async (event) => {
  if (activeDownload) {
    activeDownload.webContents.add(event.sender);
    return activeDownload.promise;
  }

  const webContentsSet = new Set([event.sender]);
  const serverPort = localServer ? localServer.port : null;
  const promise = ensureEngineAssets(webContentsSet, serverPort).catch((err) => {
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

let localServer = null;

const startLocalServer = () => {
  return new Promise((resolve, reject) => {
    const distPath = path.join(__dirname, '../dist');
    const vibeChessDir = getVibeChessDir();
    
    const server = http.createServer((req, res) => {
      // Parse URL and remove query string
      const url = new URL(req.url, 'http://localhost');
      let filePath;
      let basePath;
      
      // Serve engine files from ~/.vibeChess/
      if (url.pathname.startsWith('/local-engines/')) {
        const relativePath = url.pathname.slice('/local-engines/'.length);
        filePath = path.join(vibeChessDir, relativePath);
        basePath = vibeChessDir;
      } else {
        // Serve app files from dist/
        filePath = path.join(distPath, url.pathname);
        basePath = distPath;
        
        // Default to index.html
        if (filePath.endsWith('/') || !path.extname(filePath)) {
          filePath = path.join(filePath, 'index.html');
        }
      }
      
      // Security: prevent directory traversal
      const normalizedPath = path.normalize(filePath);
      if (!normalizedPath.startsWith(basePath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      
      fs.readFile(normalizedPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        
        const mimeType = lookup(normalizedPath) || 'application/octet-stream';
        
        // Set headers for SharedArrayBuffer support
        res.writeHead(200, {
          'Content-Type': mimeType,
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    });
    
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      localServer = { server, port };
      resolve(port);
    });
    
    server.on('error', reject);
  });
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, isDev ? '../public/icon.png' : '../dist/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // Use local HTTP server for proper COOP/COEP headers
    if (localServer) {
      win.loadURL(`http://127.0.0.1:${localServer.port}/`);
    }
  }

  // Keyboard shortcut to open DevTools (Cmd+Option+I on Mac, Ctrl+Shift+I on Windows/Linux)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i' || input.meta && input.alt && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

app.whenReady().then(async () => {
  // Start local server in production mode
  if (!isDev) {
    try {
      await startLocalServer();
    } catch (err) {
      console.error('Failed to start local server:', err);
      app.quit();
      return;
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (localServer) {
    localServer.server.close();
    localServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
