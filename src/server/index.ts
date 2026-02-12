import path from 'path';
import {
  AppSession,
  AppServer, PhotoData,
  GIVE_APP_CONTROL_OF_TOOL_RESPONSE,
  logger as _logger,
  AuthenticatedRequest
} from '@mentra/sdk';
import { MiraAgent } from './agents';
import { connectToDatabase } from './utils';
import { getAllToolsForUser } from './agents/tools/TpaTool';
import { log } from 'console';
// import { Anim } from './utils/anim';
import { ChatManager } from './manager/chat.manager';
import express from 'express';
import { ChatAPI, DatabaseAPI } from './api';
import { createChatRoutes, createTranscriptionRoutes, createDbRoutes } from './routes';
import { explicitWakeWords, cancellationPhrases, visionKeywords } from './constant/wakeWords';
import { SSEManager, createTranscriptionBroadcaster } from './manager/broadcast.manager';
import { TranscriptionManager, getCleanServerUrl } from './manager/transcription.manager';
import { notificationsManager } from './manager/notifications.manager';
import { createTranscriptionStream } from '@mentra/sdk';
import { UserSettings } from './schemas';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 80;
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const AUGMENTOS_API_KEY = process.env.AUGMENTOS_API_KEY;
const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_TOKEN;
const PROCESSING_SOUND_URL = process.env.PROCESSING_SOUND_URL;
const START_LISTENING_SOUND_URL = process.env.START_LISTENING_SOUND_URL;
const CANCEL_MIRA_SOUND_URL = process.env.CANCEL_MIRA_SOUND_URL;
 
// const PROCESSING_SOUND_URL = "https://mira.augmentos.cloud/popping.mp3";
// const PROCESSING_SOUND_URL = "https://general.dev.tpa.ngrok.app/mira-loading.wav";
// const PROCESSING_SOUND_URL = "https://general.dev.tpa.ngrok.app/mira-loading.wav";


// const START_LISTENING_SOUND_URL = "https://mira.augmentos.cloud/start.mp3";
// const START_LISTENING_SOUND_URL = "https://general.dev.tpa.ngrok.app/mira-on-v2.wav";

// const CANCEL_MIRA_SOUND_URL = "https://general.dev.tpa.ngrok.app/mira-off.wav";


if (!AUGMENTOS_API_KEY) {
  throw new Error('AUGMENTOS_API_KEY is not set');
}

if (!PACKAGE_NAME) {
  throw new Error('PACKAGE_NAME is not set');
}

const logger = _logger.child({app: PACKAGE_NAME});
logger.info(`🚀🚀🚀 Starting ${PACKAGE_NAME} server on port ${PORT}... 🚀🚀🚀`);

// Debug: Log BetterStack token status
const bsToken = process.env.BETTERSTACK_SOURCE_TOKEN;
const bsEndpoint = process.env.BETTERSTACK_ENDPOINT || "https://s1311181.eu-nbg-2.betterstackdata.com";
logger.info({ hasToken: !!bsToken, endpoint: bsEndpoint }, `📊 BetterStack Configuration Check`);

/**
 * Main Mira TPA server class
 */
class MiraServer extends AppServer {
  private transcriptionManagers = new Map<string, TranscriptionManager>();
  private userIdToSessionId = new Map<string, string>(); // Map userId to sessionId for settings updates
  private agentPerSession = new Map<string, MiraAgent>();
  private agentPerUser = new Map<string, MiraAgent>(); // Persistent agents per user
  private chatManager: ChatManager;
  private transcriptionSSEManager = new SSEManager(); // Manages transcription SSE connections
  private dbAPI: DatabaseAPI; // Database API for user settings

  constructor(options: any) {
    super(options);
    // Initialize ChatManager with server URL
    const serverUrl = process.env.SERVER_URL || 'http://localhost:8040';
    this.chatManager = new ChatManager(serverUrl);

    // Initialize DatabaseAPI
    this.dbAPI = new DatabaseAPI();

    // Set up callback to reload follow-up setting when it changes
    this.dbAPI.setFollowUpSettingChangedCallback((userId: string) => {
      this.reloadFollowUpSettingForUser(userId);
    });

    // Set up routes after server initialization
    this.setupRoutes();
    this.setupChatRoutes();
  }

