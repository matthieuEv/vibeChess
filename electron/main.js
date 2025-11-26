import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
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
