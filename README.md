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
5. Save the file as `credentials.json` in the project root

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

# Gmail API Configuration
GOOGLE_CREDENTIALS_PATH=./credentials.json
GOOGLE_TOKEN_PATH=./token.json

# Migration Settings
BATCH_SIZE=10              # Process 10 conversations at a time
DRY_RUN=true               # Set to false to make changes
LOG_LEVEL=info             # error, warn, info, debug
SKIP_ARCHIVED=false        # true: skip archived Front conversations
FRONT_INBOX_ID=            # Optional: migrate only a specific Front inbox
```

## Usage

### Test Run (Dry Run)

Run a dry run to preview changes:

```bash
npm run migrate
```

This will:
1. Authenticate with Gmail (first run creates `token.json`)
2. Fetch conversations from Front
3. Show what labels would be created (without creating them)
4. Show what messages would be updated
5. NOT make any actual changes
6. Produce a CSV report in `./reports`

### Actual Migration

When satisfied with the dry run:

1. Set `DRY_RUN=false` in `.env`
2. Run the migration:

```bash
npm run migrate
```

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
1. Delete `token.json`
2. Run the tool again
3. Follow the browser prompts to re-authenticate

## Development

```bash
# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run compiled version
npm start
```

## Important Notes

- Backup: Consider backing up important emails before migration
- Test First: Always do a dry run before the actual migration
- One-Way Sync: Migration is from Front to Gmail only
- No Deletion: The tool never deletes emails; it only adds/removes labels within the `Front/*` namespace
- Idempotent: Safe to re-run; existing labels are reused

## License

MIT
