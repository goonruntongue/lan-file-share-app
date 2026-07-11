const { existsSync } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");

if (process.platform !== "win32") {
  throw new Error("Electron版EXEの生成はWindows上で実行してください。");
}

const root = join(__dirname, "..");
const powershellDirectory = join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
);
const builder = join(
  root,
  "node_modules",
  "electron-builder",
  "out",
  "cli",
  "cli.js",
);
if (!existsSync(builder)) {
  throw new Error("依存関係がありません。先に npm install を実行してください。");
}

const result = spawnSync(
  process.execPath,
  [builder, "--win", "portable", "--config", "electron-builder.yml"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${powershellDirectory};${process.env.PATH || ""}`,
    },
  },
);
process.exit(result.status ?? 1);
