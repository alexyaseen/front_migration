import axios, { AxiosInstance } from 'axios';
import pLimit from 'p-limit';

export interface FrontConversation {
  id: string;
  subject: string;
  status: 'archived' | 'unarchived' | 'deleted' | 'spam';
  tags: FrontTag[];
  messages: FrontMessage[];
  created_at: number;
  updated_at: number;
}

export interface FrontTag {
  id: string;
  name: string;
}

export interface FrontMessage {
  id: string;
  type: 'email' | 'sms' | 'custom';
  subject: string;
  body: string;
  text: string;
  recipients: FrontRecipient[];
  from: FrontRecipient;
  created_at: number;
  is_inbound: boolean;
  metadata?: {
    headers?: {
      'message-id'?: string;
      'in-reply-to'?: string;
      references?: string;
    };
  };
}

export interface FrontRecipient {
  handle: string;
  name?: string;
}

export class FrontClient {
  private client: AxiosInstance;
  private limit: ReturnType<typeof pLimit>;

  constructor(apiKey: string, baseUrl: string = 'https://api2.frontapp.com') {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    this.limit = pLimit(2); // Front API rate limit friendly
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetriableError(error: any): boolean {
    const status = error?.response?.status;
    const code = error?.code;
    if (status === 429) return true;
    if (status && status >= 500) return true;
    if (code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return true;
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
          const status = err?.response?.status;
          if (status === 401) {
            const msg = err?.response?.data?._error?.message || 'Unauthorized';
            const e = new Error(`FRONT_AUTH_401: ${msg}`);
            (e as any).cause = err;
            throw e;
          }
          throw err;
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
        // Simple jitter
        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  async getInboxes() {
    const response = await this.withRetry(() => this.client.get('/inboxes'), 'getInboxes');
    return response.data._results;
  }

  async getConversations(inboxId?: string, page: string | null = null): Promise<{
    conversations: FrontConversation[];
    nextPage: string | null;
  }> {
    const url = inboxId 
      ? `/inboxes/${inboxId}/conversations`
      : '/conversations';
    
    const params: any = {
      limit: 100,
      include_messages: true,
    };

    if (page) {
      params.page_token = page;
    }

    const response = await this.withRetry(
      () => this.limit(() => this.client.get(url, { params })),
      'getConversations'
    );

    return {
      conversations: response.data._results,
      nextPage: response.data._pagination?.next || null,
    };
  }

  async getAllConversations(inboxId?: string): Promise<FrontConversation[]> {
    const allConversations: FrontConversation[] = [];
    let nextPage: string | null = null;

    do {
      const { conversations, nextPage: next } = await this.getConversations(inboxId, nextPage);
      allConversations.push(...conversations);
      nextPage = next;
      
      if (nextPage) {
        console.log(`Fetched ${allConversations.length} conversations...`);
      }
    } while (nextPage);

    return allConversations;
  }

  async getConversationMessages(conversationId: string): Promise<FrontMessage[]> {
    const response = await this.withRetry(
      () => this.limit(() => this.client.get(`/conversations/${conversationId}/messages`)),
      'getConversationMessages'
    );
    return response.data._results;
  }

  async getTags(): Promise<FrontTag[]> {
    const response = await this.withRetry(() => this.client.get('/tags'), 'getTags');
    return response.data._results;
  }
}
