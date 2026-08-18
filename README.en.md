# dsh-session-replay

> A DeepSeek Harness session link-replay plugin: turn any conversation into a shareable animated replay — watch every step of an agent like a screen recording.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/KinGao294/dsh-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/KinGao294/dsh-replay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-session-replay.svg)](https://www.npmjs.com/package/dsh-session-replay)

## ✨ Features

- **Link replay (Manus-style)**: turn a conversation into a shareable replay link — messages appear one by one with a typewriter effect, tool-call cards expand arguments and results, reasoning is collapsible.
- **Playback speed**: 0.5× / 1× / 2× / 4× at any time; opens with 4× auto-play by default.
- **Pixel-identical native UI** (local access): `/replay/<id>` reuses the real DSH GUI rendering (the same `__DSH_BOOT__` plus all plugins), with replay controls overlaid on the native interface.
- **Standalone HTML export**: generates a self-contained HTML file (data embedded, no DSH required, fully offline) — the safest way to share with someone on a different machine.
- **Single-session sharing**: there is no session list page; only the conversation you selected is shared, other sessions stay invisible.
- **GUI integration**: a new **「🔗 Share Replay」** item appears in the session context menu (above *Rename*) — one click to copy the link / download the HTML.

## 📦 Install

```sh
# Option 1 — npm (recommended)
dsh plugin --profile web add dsh-session-replay

# Option 2 — from this repository
git clone https://github.com/KinGao294/dsh-replay.git
cd dsh-replay
dsh plugin --profile web add link:$(pwd)

# Option 3 — local path
dsh plugin --profile web add /path/to/dsh-replay
```

After installing, restart `dsh web` — the **「🔗 Share Replay」** item appears in the session context menu.

## 🚀 Usage

### Share inside the GUI (recommended)

1. Open dsh web, hover any session in the sidebar → click **⋯** → **🔗 Share Replay**
2. The panel offers:
   - **Copy replay link**: `http://<host>/replay/<sessionId>` (local / LAN)
   - **Download HTML file**: self-contained replay for people outside your network
3. When the recipient opens the link → it auto-plays at 4× and shows only that single conversation.

### Permanent public link (optional)

Pair with a Cloudflare Tunnel to get a fixed public domain (you need your own domain):

```sh
cloudflared tunnel login
cloudflared tunnel create dsh-replay
cloudflared tunnel route dns dsh-replay replay.yourdomain.com
# Configure ~/.cloudflared/config.yml to point replay.yourdomain.com at http://127.0.0.1:3080
# macOS auto-start: create a LaunchAgent that runs `cloudflared tunnel run dsh-replay`
```

Then `https://replay.yourdomain.com/replay/<sessionId>` is a permanent public link.

### CLI

```sh
npx dsh-replay list                      # list all sessions
npx dsh-replay export <sessionId> out.html  # export a standalone HTML
npx dsh-replay serve [port]              # local static server (default 8931)
```

## 🔧 How it works

- Session logs are DSH's `session.jsonl.zstd` (a Zstandard multi-frame JSONL event stream).
- The plugin decompresses and rebuilds a timeline by `seq`: `user/message`, `assistant/message` (with reasoning/text/tool-call), `tool/call`, `tool/result`.
- **Local replay**: the plugin fetches the real GUI index page (with `__DSH_BOOT__`), injects a driver script → clicks the native sidebar session row → native components render → replay controls overlay on top, revealing nodes one by one.
- **Remote replay**: the GUI's `session.list` RPC is loopback-protected, so on remote access the plugin automatically serves a standalone player (data embedded) to stay usable externally.
- **Share button**: injected into the GUI index via `webServer.tapIndex`, gets the same-source session index via the `session.list` RPC, and injects a "Share Replay" item into the native context menu.

## 🧪 Development

```sh
npm install
npm run build   # TypeScript type-check (tsc --noEmit)
npm test        # run unit tests (node:test + tsx)
npm pack        # verify the publishable tarball contents
```

CI (GitHub Actions) runs build + tests on every push/PR. Publishing to npm is triggered by pushing a `v*` tag (see `.github/workflows/publish.yml`).

## ⚠️ Notes

- A share link is itself an access credential: anyone with the full URL can open that session's replay (including tool output). Mind sensitive information before sharing.
- Public replay traffic passes through the tunnel provider (e.g. Cloudflare).
- Local replay (1:1 GUI) depends on the `session.list` RPC being available; remote access degrades automatically to the standalone player.

## 📄 License

[MIT](LICENSE)
