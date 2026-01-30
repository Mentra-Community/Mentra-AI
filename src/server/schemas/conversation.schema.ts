import { Schema, model, Document } from 'mongoose';

// Individual message in a conversation
export interface IMessage {
  id: string; // Unique message ID (e.g., "msg_1737234567890")
  messageNumber: number; // Sequential message number (1, 2, 3, ...) for easy UI ordering
  role: 'user' | 'assistant';
  content: string;
  photoTimestamp?: number; // Unix timestamp of when the photo was taken (if any)
  timestamp: Date;
}

// A single conversation/chat - one per day per user
export interface IConversation extends Document {
  userId: string;
  date: string; // Format: 'YYYY-MM-DD' - used as the "folder" name
  title: string; // Auto-generated from date, e.g., "January 18, 2026"
  messages: IMessage[];
  hasUnread: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    id: {
      type: String,
      required: true,
    },
    messageNumber: {
      type: Number,
      required: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    photoTimestamp: {
      type: Number,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const conversationSchema = new Schema<IConversation>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    hasUnread: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying - one conversation per user per day
conversationSchema.index({ userId: 1, date: 1 }, { unique: true });
// Index for listing conversations sorted by date
conversationSchema.index({ userId: 1, date: -1 });

export const Conversation = model<IConversation>('Conversation', conversationSchema);
