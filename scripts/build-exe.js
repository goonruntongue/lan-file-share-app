const { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");

if (process.platform !== "win32") {
  throw new Error("EXEの生成はWindows上で実行してください。");
}

const root = join(__dirname, "..");
const dist = join(root, "dist", "node-version");
const blob = join(dist, "sea-prep.blob");
const output = join(dist, "lan-file-share.exe");
const brandedOutput = join(dist, "lan-file-share.branded.exe");
const icon = join(root, "assets", "app.ico");
const postject = join(root, "node_modules", "postject", "dist", "cli.js");
const resedit = join(root, "node_modules", "resedit-cli", "dist", "cli.js");

if (!existsSync(postject) || !existsSync(resedit) || !existsSync(icon)) {
  throw new Error("依存関係がありません。先に npm install を実行してください。");
}

mkdirSync(dist, { recursive: true });
let result = spawnSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

copyFileSync(process.execPath, output);
result = spawnSync(process.execPath, [
  postject,
  output,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

rmSync(brandedOutput, { force: true });
result = spawnSync(process.execPath, [
  resedit,
  output,
  brandedOutput,
  "--icon",
  `1,${icon}`,
  "--ignore-signed",
], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

rmSync(output, { force: true });
renameSync(brandedOutput, output);
rmSync(blob, { force: true });
console.log("Created dist/node-version/lan-file-share.exe");
