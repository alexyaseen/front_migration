import { FrontClient } from './api/front';
import { GmailClient } from './api/gmail';
import { loadConfig } from './config';
import { ConversationMapper, MigrationItem, STATUS_LABEL_ARCHIVED, STATUS_LABEL_INBOX } from './utils/mapper';
import { Logger } from './utils/logger_ascii';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';

interface MigrationStats {
  total: number;
  processed: number;
  matched: number;
  labeled: number;
  statusArchived: number;
  statusInbox: number;
  failed: number;
  skipped: number;
}

interface ReportRow {
  frontConversationId: string;
  subject: string;
  createdAt: string;
  isArchived: boolean;
  matchMethod: 'message-id' | 'none';
  gmailResults: number;
  gmailMessageId?: string;
  threadId?: string;
  labelsToAdd: string[];
  labelsToRemove: string[];
  action: 'applied' | 'dry_run' | 'skipped' | 'no_match' | 'failed';
  reason?: string;
}

class FrontToGmailMigrator {
  private frontClient: FrontClient;
  private gmailClient!: GmailClient;
  private config = loadConfig();
  private logger: Logger;
  private stats: MigrationStats = {
    total: 0,
    processed: 0,
    matched: 0,
    labeled: 0,
    statusArchived: 0,
    statusInbox: 0,
    failed: 0,
    skipped: 0,
  };
  private report: ReportRow[] = [];

  constructor() {
    this.logger = new Logger('Migrator', this.config.migration.logLevel);
    this.frontClient = new FrontClient(
      this.config.front.apiKey,
      this.config.front.baseUrl
    );
  }

  async initialize() {
    this.logger.info('Initializing Gmail client...');
    this.gmailClient = await GmailClient.create(
      this.config.google.credentialsPath,
      this.config.google.tokenPath,
      this.config.migration.dryRun
    );
    this.logger.info('Gmail client initialized successfully');
  }

