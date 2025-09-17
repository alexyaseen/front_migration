# Front to Gmail Migration Tool

A Node.js tool to migrate email labels and archive status from Front to Gmail. Since Front doesn't sync labels back to Gmail, this tool helps you organize your Gmail inbox to match your Front organization.

## Features

- Fetches all conversations from Front (optionally a single inbox)
- Maps Front tags to Gmail labels
- Preserves archive status from Front by tagging status labels (does not change INBOX)
- Applies labels at the Gmail thread level for conversation consistency
- Matches Front conversations to Gmail messages using RFC Message-ID only
- Batch processing with rate limiting
- Dry run mode for testing (no changes to Gmail)
- Progress tracking and detailed logging
- CSV report output per run (in `./reports`)

## Prerequisites

1. Node.js (v16 or higher)
2. Front API Key
3. Gmail API Access (OAuth 2.0 credentials)

## Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Configure Front API

1. Log in to Front
2. Go to Settings > Developers > API tokens
3. Create a new API token with read access
4. Copy the token

### 3) Configure Gmail API

1. Go to https://console.cloud.google.com/
2. Create a new project or select an existing one
3. Enable the Gmail API:
   - Go to "APIs & Services" > "Library"
   - Search for "Gmail API"
   - Click "Enable"
4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Desktop app"
   - Download the credentials JSON file
5. Keep the file handy; you'll paste its contents when running the tool for the first time

### 4) Configure environment

Copy `.env.example` to `.env` and update values:

```bash
cp .env.example .env
```

`.env` keys:

```env
# Front API Configuration
FRONT_API_KEY=your_front_api_key_here
FRONT_API_BASE_URL=https://api2.frontapp.com

# Migration Settings
BATCH_SIZE=10              # Process 10 conversations at a time
DRY_RUN=true               # Set to false to make changes (omit to stay in dry run mode)
LOG_LEVEL=info             # error, warn, info, debug
SKIP_ARCHIVED=false        # true: skip archived Front conversations
FRONT_INBOX_ID=            # Optional: migrate only a specific Front inbox
```

## Usage

This tool now runs via the Electron app (no CLI run path).

- Start the app in development:

```bash
npm run electron
```

In the app:
- Configure secrets under Authentication (Front token and Google credentials stored in your OS keychain).
- Choose run options (Dry Run, Log Detail, optional Front Inbox).
- Click “Run Migration” to simulate or apply changes. A CSV report is written and can be opened from the UI.

## Documentation

- [Architecture overview](docs/architecture.md)
- [Data flow walkthrough](docs/data-flow.md)
- [Authentication & secret storage](docs/auth.md)
- [Electron UI notes](docs/electron-ui.md)
- [CSV reporting reference](docs/reports.md)
- [Build & release guide](docs/build-and-release.md)

## How It Works

### Label Mapping

Front tags are converted to Gmail labels with these rules:
- Non-reserved labels get a `Front/` prefix (e.g., `Important` -> `Front/Important`)
- Reserved Gmail system labels are prefixed with `Front-` (no slash), e.g.:
  - `INBOX` -> `Front-INBOX`
  - `SPAM` -> `Front-SPAM`
