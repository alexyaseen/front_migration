# Architecture Overview

This project packages a Front → Gmail migration engine into an Electron desktop app. The TypeScript source under `src/` compiles to CommonJS modules in `dist/`, which both the CLI entry point and the Electron main process consume. The renderer UI (HTML/CSS/vanilla JS inside `electron/`) controls the migration through IPC calls to the main process, which in turn spawns the compiled Node runtime.

## Top-Level Layout

- `src/` – TypeScript source for the migration runtime, API clients, utilities, and config loader. Compiled output is emitted to `dist/` by `npm run build`.
- `electron/` – Electron assets: `main.js` for the main process, `preload.js` for the sandbox bridge, `index.html` + `styles.css` for the renderer, and icons/entitlements used during packaging.
- `scripts/` – Helper scripts invoked by `electron-builder` for notarization, stapling, and icon generation.
- `reports/` – Default working-directory location for CSV reports produced during development runs.

## Core Modules

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Boots the migration: loads config, ensures secrets, instantiates API clients, coordinates batches, logs progress, and writes the CSV report. |
| `src/api/front.ts` | Typed Front API client with retry/backoff logic and pagination helpers. |
| `src/api/gmail.ts` | Gmail API wrapper that supports read-only vs modify scopes, label provisioning, RFC Message-ID lookups, and OAuth via loopback flow. |
| `src/utils/mapper.ts` | Converts Front conversations into migration items, normalises label names, and captures metadata for reporting. |
| `src/utils/logger_ascii.ts` | Console logger with progress bar output. |
| `src/utils/secureStore.ts` | Thin abstraction over `keytar` for storing Front/Gmail secrets in the OS keychain. |

## Runtime Contracts

1. **Configuration** – `loadConfig()` reads `.env`, validates required keys, and surfaces migration toggles (batch size, dry run, log level, inbox filter). The Electron shell sets these env vars for each run based on UI selections.
2. **Secret Management** – `ensureInteractiveSetup()` requires that both the Front API token and Google OAuth credentials exist in the keychain before execution. Missing secrets short-circuit the run with actionable errors that the renderer surfaces to the user.
3. **Migration Loop** – Conversations are fetched from Front, mapped to target labels, and processed in batches. Gmail threads are identified strictly by RFC Message-ID; if no match is found nothing is mutated. For live runs, the Gmail client ensures labels exist, applies status labels, and removes the opposite status marker (`Front/Status/Archived` vs `Front/Status/Inbox`).
4. **Reporting** – Each processed conversation adds a row to an in-memory report that is flushed to CSV (`reports/` by default, or the packaged app data directory). Progress and summary stats stream to stdout for the renderer log console.

## Electron Integration

- `electron/main.js` wires IPC handlers so the renderer can save/delete secrets, list Front inboxes, launch a migration, cancel it, and open the reports folder. Each migration spawns `dist/index.js` with `ELECTRON_RUN_AS_NODE=1` so the Node runtime executes inside a child process, keeping the UI responsive.
- `electron/preload.js` exposes a minimal API surface to the renderer via `contextBridge`, preserving sandboxing.
- `electron/index.html` implements the UI with vanilla JS. It manages toasts, modals, secret state, run toggles, and streams child-process output into a scrollable console.

## Build Targets

- Development: `npm run electron` → TypeScript build + Electron with live keychain access.
- Packaging: `npm run dist[:platform]` → TypeScript build, production dependency prune, electron-builder packaging, optional notarization/stapling hooks (macOS).

The separation between compiled runtime (`dist/`) and Electron shell keeps the migration logic reusable outside the desktop app, while the UI and IPC abstractions provide a controlled environment for operators.
