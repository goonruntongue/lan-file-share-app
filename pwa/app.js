const $ = selector => document.querySelector(selector);
const config = globalThis.LAN_SHARE_PWA_CONFIG || {};
let state = JSON.parse(localStorage.getItem("lanSharePwa") || "{}");
let selected = null;

const auth = () => ({ authorization: `Bearer ${state.token || ""}` });
const saveState = () => localStorage.setItem("lanSharePwa", JSON.stringify(state));
const openModal = id => $(id).showModal();

function setJoin() {
  $("#join").hidden = false;
  $("#peers").hidden = true;
  $("#files").hidden = true;
  $("#room").value = state.room || "";
  $("#token").value = state.token || "";
  $("#discovery").value = state.discovery || config.discoveryUrl || "";
}

async function discover() {
  if (!state.room || !state.token || !state.discovery) return setJoin();
  const response = await fetch(`${state.discovery.replace(/\/$/, "")}/v1/rooms/${encodeURIComponent(state.room)}/peers`, { headers: auth() });
  if (!response.ok) throw Error("PC一覧を取得できませんでした。");
  const { peers } = await response.json();
  $("#join").hidden = true;
  $("#peers").hidden = false;
  const list = $("#peer-list");
  list.textContent = "";
  for (const peer of peers) {
    const button = $("#peer-template").content.firstElementChild.cloneNode(true);
    button.textContent = peer.name;
    button.onclick = () => openPeer(peer);
    list.append(button);
  }
  if (!peers.length) list.textContent = "起動中のPCを探しています…";
}

async function openPeer(peer) {
  selected = peer;
  $("#files").hidden = false;
  $("#peer-name").textContent = peer.name;
  const response = await fetch(`${peer.url}/api/files`, { headers: auth() });
  if (!response.ok) throw Error("PCへ接続できませんでした。LAN接続と権限を確認してください。");
  const data = await response.json();
  const list = $("#file-list");
  list.textContent = "";
  for (const file of data.files) {
    const row = $("#file-template").content.firstElementChild.cloneNode(true);
    row.querySelector("h3").textContent = file.name;
    row.querySelector("p").textContent = `${file.sizeLabel} ・ ${new Date(file.modifiedAt).toLocaleString("ja-JP")}${file.protected ? " ・ 🔒 保護済み" : ""}`;
    row.querySelector(".download").onclick = () => download(file);
    list.append(row);
  }
}

async function download(file) {
  let token = "";
  if (file.protected) {
    const password = prompt("パスワードを入力してください");
    if (password === null) return;
    const response = await fetch(`${selected.url}/api/files/${encodeURIComponent(file.name)}/unlock`, { method: "POST", headers: { ...auth(), "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (!response.ok) return alert("パスワードが違うか、解除できませんでした。");
    token = (await response.json()).token;
  }
  location.href = `${selected.url}/files/${encodeURIComponent(file.name)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

$("#save").onclick = () => {
  state = { room: $("#room").value.trim(), token: $("#token").value.trim(), discovery: $("#discovery").value.trim() };
  saveState();
  discover().catch(error => alert(error.message));
};
$("#settings").onclick = setJoin;
$("#install").onclick = () => openModal("#install-modal");
$("#guide").onclick = () => openModal("#guide-modal");
document.querySelectorAll(".modal-close").forEach(button => button.onclick = event => event.currentTarget.closest("dialog").close());
document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); }));

$("#upload").onchange = async event => {
  if (!selected) return;
  for (const file of event.target.files) {
    const password = confirm(`${file.name}にパスワードを設定しますか？`) ? prompt("パスワード") || "" : "";
    const response = await fetch(`${selected.url}/api/upload`, { method: "POST", headers: { ...auth(), "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name), "x-file-password": encodeURIComponent(password) }, body: file });
    if (!response.ok) alert(`${file.name}をアップロードできませんでした。`);
  }
  openPeer(selected);
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
const query = new URLSearchParams(location.search);
if (query.has("room")) {
  state = { room: query.get("room"), token: query.get("token"), discovery: query.get("discovery") };
  saveState();
  history.replaceState(null, "", location.pathname);
}
discover().catch(error => alert(error.message));
setInterval(() => discover().catch(() => {}), 5000);