- Invalid characters (`/`, `\`) are replaced with `-`

### Message Matching

The tool matches Front conversations to Gmail messages using RFC Message-ID headers only. Conversations without a Message-ID are skipped.

### Archive Status

The tool does not modify Gmail's `INBOX` label. Instead, it adds one of these labels to reflect Front status:
- `Front/Status/Archived` when the Front conversation is archived
- `Front/Status/Inbox` when the Front conversation is unarchived

No Gmail system labels are altered. Labels are applied to the entire Gmail thread corresponding to the matched message.

## Safety Options

Matching is strictly Message-ID-only to minimize risk. There is no subject/participant/date fallback.

## Reporting

Each run produces a CSV at `./reports/migration-report-<timestamp>.csv` with columns:
- `frontConversationId`, `subject`, `createdAt`, `isArchived`
- `matchMethod` (`message-id` | `none`), `gmailResults`, `gmailMessageId`, `threadId`
- `labelsToAdd`, `labelsToRemove`, `action` (`applied` | `dry_run` | `skipped` | `no_match` | `failed`)
- `reason` (optional)

You can filter this file to audit changes or spot-check ambiguous/skipped items.

## Troubleshooting

### "No Gmail match found"
- The email was deleted from Gmail
- It is Front-only content (comments, notes)
- The email predates available Gmail history

### Rate Limiting
- Front API: 2 concurrent requests (with retries and backoff)
- Gmail API: 5 concurrent requests (with retries and backoff)
- Batch processing with short delays

### Authentication Issues
1. Remove the stored Gmail token from your system keychain
2. Run the tool again
3. Follow the browser prompts to re-authenticate

## Development

```bash
# Build TypeScript (Electron loads from dist/)
npm run build

# Launch the Electron app (builds first)
npm run electron
```

## Packaging (Electron)

The Electron UI can be packaged into platform-specific binaries using electron-builder.

Prerequisites:
- Install dev deps: `npm install` (ensures electron-builder is installed)

Build commands:
- macOS: `npm run dist:mac`
- Windows: `npm run dist:win`
- Linux: `npm run dist:linux`
- All platforms from current OS: `npm run dist`

Notes:
- Packaging runs `npm run build` first to compile TypeScript to `dist/`.
- Reports are saved to the app’s user data directory when packaged (visible via “Open Reports” in the UI).
- Code signing is not configured; generated artifacts are unsigned developer builds unless you add signing configuration.

### macOS Icon (squircle)

macOS does not auto-mask app icons; design your icon within a rounded “squircle” shape and keep the corners transparent. Two helpers are included:

Requirements:
- macOS with Xcode command line tools (`xcode-select --install`)
- ImageMagick for the squircle helper (`brew install imagemagick`)

1) Create a squircle-masked PNG (approximation) from your square art:

```bash
# From electron/logo.png → electron/logo-squircle.png (1024x1024)
bash scripts/make-squircle.sh

# Or specify input/output/size
bash scripts/make-squircle.sh input.png electron/logo-squircle.png 1024
```

2) Generate the .icns that macOS uses:

```bash
# From electron/logo-squircle.png → electron/icon.icns
bash scripts/make-icns.sh electron/logo-squircle.png electron/icon.icns
```

The build config points macOS to `electron/icon.icns`. If you update the icon, regenerate `.icns` and rebuild.

Advanced options (squircle helper):
- `SQUIRCLE_EXP` (default `5`): superellipse exponent. Higher = slightly squarer sides; lower = softer corners.
- `SQUIRCLE_AA` (no default): optional edge blur (e.g., `0.5`) to feather the mask.
- `SQUIRCLE_INNER` (default `0`): set to `1` to add a subtle inner shadow.
- `SQUIRCLE_INSET` (default `~6%` of size): inner shadow inset in pixels.
- `SQUIRCLE_ALPHA` (default `22`): inner shadow opacity 0–100.

Examples:
```bash
# Softer corners and slight feathering
SQUIRCLE_EXP=4 SQUIRCLE_AA=0.5 bash scripts/make-squircle.sh

# Enable a subtle inner shadow
SQUIRCLE_INNER=1 SQUIRCLE_ALPHA=18 SQUIRCLE_INSET=56 bash scripts/make-squircle.sh
```

### Signing & Notarization (macOS)

For distribution on macOS, sign and notarize to avoid Gatekeeper warnings.

1) Requirements
- Apple Developer account and a “Developer ID Application” certificate in your Keychain.
- Xcode command line tools installed.

2) Hardened runtime and entitlements
- Already configured in `package.json` build: hardened runtime enabled with entitlements at `electron/entitlements.mac.plist` and `electron/entitlements.mac.inherit.plist`.

3) Notarization credentials (choose one)
- App Store Connect API key (recommended):
  - Set env vars before running build:
    - `ASC_KEY_ID` – Key ID
    - `ASC_ISSUER_ID` – Issuer ID
    - `ASC_KEY_FILE` – Path to the `.p8` key file
- OR Apple ID + App-Specific Password:
  - `APPLE_ID` – your Apple ID email
  - `APPLE_APP_SPECIFIC_PASSWORD` – app-specific password for notarization
  - Optional: `APPLE_TEAM_ID`

4) Build

```bash
# Example with API key
ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_FILE=/path/to/AuthKey.p8 npm run dist:mac

# Or with Apple ID + app-specific password
APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=abcd-efgh-ijkl-mnop npm run dist:mac
```

Notes:
- Set `MAC_NOTARIZE=false` to skip notarization during local builds.
- You can keep using `electron/logo.png` as the icon; native `.icns/.ico` can be added later for best quality.

## App Behavior

- Closing the window (red X) quits the app. If a migration run is in progress, you’ll be prompted to confirm; confirming stops the run and quits.
- Cmd+Q or Quit from the menu behaves the same: prompts if a run is active, then stops and quits on confirmation.

## Important Notes

- Backup: Consider backing up important emails before migration
- Test First: Always do a dry run before the actual migration
- One-Way Sync: Migration is from Front to Gmail only
- No Deletion: The tool never deletes emails; it only adds/removes labels within the `Front/*` namespace
- Idempotent: Safe to re-run; existing labels are reused

## License

MIT
