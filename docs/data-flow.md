# Data Flow

This document traces the end-to-end path of a migration run, from UI input to Gmail mutations and reporting.

## 1. Renderer Initiates a Run

1. User clicks **Run Migration** in `electron/index.html`.
2. Renderer gathers options:
   - `dryRun` toggle
   - `logLevel` select (`info` or `debug`)
   - Optional `frontInboxId`
3. `window.electronAPI.runMigration(opts)` (from `preload.js`) invokes the `run-migration` IPC handler in `electron/main.js`.

## 2. Main Process Spawns Runtime

1. `run-migration` constructs a child process command: `process.execPath dist/index.js` with `ELECTRON_RUN_AS_NODE=1`.
2. Environment setup:
   - Sets `REPORTS_DIR` to the working reports folder (packaged vs dev).
   - Removes any inherited `FRONT_API_KEY` so only keychain secrets are used.
   - Applies UI overrides for `DRY_RUN`, `LOG_LEVEL`, and `FRONT_INBOX_ID`.
3. Child stdout/stderr streams are piped back to the renderer via `migration-data` events; completion and errors trigger `migration-end` / `migration-error` events.

## 3. Runtime Boot (`dist/index.js`)

1. Prints run banner and effective Gmail scope (read-only when dry run).
2. Calls `ensureInteractiveSetup()`:
   - Loads Front token from `SecureStore`; falls back to `FRONT_API_KEY` only if user set it explicitly.
   - Loads Google OAuth credentials from `SecureStore`; errors if missing.
3. Loads `.env` based config via `loadConfig()` (batch size, dry run flag, log level, skip archived, inbox filter).
4. Constructs `FrontToGmailMigrator` and invokes `run()`.

## 4. Migrator Execution

```text
Front API → map → ensure labels → batch loop → Gmail → report
```

1. **Front fetch** – `FrontClient.getAllConversations()` pulls pages of conversations (optionally filtered by inbox). Each conversation includes tags and messages.
2. **Mapping** – `ConversationMapper.mapConversation()` produces `MigrationItem`s:
   - Normalises tag names into Gmail-safe labels (prefixing with `Front/` or `Front-`).
   - Determines archive state (`status === 'archived'`).
   - Extracts RFC Message-ID (without angle brackets) and collects participant addresses for possible future heuristics.
3. **Label preparation** – Collects unique labels from all items, adds status labels (`Front/Status/Archived`, `Front/Status/Inbox`):
   - Dry run → logs the label list but does not hit Gmail.
   - Live run → `GmailClient.ensureLabels()` creates any missing labels and records their IDs in `labelMap`.
4. **Batch processing** – Items are sliced into `batchSize` chunks (default 10) to respect Gmail rate limits. Between batches, the migrator sleeps 1s.
5. **Per-item handling** (`processMigrationItem`):
   - Skips items without Message-ID or (optionally) archived items when `SKIP_ARCHIVED=true`.
   - Looks up Gmail thread via `GmailClient.getMessageByMessageId()` (strict match).
   - Dry run → logs planned add/remove label sets, records action `dry_run`.
   - Live run → assembles label IDs, calls `GmailClient.modifyThread()` to add Front tag labels + current status label, and removes the opposite status label.
   - Tracks metrics (`matched`, `labeled`, status counts) and pushes a `ReportRow` capturing labels, outcome, and optional failure reason.

## 5. Completion & Reporting

1. After all batches, the migrator prints a summary table with totals, matched counts, labels applied, skips, and failures.
2. `writeCsvReport()` resolves the report directory:
   - Uses `REPORTS_DIR` env if provided (packaged app).
   - Otherwise defaults to `<cwd>/reports`.
3. Emits `migration-report-<timestamp>.csv`, quoting values and joining label arrays with semicolons. Renderer typically opens the containing folder on demand.

## 6. Renderer Feedback Loop

1. The renderer appends every log chunk into the on-screen console and keeps it scrolled to the bottom.
2. On `migration-end`, the UI updates status chips, surfaces toast notifications (success, auth failures, generic errors), and re-enables controls.
3. If Gmail OAuth was granted during the run, the renderer re-queries token status to update displayed scopes.

This flow keeps mutations isolated to Gmail threads with an exact Message-ID match and records every decision in the CSV for post-run auditing.
