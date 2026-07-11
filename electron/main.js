const path = require("path");
const { app, BrowserWindow } = require("electron");
const { startServer } = require("../server");

const APP_ID = "com.goonruntongue.lanfileshare.electron";
let mainWindow = null;
let serverInstance = null;
let quitting = false;

app.setAppUserModelId(APP_ID);

function isLanUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:") return false;
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const match = /^172\.(\d+)\./.exec(host);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch {
    return false;
  }
}

async function createMainWindow() {
  if (!serverInstance) {
    const dataDirectory = app.isPackaged
      ? process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
      : path.join(__dirname, "..");
    serverInstance = await startServer({
      openBrowser: false,
      autoShutdown: false,
      peerDiscovery: true,
      dataDirectory,
    });
  }

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    title: "LAN File Share Electron",
    icon: path.join(__dirname, "..", "assets", "app.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isLanUrl(url)) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(serverInstance.localUrl);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(createMainWindow).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on("window-all-closed", async () => {
  if (quitting) return;
  quitting = true;
  try {
    await serverInstance?.close();
  } finally {
    app.quit();
  }
});
