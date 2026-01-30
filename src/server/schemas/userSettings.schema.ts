import { Schema, model, Document } from 'mongoose';

export interface IUserSettings extends Document {
  userId: string;
  textModel: string;
  visionModel: string;
  personality: 'default' | 'professional' | 'friendly' | 'candid' | 'quirky' | 'efficient';
  theme: 'light' | 'dark';
  followUpEnabled: boolean;
  chatHistoryEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSettingsSchema = new Schema<IUserSettings>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    textModel: {
      type: String,
      default: 'GPT-4.1-mini',
    },
    visionModel: {
      type: String,
      default: 'Gemini Flash Latest',
    },
    personality: {
      type: String,
      enum: ['default', 'professional', 'friendly', 'candid', 'quirky', 'efficient'],
      default: 'default',
    },
    theme: {
      type: String,
      enum: ['light', 'dark'],
      default: 'light',
    },
    followUpEnabled: {
      type: Boolean,
      default: false,
    },
    chatHistoryEnabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export const UserSettings = model<IUserSettings>('UserSettings', userSettingsSchema);
