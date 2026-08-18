# dsh-session-replay

> DeepSeek Harness 会话链接回放插件：把任意对话生成可分享的动画回放，像看录屏一样回顾 Agent 的每一步。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/KinGao294/dsh-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/KinGao294/dsh-replay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-session-replay.svg)](https://www.npmjs.com/package/dsh-session-replay)

> 🌐 [English README](README.en.md) / 中文

## ✨ 功能

- **链接回放（Manus 风格）**：把一次对话变成可分享的回放链接，对方打开即看动画回放——消息打字机式逐条出现、工具调用卡片展开参数与结果、思考过程可折叠。
- **倍速播放**：0.5× / 1× / 2× / 4× 随时切换，打开默认 4× 自动播放。
- **一比一原生界面**（本机访问）：`/replay/<id>` 直接复用真实 DSH GUI 渲染（同一份 `__DSH_BOOT__` + 全部插件），回放控制条叠加在原生界面上。
- **独立 HTML 导出**：生成自包含 HTML 文件（数据内嵌、无需 DSH、可离线），发给不在一台机器的人最稳妥。
- **单会话分享**：无会话列表页，分享出去的只有你选中的那一个对话，其他会话不可见。
- **GUI 集成**：会话右键菜单新增「🔗 分享回放」（重命名上方），一键复制链接 / 下载 HTML。

## 📦 安装

```sh
# 方式一：npm（推荐）
dsh plugin --profile web add dsh-session-replay

# 方式二：从本仓库安装
git clone https://github.com/KinGao294/dsh-replay.git
cd dsh-replay
dsh plugin --profile web add link:$(pwd)

# 方式三：本地路径安装
dsh plugin --profile web add /path/to/dsh-replay
```

装完重启 `dsh web`，会话右键菜单即出现「🔗 分享回放」。

## 🚀 使用

### GUI 内分享（推荐）

1. 打开 dsh web，侧边栏悬停任意会话 → 点 **⋯** → **🔗 分享回放**
2. 面板提供：
   - **复制回放链接**：`http://<host>/replay/<sessionId>`（本机/局域网）
   - **下载 HTML 文件**：自包含回放，发给外部的人
3. 对方打开链接 → 立即 4× 自动播放，只看到这一个对话。

### 公网固定链接（可选）

配合 Cloudflare Tunnel 可获得固定公网域名（需要你自己的域名）：

```sh
cloudflared tunnel login
cloudflared tunnel create dsh-replay
cloudflared tunnel route dns dsh-replay replay.yourdomain.com
# 配置 ~/.cloudflared/config.yml 将 replay.yourdomain.com 指向 http://127.0.0.1:3080
# macOS 开机自启：创建 LaunchAgent 运行 cloudflared tunnel run dsh-replay
```

之后 `https://replay.yourdomain.com/replay/<sessionId>` 就是永久公网链接。

### CLI

```sh
npx dsh-replay list                      # 列出所有会话
npx dsh-replay export <sessionId> out.html  # 导出独立 HTML
npx dsh-replay serve [port]              # 本地静态服务（默认 8931）
```

## 🔧 原理

- 会话日志是 DSH 的 `session.jsonl.zstd`（Zstandard 多帧拼接的 JSONL 事件流）。
- 插件解压并按 `seq` 重建时间线：`user/message`、`assistant/message`（含 reasoning/text/tool-call）、`tool/call`、`tool/result`。
- **本机回放**：插件 fetch 真实 GUI 首页（含 `__DSH_BOOT__`），注入驱动脚本 → 点击原生侧边栏会话行 → 原生组件渲染 → 叠加回放控制条，逐节点 reveal。
- **远程回放**：GUI 的 `session.list` RPC 有 loopback 保护，远程访问时插件自动返回独立播放器（内嵌数据），保证外部可用。
- **分享按钮**：通过 `webServer.tapIndex` 注入 GUI 首页，用 `session.list` RPC 拿同源会话索引，向原生右键菜单注入「分享回放」项。

## ⚠️ 注意事项

- 分享链接本身即访问凭证：拿到完整 URL 的人可以打开该会话回放（含工具输出）。分享前注意敏感信息。
- 公网回放内容会经过隧道提供商（如 Cloudflare）传输。
- 本机回放（一比一 GUI）依赖 `session.list` RPC 可用；远程访问自动降级为独立播放器。

## 🧪 开发

```sh
npm install
npm run build   # TypeScript 类型检查（tsc --noEmit）
npm test        # 单元测试（node:test + tsx）
npm pack        # 校验发布包内容
```

CI（GitHub Actions）在每次 push/PR 时自动跑构建 + 测试；推送 `v*` tag 自动发布 npm（见 `.github/workflows/publish.yml`）。

## 📄 License

[MIT](LICENSE)
