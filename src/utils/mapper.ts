import { FrontConversation, FrontMessage } from '../api/front';

export const STATUS_LABEL_ARCHIVED = 'Front/Status/Archived';
export const STATUS_LABEL_INBOX = 'Front/Status/Inbox';

export interface MigrationItem {
  frontConversationId: string;
  subject: string;
  isArchived: boolean;
  labels: string[];
  gmailMessageId?: string;
  emailAddresses: string[];
  createdAt: Date;
}

export class ConversationMapper {
  static mapConversation(conversation: FrontConversation): MigrationItem {
    const labels = conversation.tags.map(tag => this.sanitizeLabel(tag.name));
    const isArchived = conversation.status === 'archived';
    
    // Extract email addresses from messages
    const emailAddresses = new Set<string>();
    conversation.messages?.forEach(message => {
      if (message.type === 'email') {
        emailAddresses.add(message.from.handle);
        message.recipients?.forEach(recipient => {
          emailAddresses.add(recipient.handle);
        });
      }
    });

    // Try to find Gmail message ID from headers
    let gmailMessageId: string | undefined;
    const emailMessage = conversation.messages?.find(m => 
      m.type === 'email' && m.metadata?.headers?.['message-id']
    );
    
    if (emailMessage?.metadata?.headers?.['message-id']) {
      gmailMessageId = emailMessage.metadata.headers['message-id'];
      // Clean up message ID (remove angle brackets if present)
      gmailMessageId = gmailMessageId.replace(/^<|>$/g, '');
    }

    return {
      frontConversationId: conversation.id,
      subject: conversation.subject || '(no subject)',
      isArchived,
      labels,
      gmailMessageId,
      emailAddresses: Array.from(emailAddresses),
      createdAt: new Date(conversation.created_at),
    };
  }

  static sanitizeLabel(label: string): string {
    // Gmail label restrictions:
    // - Cannot contain: /, \
    // - Cannot start with: ^
    // - Cannot be exactly: INBOX, SPAM, TRASH, UNREAD, STARRED, IMPORTANT, SENT, DRAFT
    
    const reserved = ['INBOX', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT'];
    
    let sanitized = label
      .replace(/[/\\]/g, '-')  // Replace forward and back slashes
      .replace(/^\^/, '')       // Remove leading caret
      .trim();
    
    // If it's a reserved label, prefix it
    if (reserved.includes(sanitized.toUpperCase())) {
      // Reserved system labels get a hyphen prefix and no folder prefix
      return `Front-${sanitized}`;
    }

    // Add Front prefix to make it clear these came from Front
    if (!sanitized.startsWith('Front/')) {
      sanitized = `Front/${sanitized}`;
    }
    
    return sanitized;
  }
}
