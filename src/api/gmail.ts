import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import { authenticate } from '@google-auth-library/local-auth';
import pLimit from 'p-limit';

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

  constructor(auth: OAuth2Client) {
    this.auth = auth;
    this.gmail = google.gmail({ version: 'v1', auth });
    this.limit = pLimit(5); // Gmail API rate limit friendly
  }

  static async create(credentialsPath: string, tokenPath: string): Promise<GmailClient> {
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
      auth = await authenticate({
        scopes: [
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.labels',
        ],
        keyfilePath: credentialsPath,
      });
      
      const token = auth.credentials;
      await fs.writeFile(tokenPath, JSON.stringify(token, null, 2));
      console.log('Token saved to', tokenPath);
    }

    return new GmailClient(auth);
  }

  async getLabels(): Promise<GmailLabel[]> {
    const response = await this.gmail.users.labels.list({ userId: 'me' });
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

  async createLabel(name: string): Promise<GmailLabel> {
    const existing = this.labelCache.get(name.toLowerCase());
    if (existing) {
      return existing;
    }

    try {
      const response = await this.gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });

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
      const response = await this.limit(() =>
        this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: Math.min(maxResults - messages.length, 100),
          pageToken,
        })
      );

      if (response.data.messages) {
        messages.push(...(response.data.messages as GmailMessage[]));
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && messages.length < maxResults);

    return messages;
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    const response = await this.limit(() =>
      this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
      })
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
    await this.limit(() =>
      this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds,
          removeLabelIds,
        },
      })
    );
  }

  async batchModifyMessages(
    messageIds: string[],
    addLabelIds: string[],
    removeLabelIds: string[] = []
  ): Promise<void> {
    if (messageIds.length === 0) return;

    const chunks = [];
    for (let i = 0; i < messageIds.length; i += 1000) {
      chunks.push(messageIds.slice(i, i + 1000));
    }

    for (const chunk of chunks) {
      await this.limit(() =>
        this.gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: chunk,
            addLabelIds,
            removeLabelIds,
          },
        })
      );
    }
  }

  async archiveMessage(messageId: string): Promise<void> {
    await this.modifyMessage(messageId, [], ['INBOX']);
  }

  async archiveMessages(messageIds: string[]): Promise<void> {
    await this.batchModifyMessages(messageIds, [], ['INBOX']);
  }
}