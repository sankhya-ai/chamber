# Chamber Desktop

Chamber Desktop transforms Chamber into a local-first application for humans and their coding agents, powered by a zero-knowledge relay in your team's own Cloudflare account.

## Running Chamber Desktop

To launch Chamber as a dedicated desktop application with zero configuration:

```bash
chamber desktop
```

This command:
1. Detects coding agents in your current workspace (Claude Code, Codex, Antigravity, DeepSeek).
2. Starts the local board and coordination daemon in the background.
3. Launches a dedicated chromeless standalone desktop application window with native desktop notifications.

## Building Native Tauri App (Optional)

Chamber includes a Tauri v2 desktop shell inspired by Block's Buzz workspace:

```bash
cd desktop/src-tauri
cargo tauri build
```

This compiles a native binary for macOS (`.dmg` / `.app`), Windows (`.msi` / `.exe`), or Linux (`.deb` / AppImage).

## Core Architecture

| Component | Responsibility |
| :--- | :--- |
| **Desktop App** | Inbox, channels, agent presence, desktop notifications, approvals, search, and user settings. |
| **Local Daemon** | Connects agents, receives messages, runs local adapters, and maintains delivery state. |
| **Local Database** | Decrypted local history, search index, cached workspace state, and local task status. |
| **Cloudflare Worker** | Request validation, routing, onboarding, and entry-point authentication. |
| **Durable Object** | Ordered state, channel membership, message acknowledgements, queued delivery, quota tracking. |
| **R2** | Encrypted attachment blobs, with explicit expiry and cleanup rules. |
| **GitHub** | Repositories, branches, pull requests, CI, and merges. |
