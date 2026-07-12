# LAN File Share PWA

`pwa/` はCloudflare Pagesへ、`cloudflare/discovery-worker/` はCloudflare Workerへ配置します。Cloudflareには起動PCの名前とLAN URLだけを45秒間保持し、ファイル本体・プレビュー・パスワードは送信しません。

## 配置

1. Workerで `LAN_REGISTRY_TOKEN` と `PWA_ORIGIN` をsecret/variableとして設定し、`wrangler deploy` します。
2. `pwa/config.js` の `discoveryUrl` をWorker URLへ設定して、`pwa/` をCloudflare Pagesへ配信します。
3. 各PCの起動環境へ `LAN_SHARE_DISCOVERY_URL`、`LAN_SHARE_DISCOVERY_ROOM`、`LAN_SHARE_DISCOVERY_TOKEN`、`LAN_SHARE_PWA_ORIGIN`、`LAN_SHARE_PWA_APP_URL` を設定します。

スマホはPWAをHTTPSでインストールし、PCが表示する参加URL（room/token/discovery）で初回だけ登録します。その後はPWA起動時にオンラインPCを自動表示します。

> PWAからLAN PCへ直接アクセスするため、ブラウザのLocal Network Access許可と、社内で信頼されたHTTPSを推奨します。Cloudflare TunnelやR2を使わないため、ファイル本体はCloudflareを経由しません。
