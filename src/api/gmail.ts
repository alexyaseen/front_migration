import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import { authenticate } from '@google-cloud/local-auth';
import pLimit from 'p-limit';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { SecureStore, GoogleToken } from '../utils/secureStore';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload?: gmail_v1.Schema$MessagePart;
  internalDate?: string;
}

export class GmailClient {
  private gmail: gmail_v1.Gmail;
  private auth: OAuth2Client;
  private limit: ReturnType<typeof pLimit>;
  private labelCache: Map<string, GmailLabel> = new Map();
  private readOnly: boolean;

  constructor(auth: OAuth2Client, readOnly: boolean = false) {
    this.auth = auth;
    this.gmail = google.gmail({ version: 'v1', auth });
    this.limit = pLimit(5); // Gmail API rate limit friendly
    this.readOnly = readOnly;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetriableError(error: any): boolean {
    const status = error?.code || error?.response?.status;
    const errors = error?.errors || error?.response?.data?.error?.errors;
    const reason = Array.isArray(errors) ? errors[0]?.reason : undefined;
    if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return true;
    if (status && status >= 500) return true;
    return false;
  }

  private async withRetry<T>(fn: () => Promise<T>, description: string, maxAttempts = 3, baseDelayMs = 500): Promise<T> {
    let attempt = 0;
    let lastError: any;
    while (attempt < maxAttempts) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        attempt++;
        if (attempt >= maxAttempts || !this.isRetriableError(err)) {
          throw err;
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  static async create(
    credentialsPath: string,
    tokenPath: string,
    readonly: boolean = false
  ): Promise<GmailClient> {
    let auth: OAuth2Client;

    try {
      const tokenContent = await fs.readFile(tokenPath, 'utf-8');
      const token = JSON.parse(tokenContent);
      const credentialsContent = await fs.readFile(credentialsPath, 'utf-8');
      const credentials = JSON.parse(credentialsContent);

      auth = new google.auth.OAuth2(
        credentials.installed.client_id,
        credentials.installed.client_secret,
        credentials.installed.redirect_uris[0]
      );
      auth.setCredentials(token);
    } catch (error) {
      console.log('Token not found or invalid, authenticating...');
      const scopes = readonly
        ? ['https://www.googleapis.com/auth/gmail.readonly']
        : [
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.labels',
          ];
      auth = await authenticate({
        scopes,
        keyfilePath: credentialsPath,
      });

      const token = auth.credentials;
      await fs.writeFile(tokenPath, JSON.stringify(token, null, 2));
      console.log('Token saved to', tokenPath);
    }

    return new GmailClient(auth, readonly);
  }

  async getLabels(): Promise<GmailLabel[]> {
    const response = await this.withRetry(
      () => this.gmail.users.labels.list({ userId: 'me' }),
      'labels.list'
    );
    const labels = response.data.labels || [];
    
    labels.forEach(label => {
      if (label.id && label.name) {
        this.labelCache.set(label.name.toLowerCase(), {
          id: label.id,
          name: label.name,
          type: label.type as 'system' | 'user',
        });
      }
    });

    return labels as GmailLabel[];
  }

  private ensureWritable(operation: string) {
    if (this.readOnly) {
      throw new Error(`Blocked write: ${operation} while in read-only (dry run) mode`);
    }
  }

  async createLabel(name: string): Promise<GmailLabel> {
    this.ensureWritable('labels.create');
    const existing = this.labelCache.get(name.toLowerCase());
    if (existing) {
      return existing;
    }

    try {
      const response = await this.withRetry(
        () => this.gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
          },
        }),
        'labels.create'
      );

      const label: GmailLabel = {
        id: response.data.id!,
        name: response.data.name!,
        type: 'user',
      };

      this.labelCache.set(name.toLowerCase(), label);
      return label;
    } catch (error: any) {
      if (error.code === 409) {
        // Label already exists, fetch it
        await this.getLabels();
        const existing = this.labelCache.get(name.toLowerCase());
        if (existing) return existing;
      }
      throw error;
    }
  }

  async ensureLabels(names: string[]): Promise<Map<string, string>> {
    this.ensureWritable('labels.ensure');
    await this.getLabels();
    const labelMap = new Map<string, string>();

    for (const name of names) {
      const label = await this.createLabel(name);
      labelMap.set(name, label.id);
    }

    return labelMap;
  }

  async searchMessages(query: string, maxResults: number = 500): Promise<GmailMessage[]> {
    const messages: GmailMessage[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(
        () => this.limit(() => this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: Math.min(maxResults - messages.length, 100),
          pageToken,
        })),
        'messages.list'
      );

      if (response.data.messages) {
        messages.push(...(response.data.messages as GmailMessage[]));
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && messages.length < maxResults);

