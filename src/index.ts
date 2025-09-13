import { FrontClient } from './api/front';
import { GmailClient } from './api/gmail';
import { loadConfig } from './config';
import { ConversationMapper, MigrationItem } from './utils/mapper';
import { Logger } from './utils/logger';
import * as fs from 'fs/promises';

interface MigrationStats {
  total: number;
  processed: number;
  matched: number;
  labeled: number;
  archived: number;
  failed: number;
  skipped: number;
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
    archived: 0,
    failed: 0,
    skipped: 0,
  };

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
      this.config.google.tokenPath
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

      if (uniqueLabels.size > 0) {
        this.logger.info(`Creating/verifying ${uniqueLabels.size} labels in Gmail...`);
        const labelMap = await this.gmailClient.ensureLabels(Array.from(uniqueLabels));
        this.logger.info(`Labels ready: ${Array.from(labelMap.keys()).join(', ')}`);
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
            `Matched: ${this.stats.matched}, Labeled: ${this.stats.labeled}, Archived: ${this.stats.archived}`
          );
        }

        // Small delay between batches to avoid rate limits
        if (batchIndex < batches.length - 1) {
          await this.sleep(1000);
        }
      }

      // Step 5: Report results
      this.printSummary();

    } catch (error) {
      this.logger.error('Migration failed:', error);
      throw error;
    }
  }

  private async processMigrationItem(item: MigrationItem) {
    try {
      // Skip archived conversations if configured
      if (this.config.migration.skipArchived && item.isArchived) {
        this.logger.debug(`Skipping archived conversation: ${item.subject}`);
        this.stats.skipped++;
        return;
      }

      // Find corresponding Gmail message
      const query = ConversationMapper.buildGmailSearchQuery(item);
      this.logger.debug(`Searching Gmail with query: ${query}`);
      
      const messages = await this.gmailClient.searchMessages(query, 10);
      
      if (messages.length === 0) {
        this.logger.debug(`No Gmail match found for: ${item.subject}`);
        return;
      }

      this.stats.matched++;

      // Get the first message (most likely match)
      const gmailMessage = messages[0];
      this.logger.debug(`Found Gmail message: ${gmailMessage.id} for Front conversation: ${item.subject}`);

      if (this.config.migration.dryRun) {
        this.logger.info(`[DRY RUN] Would update message ${gmailMessage.id}:`);
        this.logger.info(`  - Add labels: ${item.labels.join(', ')}`);
        if (item.isArchived) {
          this.logger.info(`  - Archive (remove from INBOX)`);
        }
        return;
      }

      // Apply labels
      if (item.labels.length > 0) {
        const labelIds: string[] = [];
        for (const labelName of item.labels) {
          const label = await this.gmailClient.createLabel(labelName);
          labelIds.push(label.id);
        }
        
        await this.gmailClient.modifyMessage(
          gmailMessage.id,
          labelIds,
          []
        );
        this.stats.labeled++;
        this.logger.debug(`Applied ${labelIds.length} labels to message ${gmailMessage.id}`);
      }

      // Archive if needed
      if (item.isArchived) {
        await this.gmailClient.archiveMessage(gmailMessage.id);
        this.stats.archived++;
        this.logger.debug(`Archived message ${gmailMessage.id}`);
      }

    } catch (error) {
      this.logger.error(`Failed to process item: ${item.subject}`, error);
      this.stats.failed++;
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
    console.log(`Messages archived:      ${this.stats.archived}`);
    console.log(`Skipped:               ${this.stats.skipped}`);
    console.log(`Failed:                ${this.stats.failed}`);
    console.log('='.repeat(60));

    if (this.config.migration.dryRun) {
      console.log('\nThis was a DRY RUN - no changes were made to Gmail.');
      console.log('Set DRY_RUN=false in your .env file to perform the actual migration.');
    }
  }
}

// Main execution
async function main() {
  console.log('Front to Gmail Migration Tool');
  console.log('=============================\n');

  try {
    // Check for credentials file
    const config = loadConfig();
    try {
      await fs.access(config.google.credentialsPath);
    } catch {
      console.error(`\nError: Google credentials file not found at ${config.google.credentialsPath}`);
      console.error('\nTo set up Gmail API access:');
      console.error('1. Go to https://console.cloud.google.com/');
      console.error('2. Create a new project or select existing');
      console.error('3. Enable the Gmail API');
      console.error('4. Create OAuth 2.0 credentials (Desktop application)');
      console.error('5. Download the credentials.json file');
      console.error(`6. Place it at ${config.google.credentialsPath}`);
      console.error('\nFor detailed instructions, see:');
      console.error('https://developers.google.com/gmail/api/quickstart/nodejs');
      process.exit(1);
    }

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