  async run() {
    try {
      await this.initialize();

      // Step 1: Fetch Front conversations
      this.logger.info('Fetching conversations from Front...');
      const conversations = await this.frontClient.getAllConversations(
        this.config.migration.inboxId
      );
      this.stats.total = conversations.length;
      this.logger.info(`Found ${conversations.length} conversations in Front`);

      // Step 2: Map conversations to migration items
      const migrationItems = conversations.map(conv => 
        ConversationMapper.mapConversation(conv)
      );

      // Step 3: Get unique labels and ensure they exist in Gmail
      const uniqueLabels = new Set<string>();
      migrationItems.forEach(item => {
        item.labels.forEach(label => uniqueLabels.add(label));
      });
      // Always include status labels
      uniqueLabels.add(STATUS_LABEL_ARCHIVED);
      uniqueLabels.add(STATUS_LABEL_INBOX);

      if (uniqueLabels.size > 0) {
        if (this.config.migration.dryRun) {
          this.logger.info(
            `[DRY RUN] Would create/verify ${uniqueLabels.size} labels in Gmail: ${Array.from(uniqueLabels).join(', ')}`
          );
        } else {
          this.logger.info(`Creating/verifying ${uniqueLabels.size} labels in Gmail...`);
          const labelMap = await this.gmailClient.ensureLabels(Array.from(uniqueLabels));
          this.logger.info(`Labels ready: ${Array.from(labelMap.keys()).join(', ')}`);
        }
      }

      // Step 4: Process each conversation
      this.logger.info('Starting migration...');
      if (this.config.migration.dryRun) {
        this.logger.warn('DRY RUN MODE - No changes will be made to Gmail');
      }

      const batches = this.createBatches(migrationItems, this.config.migration.batchSize);
      
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        this.logger.info(`Processing batch ${batchIndex + 1}/${batches.length}...`);
        
        for (const item of batch) {
          await this.processMigrationItem(item);
          this.stats.processed++;
          this.logger.progress(
            this.stats.processed,
            this.stats.total,
            `Matched: ${this.stats.matched}, Labeled: ${this.stats.labeled}, Status(Arch/In): ${this.stats.statusArchived}/${this.stats.statusInbox}`
          );
        }

        // Small delay between batches to avoid rate limits
        if (batchIndex < batches.length - 1) {
          await this.sleep(1000);
        }
      }

      // Step 5: Report results
      this.printSummary();
      await this.writeCsvReport();

    } catch (error) {
      this.logger.error('Migration failed:', error);
      throw error;
    }
  }

  private async processMigrationItem(item: MigrationItem) {
    try {
      // Require strict Message-ID match only; skip if missing
      if (!item.gmailMessageId) {
        this.logger.debug(`Skipping (missing Message-ID): ${item.subject}`);
        this.stats.skipped++;
        this.report.push({
          frontConversationId: item.frontConversationId,
          subject: item.subject,
          createdAt: item.createdAt.toISOString(),
          isArchived: item.isArchived,
          matchMethod: 'none',
          gmailResults: 0,
          labelsToAdd: [],
          labelsToRemove: [],
          action: 'skipped',
          reason: 'missing_message_id'
        });
        return;
      }
      // Skip archived conversations if configured
      if (this.config.migration.skipArchived && item.isArchived) {
        this.logger.debug(`Skipping archived conversation: ${item.subject}`);
        this.stats.skipped++;
        this.report.push({
          frontConversationId: item.frontConversationId,
          subject: item.subject,
          createdAt: item.createdAt.toISOString(),
          isArchived: item.isArchived,
          matchMethod: item.gmailMessageId ? 'message-id' : 'none',
          gmailResults: 0,
          labelsToAdd: [],
          labelsToRemove: [],
          action: 'skipped',
          reason: 'skip_archived=true'
        });
        return;
      }

      // Find corresponding Gmail message by RFC Message-ID only
      this.logger.debug(`Looking up Gmail by Message-ID: ${item.gmailMessageId}`);
      const gmailMessage = await this.gmailClient.getMessageByMessageId(item.gmailMessageId);
      if (!gmailMessage) {
        this.logger.debug(`No Gmail match found for: ${item.subject}`);
        this.report.push({
          frontConversationId: item.frontConversationId,
          subject: item.subject,
          createdAt: item.createdAt.toISOString(),
          isArchived: item.isArchived,
          matchMethod: 'message-id',
          gmailResults: 0,
          labelsToAdd: [],
          labelsToRemove: [],
          action: 'no_match'
        });
        return;
      }

      this.stats.matched++;
      this.logger.debug(`Found Gmail message: ${gmailMessage.id} (thread ${gmailMessage.threadId}) for Front conversation: ${item.subject}`);

      if (this.config.migration.dryRun) {
        this.logger.info(`[DRY RUN] Would update thread ${gmailMessage.threadId}:`);
        const statusLabel = item.isArchived ? STATUS_LABEL_ARCHIVED : STATUS_LABEL_INBOX;
        this.logger.info(`  - Add labels: ${[...item.labels, statusLabel].join(', ')}`);
        const opposite = item.isArchived ? STATUS_LABEL_INBOX : STATUS_LABEL_ARCHIVED;
        this.logger.info(`  - Remove labels: ${opposite}`);
        this.report.push({
          frontConversationId: item.frontConversationId,
          subject: item.subject,
          createdAt: item.createdAt.toISOString(),
          isArchived: item.isArchived,
          matchMethod: 'message-id',
          gmailResults: 1,
          gmailMessageId: gmailMessage.id,
          threadId: gmailMessage.threadId,
          labelsToAdd: [...item.labels, statusLabel],
          labelsToRemove: [opposite],
          action: 'dry_run'
        });
        return;
      }

      // Apply labels: Front tag labels + status label. Remove opposite status label.
      const statusLabel = item.isArchived ? STATUS_LABEL_ARCHIVED : STATUS_LABEL_INBOX;
      const oppositeStatusLabel = item.isArchived ? STATUS_LABEL_INBOX : STATUS_LABEL_ARCHIVED;

      const addLabelIds: string[] = [];
      for (const labelName of [...item.labels, statusLabel]) {
        const label = await this.gmailClient.createLabel(labelName);
        addLabelIds.push(label.id);
      }

      const removeLabelIds: string[] = [];
      // Ensure the opposite status label exists to remove if present
      const oppositeLabel = await this.gmailClient.createLabel(oppositeStatusLabel);
      removeLabelIds.push(oppositeLabel.id);

      await this.gmailClient.modifyThread(
        gmailMessage.threadId,
        addLabelIds,
        removeLabelIds
      );
      this.stats.labeled += addLabelIds.length;
      if (item.isArchived) this.stats.statusArchived++; else this.stats.statusInbox++;
      this.logger.debug(`Applied ${addLabelIds.length} labels to thread ${gmailMessage.threadId} (removed opposite status label if present).`);
      this.report.push({
        frontConversationId: item.frontConversationId,
        subject: item.subject,
        createdAt: item.createdAt.toISOString(),
        isArchived: item.isArchived,
        matchMethod: 'message-id',
        gmailResults: 1,
        gmailMessageId: gmailMessage.id,
        threadId: gmailMessage.threadId,
        labelsToAdd: [...item.labels, statusLabel],
        labelsToRemove: [oppositeStatusLabel],
        action: 'applied'
      });

    } catch (error) {
      this.logger.error(`Failed to process item: ${item.subject}`, error);
      this.stats.failed++;
      this.report.push({
        frontConversationId: item.frontConversationId,
        subject: item.subject,
        createdAt: item.createdAt.toISOString(),
        isArchived: item.isArchived,
        matchMethod: item.gmailMessageId ? 'message-id' : 'none',
        gmailResults: 0,
        labelsToAdd: [],
        labelsToRemove: [],
        action: 'failed',
        reason: (error as Error)?.message || 'unknown'
      });
    }
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total conversations:     ${this.stats.total}`);
    console.log(`Processed:              ${this.stats.processed}`);
    console.log(`Matched in Gmail:       ${this.stats.matched}`);
    console.log(`Labels applied:         ${this.stats.labeled}`);
    console.log(`Status labeled (Arch/In): ${this.stats.statusArchived}/${this.stats.statusInbox}`);
    console.log(`Skipped:               ${this.stats.skipped}`);
    console.log(`Failed:                ${this.stats.failed}`);
    console.log('='.repeat(60));

    if (this.config.migration.dryRun) {
      console.log('\nThis was a DRY RUN - no changes were made to Gmail.');
      console.log('Set DRY_RUN=false in your .env file to perform the actual migration.');
    }
  }

  private async writeCsvReport() {
    try {
      const dir = path.resolve(process.cwd(), 'reports');
      await fs.mkdir(dir, { recursive: true });
      const filename = `migration-report-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      const filePath = path.join(dir, filename);

      const headers = [
        'frontConversationId', 'subject', 'createdAt', 'isArchived', 'matchMethod', 'gmailResults', 'gmailMessageId', 'threadId', 'labelsToAdd', 'labelsToRemove', 'action', 'reason'
      ];

      const escape = (val: any): string => {
        if (val === undefined || val === null) return '';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      const rows = this.report.map(r => [
        r.frontConversationId,
        r.subject,
        r.createdAt,
        r.isArchived,
        r.matchMethod,
        r.gmailResults,
        r.gmailMessageId || '',
        r.threadId || '',
        (r.labelsToAdd || []).join(';'),
        (r.labelsToRemove || []).join(';'),
        r.action,
        r.reason || ''
      ]);

      const csv = [headers.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\n');
      await fs.writeFile(filePath, csv, 'utf8');
      this.logger.info(`CSV report written to ${filePath}`);
    } catch (err) {
      this.logger.error('Failed to write CSV report', err as any);
    }
  }
}

