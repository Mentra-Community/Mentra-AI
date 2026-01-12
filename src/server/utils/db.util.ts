import mongoose from 'mongoose';
import { logger as _logger } from '@mentra/sdk';

const logger = _logger.child({ service: 'Database' });

/**
 * Connect to MongoDB
 */
export async function connectToDatabase(): Promise<void> {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    logger.warn('MONGODB_URI not set, skipping database connection');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    logger.info('✅ Connected to MongoDB');
  } catch (error) {
    logger.error(error as Error, '❌ Failed to connect to MongoDB:');
    throw error;
  }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectFromDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  } catch (error) {
    logger.error(error as Error, 'Error disconnecting from MongoDB:');
  }
}

/**
 * Check if connected to MongoDB
 */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
