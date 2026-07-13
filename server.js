const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const dgram = require("dgram");
const { spawn } = require("child_process");
let sea = null;
try {
  sea = require("node:sea");
} catch {}

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const IS_SEA = Boolean(sea && sea.isSea());
let DATA_DIR = IS_SEA ? path.dirname(process.execPath) : ROOT;
let SHARE_DIR = path.join(DATA_DIR, "shared");
let actualPort = PORT;
let peerService = null;
let ownerToken = crypto.randomBytes(32).toString("hex");
let metadataWrite = Promise.resolve();
const unlockTokens = new Map();
const failedUnlocks = new Map();
const METADATA_FILE = ".lan-file-share-metadata.json";
const PASSWORD_ITERATIONS = 210000;
const clients = new Map();
const CLIENT_TIMEOUT_MS = 45000;
const SHUTDOWN_GRACE_MS = 15000;
let hasConnectedClient = false;
let noClientSince = null;
try {
  process.chdir(os.tmpdir());
} catch {}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}
function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}
function sanitize(name) {
  return (
    path
      .basename(String(name || "file").replace(/\0/g, ""))
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim() || "file"
  );
}
function isReservedName(name) {
  const clean = sanitize(name);
  return clean === METADATA_FILE || clean.startsWith(`${METADATA_FILE}.tmp-`) || clean.startsWith(".upload-");
}
function safePath(name) {
  if (isReservedName(name)) return null;
  const target = path.resolve(SHARE_DIR, sanitize(name));
  return target.startsWith(path.resolve(SHARE_DIR) + path.sep) ? target : null;
}
function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => {
    const i = part.indexOf("=");
    return i < 0 ? [part.trim(), ""] : [part.slice(0, i).trim(), part.slice(i + 1)];
  }).filter(([key]) => key));
}
function ownerCookieName() { return `lan_share_owner_${actualPort}`; }
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function isOwnerRequest(req) {
  return safeEqual(parseCookies(req)[ownerCookieName()], ownerToken);
}
async function readMetadata() {
  try {
    const data = JSON.parse(await fsp.readFile(path.join(SHARE_DIR, METADATA_FILE), "utf8"));
    return data && data.version === 1 && data.files ? data : { version: 1, files: {} };
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("保護情報を読み込めませんでした:", error.message);
    return { version: 1, files: {} };
  }
}
function updateMetadata(mutator) {
  metadataWrite = metadataWrite.then(async () => {
    const data = await readMetadata();
    await mutator(data.files);
    const target = path.join(SHARE_DIR, METADATA_FILE);
    const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    await fsp.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fsp.rename(temp, target);
  });
  return metadataWrite;
}
function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex");
  return { salt, hash, iterations: PASSWORD_ITERATIONS, createdAt: new Date().toISOString() };
}
function verifyPassword(password, record) {
  try {
    const actual = crypto.pbkdf2Sync(password, record.salt, record.iterations, 32, "sha256").toString("hex");
    return safeEqual(actual, record.hash);
  } catch { return false; }
}
function readJson(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (chunk) => { size += chunk.length; if (size > maxBytes) reject(new Error("入力が大きすぎます。")); else chunks.push(chunk); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("入力が不正です。")); } });
    req.on("error", reject);
  });
}
function formatSize(bytes) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes,
    i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function addresses() {
  const all = Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (a) =>
        a &&
        a.family === "IPv4" &&
        !a.internal &&
        a.address !== "0.0.0.0" &&
        !a.address.startsWith("169.254."),
    )
    .map((a) => a.address);
  const privateLan = (a) =>
    /^10\./.test(a) ||
    /^192\.168\./.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  return [...new Set(all)].sort(
    (a, b) => Number(privateLan(b)) - Number(privateLan(a)),
  );
}
function createPeerDiscovery(servicePort) {
  const multicastAddress = "239.255.42.99";
  const discoveryPort = Number(process.env.LAN_SHARE_DISCOVERY_PORT || 41234);
  const id = `${os.hostname()}-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const machineName = String(
    process.env.LAN_SHARE_MACHINE_NAME || os.hostname(),
  ).slice(0, 100);
  const peers = new Map();
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let ready = false;
  const announcement = Buffer.from(
    JSON.stringify({
      app: "lan-file-share-electron",
      version: 1,
      id,
      name: machineName,
      port: servicePort,
    }),
  );
  const announce = () => {
    if (!ready) return;
    socket.send(announcement, discoveryPort, multicastAddress, (error) => {
      if (error) console.warn("LAN内PCの通知に失敗しました:", error.message);
    });
  };
  socket.on("message", (message, remote) => {
    try {
      const peer = JSON.parse(message.toString("utf8"));
      if (
        peer.app !== "lan-file-share-electron" ||
        peer.version !== 1 ||
        peer.id === id ||
        typeof peer.name !== "string" ||
        !Number.isInteger(peer.port) ||
        peer.port < 1 ||
        peer.port > 65535
      )
        return;
      peers.set(peer.id, {
        id: peer.id,
        name: peer.name.slice(0, 100),
        address: remote.address,
        port: peer.port,
        url: `http://${remote.address}:${peer.port}`,
        lastSeen: Date.now(),
      });
    } catch {}
  });
  socket.on("error", (error) =>
    console.warn("LAN内PCの検出に失敗しました:", error.message),
  );
  socket.bind(discoveryPort, "0.0.0.0", () => {
    try {
      socket.addMembership(multicastAddress);
      socket.setMulticastTTL(1);
      ready = true;
      announce();
    } catch (error) {
      console.warn("LAN内PCの検出を開始できませんでした:", error.message);
    }
  });
  const announceTimer = setInterval(announce, 2000);
  announceTimer.unref();
  socket.unref();
  return {
    id,
    name: machineName,
    getPeers() {
      const now = Date.now();
      for (const [peerId, peer] of peers) {
        if (now - peer.lastSeen > 8000) peers.delete(peerId);
      }
      return [...peers.values()]
        .map(({ lastSeen, ...peer }) => peer)
        .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    },
    close() {
      clearInterval(announceTimer);
      try {
        socket.close();
      } catch {}
    },
  };
}
async function uniquePath(name) {
  const p = path.parse(name);
  let n = sanitize(name),
    target = path.join(SHARE_DIR, n),
    i = 1;
  while (true) {
    try {
      await fsp.access(target);
      n = sanitize(`${p.name} (${i++})${p.ext}`);
      target = path.join(SHARE_DIR, n);
    } catch {
      return { name: n, target };
    }
  }
}