  /**
   * Set up Express routes for serving the frontend
   */
  private setupRoutes(): void {
    const app = this.getExpressApp();

    // Serve static files from the public directory (for both dev and production)
    const publicPath = path.join(__dirname, '../public');
    app.use(express.static(publicPath));

    // Serve static files from the built frontend (in production)
    if (process.env.NODE_ENV === 'production') {
      const staticPath = path.join(__dirname, '../../dist/frontend');
      app.use(express.static(staticPath));

      // Catch-all route for React app - must be registered after all API routes
      app.get('*', (req, res, next) => {
        // Skip API routes and webhook
        if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
          return next();
        }
        res.sendFile(path.join(__dirname, '../../dist/frontend/index.html'));
      });
    }
  }

  /**
   * Set up Express routes for chat and transcription APIs
   */
  private setupChatRoutes(): void {
    const app = this.getExpressApp() as any;

    // Create API controllers
    const chatAPI = new ChatAPI(this.chatManager, this.transcriptionSSEManager.getConnectionsMap());

    // Mount routes
    app.use('/api/chat', createChatRoutes(chatAPI));
    app.use('/api/transcription', createTranscriptionRoutes(chatAPI));
    app.use('/api/db', createDbRoutes(this.dbAPI));

    logger.info('✅ Chat API routes configured with SSE support');
  }

  /**
   * Handle new session connections
   */
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    const logger = session.logger.child({ service: 'Mira.MiraServer' });
    logger.info(`Setting up Mentra AI service for session ${sessionId}, user ${userId}`);
    logger.info(`testing right now`)
    // Initialize user settings with defaults if they don't exist
    try {
      await this.dbAPI.initializeUserSettings(userId);
    } catch (error) {
      logger.error(error as Error, `Failed to initialize settings for user ${userId}:`);
      // Continue even if settings initialization fails
    }

    // Initialize today's conversation (creates new one only if doesn't exist for today)
    try {
      await this.dbAPI.initializeTodayConversation(userId);
    } catch (error) {
      logger.error(error as Error, `Failed to initialize conversation for user ${userId}:`);
      // Continue even if conversation initialization fails
    }

    const cleanServerUrl = getCleanServerUrl(session.getServerUrl());

    // Reuse existing agent for this user or create a new one
    let agent = this.agentPerUser.get(userId);
    if (!agent) {
      logger.info(`Creating new MiraAgent for user ${userId}`);
      agent = new MiraAgent(cleanServerUrl, userId, session.logger);
      this.agentPerUser.set(userId, agent);

      // Start fetching tools asynchronously without blocking
      getAllToolsForUser(cleanServerUrl, userId).then(tools => {
        // Append tools to agent when they're available
        if (tools.length > 0) {
          agent!.agentTools.push(...tools);
          logger.info(`Added ${tools.length} user tools to agent for user ${userId}`);
        }
      }).catch(error => {
        logger.error(error, `Failed to load tools for user ${userId}:`);
      });
    } else {
      logger.info(`Reusing existing MiraAgent for user ${userId} (conversation history preserved)`);
      // Update logger for the reused agent to use the current session's logger
      agent.setLogger(session.logger);
    }

    this.agentPerSession.set(sessionId, agent);

    // Create broadcast function for transcription SSE
    const broadcastTranscription = createTranscriptionBroadcaster(this.transcriptionSSEManager, userId);

    // Create callback to save conversation turns to the database (only if chat history is enabled)
    const onConversationTurn = async (query: string, response: string, photoTimestamp?: number) => {
      try {
        // Check if chat history is enabled for this user
        const settings = await UserSettings.findOne({ userId });
        if (!settings?.chatHistoryEnabled) {
          logger.debug({ userId }, 'Chat history disabled, skipping conversation save');
          return;
        }

        await this.dbAPI.addMessageToConversation(userId, 'user', query, photoTimestamp);
        await this.dbAPI.addMessageToConversation(userId, 'assistant', response);
      } catch (error) {
        logger.error(error as Error, `Failed to save conversation turn for user ${userId}:`);
      }
    };

    // Create a transcription manager for this session — this is what essentially connects the user's session input to the backend.
    const transcriptionManager = new TranscriptionManager(
      session, sessionId, userId, agent, cleanServerUrl, this.chatManager, broadcastTranscription, onConversationTurn
    );
    this.transcriptionManagers.set(sessionId, transcriptionManager);
    this.userIdToSessionId.set(userId, sessionId); // Track userId -> sessionId mapping

    // Welcome message
    // session.layouts.showReferenceCard(
    //   "Mira AI",
    //   "Virtual assistant connected",
    //   { durationMs: 3000 }
    // );

    // Do not subscribe globally to transcription in head-up mode.
    // Each TranscriptionManager manages its own subscription to save battery.

    // Handle head position changes (used for optional head-up wake window)
    session.events.onHeadPosition((headPositionData) => {
      const transcriptionManager = this.transcriptionManagers.get(sessionId);
      transcriptionManager?.handleHeadPosition(headPositionData);
    });
    // Also listen for setting changes to update subscription strategy dynamically
    session.settings.onChange((settings) => {
      const manager = this.transcriptionManagers.get(sessionId);
      manager?.initTranscriptionSubscription();
    });

    session.events.onLocation((locationData) => {
      const transcriptionManager = this.transcriptionManagers.get(sessionId);
      if (transcriptionManager) {
        transcriptionManager.handleLocation(locationData);
      }
    });

    session.events.onPhoneNotifications((phoneNotifications) => {
      this.handlePhoneNotifications(phoneNotifications, sessionId, userId);
    });

    // Handle connection events
    /*
    session.events.onConnected((settings) => {
      logger.info(`\n[User ${userId}] connected to augmentos-cloud\n`);
    });
    */

    // Handle errors
    session.events.onError((error) => {
      logger.error(error, `[User ${userId}] Error: session error occurred`);
    });
  }

  private handlePhoneNotifications(phoneNotifications: any, sessionId: string, userId: string): void {
    // Save notifications for the user
    if (Array.isArray(phoneNotifications)) {
      notificationsManager.addNotifications(userId, phoneNotifications);
    } else if (phoneNotifications) {
      notificationsManager.addNotifications(userId, [phoneNotifications]);
    }
    // No need to update agent context here; notifications will be passed in userContext when needed
  }

  /**
   * Reload follow-up setting for a specific user
   * Called when the user updates their follow-up setting via the API
   */
  public reloadFollowUpSettingForUser(userId: string): void {
    const sessionId = this.userIdToSessionId.get(userId);
    if (sessionId) {
      const manager = this.transcriptionManagers.get(sessionId);
      if (manager) {
        manager.reloadFollowUpSetting();
        logger.info(`Reloaded follow-up setting for user ${userId}`);
      }
    }
  }

  // Handle session disconnection
  protected onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    logger.info(`Stopping Mira service for session ${sessionId}, user ${userId}`);

    // Clean up transcription manager
    const manager = this.transcriptionManagers.get(sessionId);
    if (manager) {
      manager.cleanup();
      this.transcriptionManagers.delete(sessionId);
    }

    // Clean up userId -> sessionId mapping
    this.userIdToSessionId.delete(userId);

    // Clean up agent for this session
    this.agentPerSession.delete(sessionId);

    // Clean up persistent agent for this user
    this.agentPerUser.delete(userId);
    logger.info(`🗑️ Cleaned up persistent agent for user ${userId}`);

    // Clean up chat history and user data when session stops
    this.chatManager.cleanupUserOnDisconnect(userId);
    logger.info(`🗑️ Cleaned up chat history for user ${userId}`);

    return Promise.resolve();
  }
}

// Create and start the server
const server = new MiraServer({
  packageName: PACKAGE_NAME!,
  apiKey: AUGMENTOS_API_KEY!,
  port: PORT,
  webhookPath: '/webhook',
  publicDir: path.join(__dirname, './public')
});

// Initialize database connection and start server
async function startServer() {
  try {
    // Connect to MongoDB (optional - will skip if MONGODB_URI not set)
    await connectToDatabase();

    // Start the server
    await server.start();
    logger.info(`${PACKAGE_NAME} server running`);
  } catch (error) {
    logger.error(error, 'Failed to start server:');
    process.exit(1);
  }
}

startServer();


// Log any unhandled promise rejections or uncaught exceptions to help with debugging.
process.on('uncaughtException', (error) => {
  logger.error(error, '🥲 Uncaught Exception:');
  // Log the error, clean up resources, then exit gracefully
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason === "Photo request timed out") {
    return logger.warn("Photo request timed out, ignoring.");
  } else if (reason === "Location poll request timed out") {
    return logger.warn("Location poll request timed out, ignoring.");
  } else {
    logger.error({ reason, promise }, '🥲 Unhandled Rejection at:');
  }
  //process.exit(1);
});