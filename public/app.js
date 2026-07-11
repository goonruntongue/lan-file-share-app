const q = (s) => document.querySelector(s),
  fileInput = q("#fileInput"),
  fileList = q("#fileList"),
  fileCount = q("#fileCount"),
  progress = q("#progressArea"),
  template = q("#fileTemplate"),
  selectAll = q("#selectAll"),
  bulkDownload = q("#bulkDownload"),
  bulkDelete = q("#bulkDelete");
let currentFiles = [];
let renderedFilesSignature = "";
const sortOrder = document.createElement("select");
const sortOptions = [
  ["newest", "更新日時：新しい順"],
  ["oldest", "更新日時：古い順"],
  ["name-asc", "名前：昇順"],
  ["name-desc", "名前：降順"],
  ["size-desc", "サイズ：大きい順"],
  ["size-asc", "サイズ：小さい順"],
];
for (const [value, label] of sortOptions) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  sortOrder.append(option);
}
sortOrder.id = "sortOrder";
sortOrder.setAttribute("aria-label", "ファイルの並び順");
const sortLabel = document.createElement("label");
sortLabel.className = "sort-control";
sortLabel.append("並び替え ", sortOrder);
const listTools = document.createElement("div");
listTools.className = "list-tools";
fileCount.replaceWith(listTools);
listTools.append(fileCount, sortLabel);
const peerPanel = document.createElement("div");
peerPanel.className = "peer-panel";
peerPanel.hidden = true;
const peerHeading = document.createElement("b");
peerHeading.textContent = "同一LANのPC";
const peerHint = document.createElement("span");
peerHint.textContent = " Electron版を起動したPCを自動検出します";
const peerList = document.createElement("div");
peerList.className = "peer-list";
peerPanel.append(peerHeading, peerHint, peerList);
q(".info").prepend(peerPanel);
let peerSignature = "";
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const videoExtensions = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const audioExtensions = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
let activeAudio = null;
function extension(name) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}
function previewUrl(name) {
  return `/preview/${encodeURIComponent(name)}`;
}
function stopActiveAudio() {
  if (!activeAudio) return;
  activeAudio.audio.pause();
  activeAudio.audio.currentTime = 0;
  activeAudio.button.textContent = "▶";
  activeAudio.button.title = "再生";
  activeAudio = null;
}
function addPreview(container, file) {
  const ext = extension(file.name);
  const url = previewUrl(file.name);
  if (imageExtensions.has(ext)) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${file.name} のサムネイル`;
    image.loading = "lazy";
    container.append(image);
    return;
  }
  if (videoExtensions.has(ext)) {
    const video = document.createElement("video");
    const segmentSeconds = 5;
    let previewing = false;
    let segmentIndex = 0;
    let duration = 0;
    let segmentStarts = [0];
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.title = "ポイントして20秒プレビュー（先頭・25%・50%・75%を各5秒）";
    video.addEventListener("loadedmetadata", () => {
      duration = Number.isFinite(video.duration) ? video.duration : 0;
      segmentStarts = [0, duration * 0.25, duration * 0.5, duration * 0.75];
    }, { once: true });
    const advanceSegment = () => {
      segmentIndex += 1;
      if (segmentIndex >= segmentStarts.length) {
        previewing = false;
        video.pause();
        return;
      }
      video.currentTime = segmentStarts[segmentIndex];
      video.play().catch(() => {});
    };
    video.ontimeupdate = () => {
      if (!previewing || !duration) return;
      const segmentEnd = Math.min(
        segmentStarts[segmentIndex] + segmentSeconds,
        duration,
      );
      if (video.currentTime >= segmentEnd) advanceSegment();
    };
    video.onended = () => {
      if (previewing && video.currentTime >= duration - 0.1) advanceSegment();
    };
    container.onmouseenter = () => {
      previewing = true;
      segmentIndex = 0;
      video.currentTime = 0;
      video.play().catch(() => {});
    };
    container.onmouseleave = () => {
      previewing = false;
      video.pause();
      video.currentTime = 0;
    };
    container.append(video);
    return;
  }
  if (audioExtensions.has(ext)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "media-audio";
    button.textContent = "▶";
    button.title = "再生";
    button.setAttribute("aria-label", `${file.name} を再生`);
    button.onclick = () => {
      if (activeAudio?.button === button) return stopActiveAudio();
      stopActiveAudio();
      const audio = new Audio(url);
      activeAudio = { audio, button };
      button.textContent = "■";
      button.title = "停止";
      audio.onended = stopActiveAudio;
      audio.onerror = () => {
        stopActiveAudio();
        status("音声を再生できませんでした。");
      };
      audio.play().catch(() => {
        stopActiveAudio();
        status("音声を再生できませんでした。");
      });
    };
    container.append(button);
    return;
  }
  container.textContent = "□";
}
function createClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
const clientId = sessionStorage.getItem("lanShareClientId") || createClientId();
sessionStorage.setItem("lanShareClientId", clientId);
function heartbeat() {
  return fetch(`/api/heartbeat?id=${encodeURIComponent(clientId)}`, {
    method: "POST",
    cache: "no-store",
    keepalive: true,
  }).catch(() => {});
}
function status(text) {
  const n = document.createElement("div");
  n.className = "status";
  n.textContent = text;
  progress.prepend(n);
  setTimeout(() => n.remove(), 6000);
}
async function json(url, opt) {
  const r = await fetch(url, { cache: "no-store", ...opt });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "通信に失敗しました。");
  return d;
}
function date(v) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v));
}
function selected() {
  return [...document.querySelectorAll(".select-file:checked")].map(
    (n) => n.dataset.name,
  );
}
function updateSelection() {
  const names = selected(),
    total = currentFiles.length;
  selectAll.checked = total > 0 && names.length === total;
  selectAll.indeterminate = names.length > 0 && names.length < total;
  q("#selectedCount").textContent = `${names.length} 件選択中`;
  bulkDownload.disabled = bulkDelete.disabled = names.length === 0;
}
function sortedFiles(files) {
  const result = [...files];
  const byName = (a, b) =>
    a.name.localeCompare(b.name, "ja", { numeric: true, sensitivity: "base" });
  switch (sortOrder.value) {
    case "oldest":
      return result.sort((a, b) => new Date(a.modifiedAt) - new Date(b.modifiedAt));
    case "name-asc":
      return result.sort(byName);
    case "name-desc":
      return result.sort((a, b) => byName(b, a));
    case "size-desc":
      return result.sort((a, b) => b.size - a.size || byName(a, b));
    case "size-asc":
      return result.sort((a, b) => a.size - b.size || byName(a, b));
    default:
      return result.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  }
}
async function loadFiles() {
  const selectedNames = new Set(selected());
  const { files, sharedFolder } = await json(`/api/files?t=${Date.now()}`);
  currentFiles = files;
  q("#sharedFolder").textContent = sharedFolder;
  fileCount.textContent = `合計 ${files.length} 件`;
  const signature = JSON.stringify(
    files.map(({ name, size, modifiedAt }) => [name, size, modifiedAt]),
  );
  if (signature === renderedFilesSignature) return updateSelection();
  renderedFilesSignature = signature;
  stopActiveAudio();
  fileList.textContent = "";
  if (!files.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "まだ共有ファイルはありません。";
    fileList.append(e);
    return updateSelection();
  }
  for (const f of sortedFiles(files)) {
    const row = template.content.firstElementChild.cloneNode(true),
      checkbox = row.querySelector(".select-file");
    checkbox.dataset.name = f.name;
    checkbox.setAttribute("aria-label", `${f.name} を選択`);
    checkbox.checked = selectedNames.has(f.name);
    checkbox.onchange = updateSelection;
    addPreview(row.querySelector(".media-preview"), f);
    row.querySelector("h3").textContent = f.name;
    row.querySelector(".details").textContent =
      `${f.sizeLabel} ・ ${date(f.modifiedAt)}`;
    row.querySelector(".path").textContent = f.path;
    const a = row.querySelector("a");
    a.href = `/files/${encodeURIComponent(f.name)}`;
    a.download = f.name;
    row.querySelector(".reveal-file").onclick = async () => {
      try {
        await json(`/api/reveal/${encodeURIComponent(f.name)}`, {
          method: "POST",
        });
        status(`${f.name} の場所を開きました。`);
      } catch (e) {
        status(e.message);
      }
    };
    row.querySelector(".delete-file").onclick = async () => {
      if (confirm(`${f.name} を削除しますか？`)) {
        await json(`/api/files/${encodeURIComponent(f.name)}`, {
          method: "DELETE",
        });
        await loadFiles();
      }
    };
    fileList.append(row);
  }
  updateSelection();
}
async function info() {
  const d = await json("/api/info"),
    url = d.networkUrls[0];
  q("#networkUrls").textContent =
    d.networkUrls.join(" / ") || "LAN用IPアドレスなし";
  q("#sharedFolder").textContent = d.sharedFolder;
  if (url) {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    q("#qrCode").innerHTML = qr.createSvgTag({
      cellSize: 5,
      margin: 2,
      scalable: true,
    });
    q("#qrUrl").textContent = url;
  } else {
    q("#qrCode").textContent = "LAN用IPアドレスを取得できませんでした。";
  }
}
async function loadPeers() {
  const data = await json(`/api/peers?t=${Date.now()}`);
  peerPanel.hidden = !data.enabled;
  if (!data.enabled) return;
  const signature = JSON.stringify([data.self, data.peers]);
  if (signature === peerSignature) return;
  peerSignature = signature;
  peerList.textContent = "";
  const current = document.createElement("button");
  current.type = "button";
  current.className = "peer-button current";
  current.textContent = `${data.self.name}（表示中）`;
  current.disabled = true;
  peerList.append(current);
  for (const peer of data.peers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "peer-button";
    button.textContent = peer.name;
    button.title = `${peer.name} の共有ファイルを開く`;
    button.onclick = () => location.assign(peer.url);
    peerList.append(button);
  }
  if (!data.peers.length) {
    const waiting = document.createElement("span");
    waiting.className = "peer-waiting";
    waiting.textContent = "ほかのPCを検索中…";
    peerList.append(waiting);
  }
}
async function upload(files) {
  try {
    for (const f of files) {
      status(`${f.name} をアップロード中...`);
      await json("/api/upload", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-file-name": encodeURIComponent(f.name),
        },
        body: f,
      });
    }
    await loadFiles();
  } catch (e) {
    status(e.message);
  }
}
selectAll.onchange = () => {
  document
    .querySelectorAll(".select-file")
    .forEach((n) => (n.checked = selectAll.checked));
  updateSelection();
};
bulkDelete.onclick = async () => {
  const names = selected();
  if (!names.length || !confirm(`${names.length} 件のファイルを削除しますか？`))
    return;
  try {
    for (const name of names)
      await json(`/api/files/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
    status(`${names.length} 件を削除しました。`);
  } catch (e) {
    status(e.message);
  } finally {
    await loadFiles();
  }
};
bulkDownload.onclick = async () => {
  const names = selected();
  if (!names.length) return;
  status(`${names.length} 件のダウンロードを開始します。`);
  for (const name of names) {
    const a = document.createElement("a");
    a.href = `/files/${encodeURIComponent(name)}`;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 300));
  }
};
fileInput.onchange = () => upload(fileInput.files);
q("#refreshButton").onclick = loadFiles;
sortOrder.onchange = () => {
  renderedFilesSignature = "";
  loadFiles().catch((e) => status(e.message));
};
["dragenter", "dragover"].forEach((x) =>
  q("#dropzone").addEventListener(x, (e) => e.preventDefault()),
);
q("#dropzone").ondrop = (e) => {
  e.preventDefault();
  upload(e.dataTransfer.files);
};
heartbeat();
setInterval(heartbeat, 10000);
addEventListener("pagehide", () =>
  navigator.sendBeacon(`/api/disconnect?id=${encodeURIComponent(clientId)}`),
);
Promise.all([info(), loadFiles(), loadPeers()]).catch((e) => status(e.message));
setInterval(() => loadFiles().catch(() => {}), 5000);
setInterval(() => loadPeers().catch(() => {}), 2000);
