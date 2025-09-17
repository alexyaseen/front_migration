# Authentication & Secret Storage

The migration runtime relies on the OS keychain (via `keytar`) for both Front and Google credentials. This avoids shipping raw secrets in `.env` files and allows the Electron UI to manage them interactively.

## Keytar Accounts

| Secret | Keytar Account | Contents |
| --- | --- | --- |
| Front API token | `front-api-token` | Raw Front personal access token with conversation read scope. |
| Google OAuth credentials | `google-credentials` | Paste-in copy of the downloaded `credentials.json` (Desktop app client). |
| Gmail OAuth token | `google-oauth-token` | Token/refresh token issued by Google's loopback flow, including granted scopes. |

All entries are stored under the service name `front-to-gmail-migration` (see `SecureStore` in `src/utils/secureStore.ts`).

## Runtime Expectations

1. **Front token** – `ensureInteractiveSetup()` first attempts to read the token from keychain. If missing and `FRONT_API_KEY` is *not* set in the environment, the run aborts with `Front API token not found`. The Electron UI only ever writes to the keychain; the env var path is reserved for advanced CLI usage.
2. **Google credentials** – Must exist in keychain. The runtime has no env var fallback and errors with `Google OAuth credentials not found` if absent.
3. **Gmail OAuth token** – When present, the runtime immediately authenticates with the saved token. If missing, the runtime triggers a local web-server OAuth loopback:
   - Spins up an ephemeral `http://127.0.0.1:<port>/oauth2callback` listener.
   - Opens the system browser to Google's consent URL (best-effort `open`, `xdg-open`, or `start`).
   - Captures the `code` query parameter, exchanges it for tokens, stores them in keychain, and proceeds.

## Scopes and Modes

- Dry run (`DRY_RUN` unset or `true`): requests `https://www.googleapis.com/auth/gmail.readonly`.
- Live run (`DRY_RUN=false`): requests `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/gmail.labels`.

Scopes granted on first authentication persist in the token; deleting the token from the Authentication modal forces re-authentication.

## Managing Secrets via UI

Within the **Authentication** card in `electron/index.html`:

- **Front API Token** – Configure (save) or delete. When token exists, the modal switches to a delete-only confirmation.
- **Google Credentials** – Drag & drop `credentials.json` into a read-only textarea for validation before saving. Supports delete-and-replace.
- **Gmail OAuth Token** – Shows current scopes and allows deletion. Removal clears the keychain entry so the next run re-opens the browser.

All IPC operations pass through `electron/main.js`, which loads `SecureStore` from the compiled `dist/utils/secureStore.js` for compatibility with packaged builds.

## Troubleshooting

- **401 errors** – The runtime throws `FRONT_AUTH_401` or `GOOGLE_AUTH_401` with guidance; the renderer watches for these strings to display contextual toasts.
- **Token drift** – If scopes change (e.g., switching from dry run to live), delete the Gmail OAuth token before running so new scopes are consented.
- **Environment overrides** – Advanced users running the CLI directly can set `FRONT_API_KEY`, but should still store Google credentials/token in keychain, as the runtime does not read them from disk.
