import { FrontConversation, FrontMessage } from '../api/front';

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
      sanitized = `Front-${sanitized}`;
    }
    
    // Add Front prefix to make it clear these came from Front
    if (!sanitized.startsWith('Front/')) {
      sanitized = `Front/${sanitized}`;
    }
    
    return sanitized;
  }

  static buildGmailSearchQuery(item: MigrationItem): string {
    const queries: string[] = [];
    
    // Search by RFC message ID if available
    if (item.gmailMessageId) {
      return `rfc822msgid:${item.gmailMessageId}`;
    }
    
    // Otherwise build a query based on other attributes
    if (item.subject && item.subject !== '(no subject)') {
      queries.push(`subject:"${item.subject}"`);
    }
    
    // Search by participants
    if (item.emailAddresses.length > 0) {
      const participantQuery = item.emailAddresses
        .slice(0, 3) // Limit to avoid query being too long
        .map(email => `(from:${email} OR to:${email})`)
        .join(' OR ');
      queries.push(`(${participantQuery})`);
    }
    
    // Add date range (within 1 day of Front conversation creation)
    const startDate = new Date(item.createdAt);
    startDate.setDate(startDate.getDate() - 1);
    const endDate = new Date(item.createdAt);
    endDate.setDate(endDate.getDate() + 1);
    
    const after = startDate.toISOString().split('T')[0];
    const before = endDate.toISOString().split('T')[0];
    queries.push(`after:${after} before:${before}`);
    
    return queries.join(' ');
  }
}