    return messages;
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    const response = await this.withRetry(
      () => this.limit(() => this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
      })),
      'messages.get'
    );

    return response.data as GmailMessage;
  }

  async getMessageByMessageId(messageId: string): Promise<GmailMessage | null> {
    const query = `rfc822msgid:${messageId}`;
    const messages = await this.searchMessages(query, 1);
    
    if (messages.length > 0) {
      return await this.getMessage(messages[0].id);
    }
    
    return null;
  }

  async modifyMessage(
    messageId: string,
    addLabelIds: string[],
    removeLabelIds: string[] = []
  ): Promise<void> {
    this.ensureWritable('messages.modify');
    await this.withRetry(
      () => this.limit(() => this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds,
          removeLabelIds,
        },
      })),
      'messages.modify'
    );
  }

  async modifyThread(
    threadId: string,
    addLabelIds: string[],
    removeLabelIds: string[] = []
  ): Promise<void> {
    this.ensureWritable('threads.modify');
    await this.withRetry(
      () => this.limit(() => this.gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        requestBody: {
          addLabelIds,
          removeLabelIds,
        },
      })),
      'threads.modify'
    );
  }

  async batchModifyMessages(
    messageIds: string[],
    addLabelIds: string[],
    removeLabelIds: string[] = []
  ): Promise<void> {
    this.ensureWritable('messages.batchModify');
    if (messageIds.length === 0) return;

    const chunks = [];
    for (let i = 0; i < messageIds.length; i += 1000) {
      chunks.push(messageIds.slice(i, i + 1000));
    }

    for (const chunk of chunks) {
      await this.withRetry(
        () => this.limit(() => this.gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: chunk,
            addLabelIds,
            removeLabelIds,
          },
        })),
        'messages.batchModify'
      );
    }
  }

  async archiveMessage(messageId: string): Promise<void> {
    this.ensureWritable('messages.archive');
    await this.modifyMessage(messageId, [], ['INBOX']);
  }

  async archiveMessages(messageIds: string[]): Promise<void> {
    this.ensureWritable('messages.archiveMany');
    await this.batchModifyMessages(messageIds, [], ['INBOX']);
  }
}

// Keychain-based Gmail client factory and helpers (no file storage)
export async function createGmailClientWithKeychain(store: SecureStore, readonly: boolean = false): Promise<GmailClient> {
  // Log selected Gmail scopes based on mode for operator visibility
  const scopesMsg = readonly
    ? 'https://www.googleapis.com/auth/gmail.readonly'
    : 'https://www.googleapis.com/auth/gmail.modify, https://www.googleapis.com/auth/gmail.labels';
  console.log(`[INFO] [Gmail] Using scopes: ${scopesMsg}`);
  const creds = await store.getGoogleCredentials();
  if (!creds) {
    throw new Error('Google credentials not found in keychain. Run the tool to complete interactive setup.');
  }

  const redirectUri = await getLoopbackRedirectUri();
  const oAuth2Client = new google.auth.OAuth2(
    creds.installed.client_id,
    creds.installed.client_secret,
    redirectUri,
  );

  const saved = await store.getGoogleToken();
  if (saved) {
    oAuth2Client.setCredentials(saved as any);
    return new GmailClient(oAuth2Client, readonly);
  }

  const scopes = readonly
    ? ['https://www.googleapis.com/auth/gmail.readonly']
    : [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.labels',
      ];

  const { code } = await runLoopbackOAuth(oAuth2Client, scopes, redirectUri);
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  await store.setGoogleToken(tokens as GoogleToken);
  return new GmailClient(oAuth2Client, readonly);
}

async function getLoopbackRedirectUri(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}/oauth2callback`;
  server.close();
  return url;
}

async function runLoopbackOAuth(
  oAuth2Client: OAuth2Client,
  scopes: string[],
  redirectUri: string,
): Promise<{ code: string }> {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    include_granted_scopes: true,
    redirect_uri: redirectUri,
  });

  const server = createServer((req, res) => {
    if (!req.url) return;
    const u = new URL(req.url, redirectUri);
    if (u.pathname !== '/oauth2callback') {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const code = u.searchParams.get('code');
    if (!code) {
      res.statusCode = 400;
      res.end('Missing code');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<html><body><h3>Authorization complete. You can close this window.</h3></body></html>');
    (server as any)._code = code;
    setImmediate(() => server.close());
  });
  await new Promise<void>((resolve) => server.listen(Number(new URL(redirectUri).port), '127.0.0.1', resolve));

  await openInBrowser(authUrl);

  const code: string = await new Promise((resolve, reject) => {
    const onClose = () => {
      const c = (server as any)._code;
      if (c) resolve(c);
      else reject(new Error('OAuth flow did not capture an authorization code.'));
    };
    server.on('close', onClose);
    server.on('error', (err) => reject(err));
  });

  return { code };
}

async function openInBrowser(url: string): Promise<void> {
  try {
    await execAsync(`open "${url}"`);
  } catch {
    try {
      await execAsync(`xdg-open "${url}"`);
    } catch {
      try {
        await execAsync(`start "" "${url}"`);
      } catch {
        console.log('Open this URL in your browser to continue:', url);
      }
    }
  }
}