async function listFiles() {
  await fsp.mkdir(SHARE_DIR, { recursive: true });
  const entries = await fsp.readdir(SHARE_DIR, { withFileTypes: true });
  const files = [];
  const metadata = await readMetadata();
  for (const entry of entries) {
    if (!entry.isFile() || isReservedName(entry.name)) continue;
    const filePath = path.join(SHARE_DIR, entry.name);
    try {
      const stat = await fsp.stat(filePath);
      if (stat.isFile())
        files.push({
          name: entry.name,
          path: filePath,
          size: stat.size,
          sizeLabel: formatSize(stat.size),
          modifiedAt: stat.mtime.toISOString(),
          protected: Boolean(metadata.files[entry.name]),
        });
    } catch (error) {
      if (error.code !== "ENOENT")
        console.warn(`一覧取得をスキップ: ${filePath}`, error.message);
    }
  }
  return files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ownerQuery = url.searchParams.get("owner");
  const ownerHeaders = safeEqual(ownerQuery, ownerToken)
    ? { "set-cookie": `${ownerCookieName()}=${ownerToken}; HttpOnly; SameSite=Strict; Path=/` }
    : {};
  const requested = decodeURIComponent(
    url.pathname === "/" ? "/index.html" : url.pathname,
  );
  if (IS_SEA) {
    try {
      const key = requested.replace(/^\/+/, "");
      const asset = Buffer.from(sea.getAsset(key));
      res.writeHead(200, { ...ownerHeaders,
        "content-type": MIME[path.extname(key)] || "application/octet-stream",
        "content-length": asset.length,
      });
      res.end(asset);
    } catch {
      sendError(res, 404, "Not found");
    }
    return;
  }
  const target = path.resolve(PUBLIC_DIR, "." + requested);
  if (!target.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
    sendError(res, 403, "Forbidden");
    return;
  }
  try {
    const stat = await fsp.stat(target);
    res.writeHead(200, { ...ownerHeaders,
      "content-type": MIME[path.extname(target)] || "application/octet-stream",
      "content-length": stat.size,
    });
    fs.createReadStream(target).pipe(res);
  } catch {
    sendError(res, 404, "Not found");
  }
}
async function upload(req, res) {
  const name = sanitize(
    decodeURIComponent(String(req.headers["x-file-name"] || "")),
  );
  if (isReservedName(name)) return sendError(res, 400, "このファイル名は使用できません。");
  let password = "";
  try { password = decodeURIComponent(String(req.headers["x-file-password"] || "")); } catch { return sendError(res, 400, "パスワードが不正です。"); }
  if (password.length > 200) return sendError(res, 400, "パスワードは200文字以内にしてください。");
  await fsp.mkdir(SHARE_DIR, { recursive: true });
  const temp = path.join(
    SHARE_DIR,
    `.upload-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`,
  );
  const dest = await uniquePath(name);
  const out = fs.createWriteStream(temp);
  let size = 0;
  req.on("data", (c) => (size += c.length));
  req.pipe(out);
  out.on("error", async () => {
    await fsp.rm(temp, { force: true });
    if (!res.headersSent) sendError(res, 500, "保存できませんでした。");
  });
  out.on("finish", async () => {
    try {
      await fsp.rename(temp, dest.target);
      if (password) {
        try { await updateMetadata((files) => { files[dest.name] = passwordRecord(password); }); }
        catch (error) { await fsp.rm(dest.target, { force: true }); throw error; }
      }
      sendJson(res, 201, {
        name: dest.name,
        path: dest.target,
        size,
        sizeLabel: formatSize(size),
      });
    } catch {
      await fsp.rm(temp, { force: true });
      if (!res.headersSent) sendError(res, 500, "保存できませんでした。");
    }
  });
}
async function servePreview(req, res, name) {
  const target = safePath(name);
  if (!target) return sendError(res, 403, "Forbidden");
  const metadata = await readMetadata();
  if (metadata.files[sanitize(name)]) return sendError(res, 403, "パスワード保護されたファイルはプレビューできません。");
  try {
    const stat = await fsp.stat(target);
    const size = stat.size;
    const headers = {
      "content-type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    };
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, { ...headers, "content-length": size });
      return fs.createReadStream(target).pipe(res);
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return sendError(res, 416, "Invalid range");
    let start;
    let end;
    if (match[1] === "") {
      const suffixLength = Number(match[2]);
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...headers,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${size}`,
    });
    return fs.createReadStream(target, { start, end }).pipe(res);
  } catch {
    return sendError(res, 404, "File not found");
  }
}
async function revealFile(res, name) {
  const target = safePath(name);
  if (!target) return sendError(res, 403, "Forbidden");
  try {
    const stat = await fsp.stat(target);
    if (!stat.isFile()) return sendError(res, 404, "File not found");
    if (process.platform !== "win32")
      return sendError(res, 501, "This feature is available on Windows only");
    if (process.env.OPEN_EXPLORER !== "0") {
      const explorerPath = path.join(
        process.env.SystemRoot || "C:\\Windows",
        "explorer.exe",
      );
      try {
        const child = spawn(explorerPath, ["/n,", "/select,", target], {
          detached: true,
          stdio: "ignore",
        });
        await new Promise((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
      } catch (error) {
        console.error("Explorerを起動できませんでした:", error.message);
        return sendError(res, 500, "エクスプローラーを起動できませんでした。");
      }
    }
    return sendJson(res, 200, { ok: true });
  } catch {
    return sendError(res, 404, "File not found");
  }
}
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "POST" && url.pathname === "/api/heartbeat") {
      const id = String(url.searchParams.get("id") || "").slice(0, 100);
      if (id) {
        clients.set(id, Date.now());
        hasConnectedClient = true;
        noClientSince = null;
      }
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/disconnect") {
      clients.delete(String(url.searchParams.get("id") || "").slice(0, 100));
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/files")
      return sendJson(res, 200, {
        files: await listFiles(),
        sharedFolder: SHARE_DIR,
        owner: isOwnerRequest(req),
      });
    if (req.method === "GET" && url.pathname === "/api/info")
      return sendJson(res, 200, {
        port: actualPort,
        machineName: process.env.LAN_SHARE_MACHINE_NAME || os.hostname(),
        networkUrls: addresses().map((a) => `http://${a}:${actualPort}`),
        sharedFolder: SHARE_DIR,
      });
    if (req.method === "GET" && url.pathname === "/api/peers")
      return sendJson(res, 200, {
        enabled: Boolean(peerService),
        self: peerService
          ? { id: peerService.id, name: peerService.name, port: actualPort }
          : null,
        peers: peerService ? peerService.getPeers() : [],
      });
    if (req.method === "POST" && url.pathname === "/api/upload")
      return await upload(req, res);
    if (req.method === "GET" && url.pathname.startsWith("/preview/"))
      return await servePreview(
        req,
        res,
        decodeURIComponent(url.pathname.slice(9)),
      );
    if (req.method === "POST" && url.pathname.startsWith("/api/reveal/"))
      if (!isOwnerRequest(req)) return sendError(res, 403, "このPC上の所有者だけがファイルの場所を開けます。");
    if (req.method === "POST" && url.pathname.startsWith("/api/reveal/"))
      return await revealFile(
        res,
        decodeURIComponent(url.pathname.slice(12)),
      );
    if (req.method === "POST" && url.pathname.startsWith("/api/files/") && url.pathname.endsWith("/unlock")) {
      const encoded = url.pathname.slice(11, -7);
      const name = sanitize(decodeURIComponent(encoded));
      const target = safePath(name);
      if (!target) return sendError(res, 403, "Forbidden");
      const metadata = await readMetadata();
      const record = metadata.files[name];
      if (!record) return sendJson(res, 200, { token: null });
      const key = `${req.socket.remoteAddress || "unknown"}:${name}`;
      const now = Date.now();
      const attempts = (failedUnlocks.get(key) || []).filter((time) => now - time < 60000);
      if (attempts.length >= 5) return sendError(res, 429, "試行回数が多すぎます。1分後にお試しください。");
      const body = await readJson(req);
      if (!verifyPassword(String(body.password || ""), record)) {
        attempts.push(now); failedUnlocks.set(key, attempts);
        return sendError(res, 401, "パスワードが違います。");
      }
      failedUnlocks.delete(key);
      const token = crypto.randomBytes(32).toString("base64url");
      unlockTokens.set(token, { name, expires: now + 60000 });
      return sendJson(res, 200, { token });
    }
    if (req.method === "GET" && url.pathname.startsWith("/files/")) {
      const name = sanitize(decodeURIComponent(url.pathname.slice(7)));
      const target = safePath(name);
      if (!target) return sendError(res, 403, "Forbidden");
      try {
        const metadata = await readMetadata();
        if (metadata.files[name]) {
          const token = String(url.searchParams.get("token") || "");
          const grant = unlockTokens.get(token);
          unlockTokens.delete(token);
          if (!grant || grant.name !== name || grant.expires < Date.now()) return sendError(res, 401, "ダウンロードにはパスワードが必要です。");
        }
        const stat = await fsp.stat(target);
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": stat.size,
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
        });
        return fs.createReadStream(target).pipe(res);
      } catch {
        return sendError(res, 404, "File not found");
      }
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/files/")) {
      const target = safePath(decodeURIComponent(url.pathname.slice(11)));
      if (!target) return sendError(res, 403, "Forbidden");
      await fsp.rm(target, { force: true });
      const name = path.basename(target);
      await updateMetadata((files) => { delete files[name]; });
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET") return await serveStatic(req, res);
    sendError(res, 405, "Method not allowed");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendError(res, 500, "Server error");
  }
}
function openBrowser(url) {
  if (process.env.OPEN_BROWSER === "0") return;
  const child = spawn("cmd", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}
async function startServer(options = {}) {
  const basePort = Number(options.port || PORT);
  if (options.dataDirectory) {
    DATA_DIR = path.resolve(options.dataDirectory);
    SHARE_DIR = path.join(DATA_DIR, "shared");
  }
  ownerToken = crypto.randomBytes(32).toString("hex");
  await fsp.mkdir(SHARE_DIR, { recursive: true });
  const server = http.createServer(route);
  for (let i = 0; i < 20; i++) {
    try {
      await new Promise((ok, ng) => {
        server.once("error", ng);
        server.listen(basePort + i, "0.0.0.0", () => {
          server.removeListener("error", ng);
          ok();
        });
      });
      actualPort = basePort + i;
      break;
    } catch (e) {
      if (e.code !== "EADDRINUSE" || i === 19) throw e;
    }
  }
  const lan = addresses(),
    url = lan.length
      ? `http://${lan[0]}:${actualPort}`
      : `http://localhost:${actualPort}`;
  const ownerUrl = `${url}/?owner=${encodeURIComponent(ownerToken)}`;
  console.log(`LAN File Share: ${url}`);
  console.log(`Shared folder: ${SHARE_DIR}`);
  if (options.peerDiscovery) peerService = createPeerDiscovery(actualPort);
  const maintenanceTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, seenAt] of clients) {
      if (now - seenAt > CLIENT_TIMEOUT_MS) clients.delete(id);
    }
    if (options.autoShutdown !== false && hasConnectedClient && clients.size === 0) {
      noClientSince ??= now;
      if (now - noClientSince >= SHUTDOWN_GRACE_MS) {
        console.log("ブラウザ接続が終了したため、サーバーを停止します。");
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
      }
    } else {
      noClientSince = null;
    }
  }, 2000).unref();
  if (options.openBrowser !== false) openBrowser(ownerUrl);
  return {
    server,
    port: actualPort,
    url,
    localUrl: `http://127.0.0.1:${actualPort}`,
    ownerUrl,
    sharedFolder: SHARE_DIR,
    close() {
      clearInterval(maintenanceTimer);
      peerService?.close();
      peerService = null;
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
module.exports = { startServer };

if (require.main === module || IS_SEA) {
  startServer({
    peerDiscovery: process.env.ENABLE_PEER_DISCOVERY === "1",
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
