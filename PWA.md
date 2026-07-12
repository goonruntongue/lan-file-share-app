# LAN File Share PWA

`pwa/` はCloudflare Pagesへ、`cloudflare/discovery-worker/` はCloudflare Workerへ配置します。Cloudflareには起動PCの名前とLAN URLだけを45秒間保持し、ファイル本体・プレビュー・パスワードは送信しません。

## 配置

1. Workerで `LAN_REGISTRY_TOKEN` と `PWA_ORIGIN` をsecret/variableとして設定し、`wrangler deploy` します。
2. `pwa/config.js` の `discoveryUrl` をWorker URLへ設定して、`pwa/` をCloudflare Pagesへ配信します。
3. 各配布フォルダにある `lan-file-share-pwa.json` に参加設定を置きます。初回ビルド時は、プロジェクト直下の同名ファイルがNode版・Electron版の配布フォルダへ自動コピーされます。設定例は `lan-file-share-pwa.example.json` を参照してください。環境変数（`LAN_SHARE_DISCOVERY_URL`、`LAN_SHARE_DISCOVERY_ROOM`、`LAN_SHARE_DISCOVERY_TOKEN`、`LAN_SHARE_PWA_ORIGIN`、`LAN_SHARE_PWA_APP_URL`）を指定した場合は、環境変数が優先されます。

スマホはPCが表示する「PWA参加用QR」を初回だけ読み取ります。QRが使えない場合は、同じPC画面の「手入力情報を表示」で参加ルーム・参加トークン・接続先を確認し、PWAの「QRが使えない場合：参加情報を手入力」から登録できます。その後はPWA起動時にオンラインPCを自動表示します。

> PWAからLAN PCへ直接アクセスするため、ブラウザのLocal Network Access許可と、社内で信頼されたHTTPSを推奨します。Cloudflare TunnelやR2を使わないため、ファイル本体はCloudflareを経由しません。
