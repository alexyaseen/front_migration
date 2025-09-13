# Front to Gmail Migration Tool

A Node.js tool to migrate email labels and archive status from Front to Gmail. Since Front doesn't sync labels back to Gmail, this tool helps you organize your Gmail inbox to match your Front organization.

## Features

- Fetches all conversations from Front
- Maps Front tags to Gmail labels (with "Front/" prefix)
- Preserves archive status from Front
- Matches Front conversations to Gmail messages using:
  - RFC Message-ID headers (most accurate)
  - Subject, participants, and date range fallback
- Batch processing with rate limiting
- Dry run mode for testing
- Progress tracking and detailed logging

## Prerequisites

1. **Node.js** (v16 or higher)
2. **Front API Key**
3. **Gmail API Access** (OAuth 2.0 credentials)

## Setup

### 1. Clone and Install

```bash
npm install
```

### 2. Configure Front API

1. Log in to Front
2. Go to Settings ’ Developers ’ API tokens
3. Create a new API token with read access
4. Copy the token

### 3. Configure Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the Gmail API:
   - Go to "APIs & Services" ’ "Library"
   - Search for "Gmail API"
   - Click "Enable"
4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" ’ "Credentials"
   - Click "Create Credentials" ’ "OAuth client ID"
   - Choose "Desktop app" as application type
   - Download the credentials JSON file
5. Save the file as `credentials.json` in the project root

### 4. Configure Environment

Copy `.env.example` to `.env` and update:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Front API Configuration
FRONT_API_KEY=your_front_api_key_here
FRONT_API_BASE_URL=https://api2.frontapp.com

# Gmail API Configuration
GOOGLE_CREDENTIALS_PATH=./credentials.json
GOOGLE_TOKEN_PATH=./token.json

# Migration Settings
BATCH_SIZE=10              # Process 10 conversations at a time
DRY_RUN=true              # Set to false to actually make changes
LOG_LEVEL=info            # error, warn, info, or debug
SKIP_ARCHIVED=false       # Set to true to only process unarchived
FRONT_INBOX_ID=           # Optional: specific Front inbox ID
```

## Usage

### Test Run (Dry Run)

First, do a dry run to see what changes would be made:

```bash
npm run migrate
```

This will:
1. Authenticate with Gmail (first time only)
2. Fetch conversations from Front
3. Show what labels would be created
4. Show what messages would be updated
5. NOT make any actual changes

### Actual Migration

Once you're satisfied with the dry run results:

1. Set `DRY_RUN=false` in your `.env` file
2. Run the migration:

```bash
npm run migrate
```

## How It Works

### Label Mapping

Front tags are converted to Gmail labels with these rules:
- All labels get a "Front/" prefix (e.g., "Important" ’ "Front/Important")
- Invalid characters (`/`, `\`) are replaced with `-`
- Reserved Gmail labels are prefixed (e.g., "INBOX" ’ "Front-INBOX")

### Message Matching

The tool tries to match Front conversations to Gmail messages using:

1. **RFC Message-ID** (most accurate): Uses email headers when available
2. **Fallback Search**: Combines subject, participants, and date range

### Archive Status

If a conversation is archived in Front, the tool will:
- Remove the "INBOX" label from the Gmail message
- Keep all other labels intact

## Troubleshooting

### "No Gmail match found"

Some Front conversations might not match Gmail messages because:
- The email was deleted from Gmail
- It's a Front-only conversation (comments, notes)
- The email predates your Gmail account

### Rate Limiting

The tool implements automatic rate limiting:
- Front API: 2 concurrent requests
- Gmail API: 5 concurrent requests
- Batch processing with delays

### Authentication Issues

If Gmail authentication fails:
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

- **Backup**: Consider backing up important emails before migration
- **Test First**: Always do a dry run before the actual migration
- **One-Way Sync**: This tool migrates from Front to Gmail only
- **No Deletion**: The tool never deletes emails, only adds labels and archives
- **Idempotent**: Running multiple times is safe; existing labels won't be duplicated

## License

MIT