// Main execution
async function main() {
  console.log('Front to Gmail Migration Tool');
  console.log('=============================\n');

  try {
    await ensureInteractiveSetup();

    // Load final config after setup
    const config = loadConfig();

    const migrator = new FrontToGmailMigrator();
    await migrator.run();

    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('\nMigration failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main();
}

// --------------- Interactive Setup Helpers ---------------
async function ensureInteractiveSetup() {
  // 1) Front API token: try env, then front_token.json, else prompt
  if (!process.env.FRONT_API_KEY) {
    const frontTokenPath = path.resolve(process.cwd(), 'front_token.json');
    const token = await readFrontToken(frontTokenPath);
    if (token) {
      process.env.FRONT_API_KEY = token;
    } else {
      const entered = await prompt(`Enter your Front API token (read-only): `);
      if (!entered || !entered.trim()) {
        throw new Error('Front API token is required to proceed.');
      }
      process.env.FRONT_API_KEY = entered.trim();
      await fs.writeFile(frontTokenPath, JSON.stringify({ token: process.env.FRONT_API_KEY }, null, 2), 'utf8');
      console.log(`[INFO] Saved Front token to ${frontTokenPath}`);
    }
  }

  // 2) Google credentials: if missing, prompt to paste JSON and write file
  const credsPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
  const absCredsPath = path.isAbsolute(credsPath) ? credsPath : path.resolve(process.cwd(), credsPath);
  const exists = await fileExists(absCredsPath);
  if (!exists) {
    console.log('Google credentials file not found.');
    console.log('Paste your OAuth 2.0 credentials JSON (Desktop application) below, then press Enter:');
    const json = await promptMultiline('JSON> ');
    let parsed: any;
    try {
      parsed = JSON.parse(json);
      if (!parsed?.installed?.client_id || !parsed?.installed?.client_secret || !parsed?.installed?.redirect_uris) {
        throw new Error('Invalid credentials: expected installed.client_id/client_secret/redirect_uris');
      }
    } catch (e) {
      throw new Error(`Invalid JSON for Google credentials: ${(e as Error).message}`);
    }
    await fs.writeFile(absCredsPath, JSON.stringify(parsed, null, 2), 'utf8');
    console.log(`[INFO] Wrote Google credentials to ${absCredsPath}`);
  }
}

async function readFrontToken(filePath: string): Promise<string | null> {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const json = JSON.parse(data);
    return typeof json?.token === 'string' ? json.token : null;
  } catch {
    return null;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function promptMultiline(promptText: string): Promise<string> {
  // Simple one-line read that accepts full JSON on a single line; if users paste multi-line,
  // many terminals will still deliver it; we capture until an empty line.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];
  console.log('(Finish input with an empty line)');
  rl.setPrompt(promptText);
  rl.prompt();
  return new Promise(resolve => {
    rl.on('line', (line) => {
      if (line.trim() === '') {
        rl.close();
      } else {
        lines.push(line);
        rl.prompt();
      }
    });
    rl.on('close', () => resolve(lines.join('\n')));
  });
}
