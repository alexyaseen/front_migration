# Reporting

Every migration run emits a CSV file that captures the decision made for each Front conversation. This file is meant for auditing, reconciliation, and troubleshooting.

## Location

- **Development** – Written to `<repo>/reports` (created automatically if missing).
- **Packaged app** – Written to `<userData>/reports` (platform-specific Electron application data folder). The path is also exposed via the **Open Reports** button in the UI.
- Override the destination by setting `REPORTS_DIR` in the environment before launching the runtime or via the Electron main process (already set automatically).

## Filename

`migration-report-<ISO8601 timestamp>.csv` where the timestamp uses ISO format with colon and dot characters replaced by dashes (safe for all filesystems).

## Columns

| Column | Description |
| --- | --- |
| `frontConversationId` | Front conversation identifier. |
| `subject` | Conversation subject or `(no subject)` if empty. |
| `createdAt` | ISO string of the conversation's `created_at` timestamp. |
| `isArchived` | Boolean indicating Front archive status. |
| `matchMethod` | Either `message-id` (looked up in Gmail) or `none` (no ID available). |
| `gmailResults` | Number of Gmail messages returned for the lookup (0 or 1 today). |
| `gmailMessageId` | Gmail message ID when a match is found. |
| `threadId` | Gmail thread ID used for label modifications. |
| `labelsToAdd` | Semicolon-delimited list of planned labels (Front tags + status label). |
| `labelsToRemove` | Semicolon-delimited list of labels scheduled for removal (opposite status label). |
| `action` | Outcome enum: `applied`, `dry_run`, `skipped`, `no_match`, or `failed`. |
| `reason` | Optional explanation (e.g., `missing_message_id`, `skip_archived=true`, or error messages). |

Values are CSV-escaped (surrounded with quotes, internal quotes doubled). Empty optional fields are rendered as empty strings.

## Dry Run vs Live

- **Dry run** – `action` becomes `dry_run`; labels are listed but not applied. `gmailResults` still reflects lookup success.
- **Live run** – `action` is `applied` for successful label updates. The `labelsToAdd`/`labelsToRemove` columns capture the label names that were added or removed.

## Usage Tips

- Filter by `action` to quickly review skipped or failed conversations.
- Audit archive transitions by filtering on `labelsToAdd` containing `Front/Status/Archived`.
- Join with Front exports (via `frontConversationId`) to cross-reference metadata not pulled during the run.
- When investigating failures, check the console log (captured in the UI) for stack traces matching the `reason` column.
