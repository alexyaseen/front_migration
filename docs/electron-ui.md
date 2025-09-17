# Electron UI Notes

The desktop app wraps the migration runtime with a focused Electron shell. The main process (`electron/main.js`) owns lifecycle, IPC plumbing, and child-process management; the renderer (`electron/index.html`) provides the operator-facing UI.

## Main Process Responsibilities

- **Window creation** – `createWindow()` builds a 960×828 window, loads `electron/index.html`, and sets the app icon (preferring `icon.icns` on macOS).
- **Quit handling** – Intercepts window close and `before-quit` events. If a migration is running, prompts the user, attempts a graceful `SIGTERM`, and escalates to `SIGKILL` after a timeout.
- **IPC endpoints**:
  - `save-secrets`, `delete-front-token`, `delete-google-creds`, `delete-google-token` – Manage keychain entries via `SecureStore`.
  - `get-secrets-status`, `get-google-token-info` – Surface configuration state to the renderer.
  - `list-front-inboxes` – Instantiates `FrontClient` (from compiled `dist`) with the stored token to list inboxes for filtering.
  - `run-migration` / `cancel-migration` – Spawn and terminate the underlying Node process driving the migration.
  - `open-reports`, `open-external` – Open folders or URLs using platform-appropriate methods.
- **Child process management** – Maintains `currentChild` so cancellation or quit can target the active run. Streams stdout/stderr back to the renderer.

## Preload Bridge

`electron/preload.js` exports a minimal API via `contextBridge`. The renderer never touches `ipcRenderer` directly, reducing the attack surface and keeping strict CSP in place (`script-src 'self' 'unsafe-inline'` due to inline script block).

## Renderer Overview

The renderer is a single HTML file (`index.html`) styled with `styles.css` and a large inline script. Key elements:

- **Navigation bar** – Shows brand, overall status chip (Idle/Running/Completed/Failed), and `Run Migration` / `Stop` button.
- **Authentication card** – Displays configuration status for Front token, Google credentials, and Gmail OAuth token. Uses modals for each action with tooltips linking to setup docs.
- **Run settings card** – Toggles dry run, selects log level, and (when Front token is present) lists Front inboxes via `list-front-inboxes`.
- **Log console** – `<pre id="output">` receiving streaming log chunks. Supports clearing and opening the reports folder.
- **Toasts system** – Lightweight notifications appended to `#toasts` with auto-dismiss handling.

### Run Workflow in UI

1. When `Run Migration` is clicked, the script guards against missing secrets by relying on runtime errors. It clears the console, disables controls, and subscribes to `migration-data`, `migration-end`, and `migration-error` events.
2. Child output is appended to the console in real time. Summary lines (e.g., `MIGRATION SUMMARY`) help users monitor progress.
3. On completion, the renderer updates the status chip, re-enables controls, and displays contextual toasts (success, auth failure hints, generic fail).
4. If the user clicks `Stop`, the renderer confirms, sends `cancel-migration`, and flips back to idle state.

### Accessibility & UX Touches

- Tooltips double as clickable links with keyboard support (`Enter`/`Space`).
- Drag & drop for Google credentials uses `File.text()` when available, with fallback to `FileReader`.
- Status badges update dynamically based on keychain state.
- The dry run toggle is visually disabled during a run to prevent mid-flight changes.

## Packaged vs Dev Differences

- Report directory: packaged builds route to `app.getPath('userData')/reports`, while dev runs stay at `<repo>/reports`.
- `process.resourcesPath` is used as a safe cwd when launching the child process inside an ASAR archive.

These conventions keep the renderer simple, deterministic, and decoupled from Node internals, relying solely on the preload-exposed API.
