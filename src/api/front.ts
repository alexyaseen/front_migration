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

  async getInboxes() {
    const response = await this.client.get('/inboxes');
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

    const response = await this.limit(() => 
      this.client.get(url, { params })
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
    const response = await this.limit(() =>
      this.client.get(`/conversations/${conversationId}/messages`)
    );
    return response.data._results;
  }

  async getTags(): Promise<FrontTag[]> {
    const response = await this.client.get('/tags');
    return response.data._results;
  }
}