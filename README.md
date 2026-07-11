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
npm run build:exe
```

生成先は `dist/lan-file-share.exe` です。Node.jsのSingle Executable Application（SEA）方式を使うため、実行時のNode.jsインストールは不要です。
Windowsのコード署名を使う場合は、SEAリソースの注入後に生成したEXEへ署名してください。

## 復元元

このプロジェクトのソースは、同梱の `dist/lan-file-share.exe` のSEAリソースから抽出しました。再抽出が必要な場合は以下を実行できます。

```powershell
.\tools\extract-sea.ps1
```

配布用EXEは `dist/` に含まれます。共有データと `node_modules` はGitの追跡対象外です。
