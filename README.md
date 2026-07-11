# lan-file-share-app

同一LAN上の端末間で、ブラウザからファイルを共有する小さなWindows向けアプリです。サーバーはローカルPCで起動し、共有ファイルは `shared/` に保存されます。

## 開発実行

Node.js **22.23.1** を用意してから、次を実行します。

```powershell
npm install
npm start
```

起動後、表示される `http://<LANのIPアドレス>:3000` を同じネットワーク内の端末で開きます。`PORT` と `OPEN_BROWSER=0` の環境変数で動作を変更できます。アップロード容量の上限は設けていません（保存先の空き容量による制約のみです）。

## EXEの再作成

```powershell
npm install
npm run build:node
```

生成先は `dist/node-version/lan-file-share.exe` です。Node.jsのSingle Executable Application（SEA）方式を使うため、実行時のNode.jsインストールは不要です。
Windowsのコード署名を使う場合は、SEAリソースの注入後に生成したEXEへ署名してください。

## Electron版

Electron版を同一LAN内の複数PCで起動すると、各PCを自動検出します。画面上のPC名を選ぶだけで相手PCの共有ファイルへ接続でき、IPアドレスの手入力は不要です。スマートフォンからは従来どおりQRコードで接続します。

開発実行とポータブルEXEの生成:

```powershell
npm run start:electron
npm run build:electron
```

Electron版の生成先は `dist/electron-version/lan-file-share-electron.exe` です。共有フォルダーはポータブルEXEと同じ場所に作成されます。初回起動時にWindowsファイアウォールの確認が表示された場合は、プライベートネットワークでの通信を許可してください。

## 復元元

このプロジェクトのソースは、同梱の `dist/node-version/lan-file-share.exe` のSEAリソースから抽出しました。再抽出が必要な場合は以下を実行できます。

```powershell
.\tools\extract-sea.ps1
```

配布用EXEは `dist/` に含まれます。共有データと `node_modules` はGitの追跡対象外です。
