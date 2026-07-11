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
async function loadFiles() {
  const { files, sharedFolder } = await json(`/api/files?t=${Date.now()}`);
  currentFiles = files;
  q("#sharedFolder").textContent = sharedFolder;
  fileList.textContent = "";
  fileCount.textContent = `${files.length} 件`;
  if (!files.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "まだ共有ファイルはありません。";
    fileList.append(e);
    return updateSelection();
  }
  for (const f of files) {
    const row = template.content.firstElementChild.cloneNode(true),
      checkbox = row.querySelector(".select-file");
    checkbox.dataset.name = f.name;
    checkbox.setAttribute("aria-label", `${f.name} を選択`);
    checkbox.onchange = updateSelection;
    row.querySelector("h3").textContent = f.name;
    row.querySelector(".details").textContent =
      `${f.sizeLabel} ・ ${date(f.modifiedAt)}`;
    row.querySelector(".path").textContent = f.path;
    const a = row.querySelector("a");
    a.href = `/files/${encodeURIComponent(f.name)}`;
    a.download = f.name;
    row.querySelector(".actions button").onclick = async () => {
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
Promise.all([info(), loadFiles()]).catch((e) => status(e.message));
setInterval(() => loadFiles().catch(() => {}), 5000);
