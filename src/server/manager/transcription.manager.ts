import {
  AppSession,
  logger as _logger
} from '@mentra/sdk';
import { MiraAgent } from '../agents';
import { TranscriptProcessor } from '../utils';
import { ChatManager } from './chat.manager';
import { notificationsManager } from './notifications.manager';
import { PhotoManager } from './photo.manager';
import { LocationService } from './location.service';
import { AudioPlaybackManager } from './audio-playback.manager';
import { WakeWordDetector } from './wake-word.detector';
import { QueryProcessor } from './query.processor';

const logger = _logger.child({ service: 'TranscriptionManager' });

/**
 * Manages the transcription state for active sessions
 */
export class TranscriptionManager {
  private isProcessingQuery: boolean = false;
  private isListeningToQuery: boolean = false;
  private timeoutId?: NodeJS.Timeout;
  private maxListeningTimeoutId?: NodeJS.Timeout;
  private session: AppSession;
  private sessionId: string;
  private userId: string;
  private miraAgent: MiraAgent;
  private transcriptionStartTime: number = 0;

  private transcriptProcessor: TranscriptProcessor;
  private logger: AppSession['logger'];
  private broadcastTranscription: (text: string, isFinal: boolean) => void = () => {};

  // Head position tracking for optional wake word activation
  private lastHeadPosition: string | null = null;
  private headWakeWindowUntilMs: number = 0;
  private transcriptionUnsubscribe?: () => void;
  private headWindowTimeoutId?: NodeJS.Timeout;

  // Extracted managers and services
  private photoManager: PhotoManager;
  private locationService: LocationService;
  private audioManager: AudioPlaybackManager;
  private wakeWordDetector: WakeWordDetector;
  private queryProcessor: QueryProcessor;

  constructor(
    session: AppSession,
    sessionId: string,
    userId: string,
    miraAgent: MiraAgent,
    serverUrl: string,
    chatManager?: ChatManager,
    broadcastTranscription?: (text: string, isFinal: boolean) => void
  ) {
    this.session = session;
    this.sessionId = sessionId;
    this.userId = userId;
    this.miraAgent = miraAgent;
    this.broadcastTranscription = broadcastTranscription || (() => {});

    // Initialize extracted services
    this.photoManager = new PhotoManager(session, sessionId);
    this.locationService = new LocationService(sessionId);
    this.audioManager = new AudioPlaybackManager(session, sessionId);
    this.wakeWordDetector = new WakeWordDetector();
    this.queryProcessor = new QueryProcessor({
      session,
      sessionId,
      userId,
      miraAgent,
      serverUrl,
      chatManager,
      photoManager: this.photoManager,
      audioManager: this.audioManager,
      wakeWordDetector: this.wakeWordDetector
    });

    // Use same settings as LiveCaptions for now
    this.transcriptProcessor = new TranscriptProcessor(30, 3, 3, false);
    this.logger = session.logger.child({ service: 'Mira.TranscriptionManager' });

    // Initialize subscription state based on setting
    this.initTranscriptionSubscription();
  }

  /**
   * Process incoming transcription data
   */
  handleTranscription(transcriptionData: any): void {
    console.log(`🎤 [${new Date().toISOString()}] Transcription received: "${transcriptionData.text}" (isFinal: ${transcriptionData.isFinal})`);

    // Broadcast transcription to SSE clients
    this.broadcastTranscription(transcriptionData.text, !!transcriptionData.isFinal);

    if (this.isProcessingQuery) {
      this.logger.info(`[Session ${this.sessionId}]: Query already in progress. Ignoring transcription.`);
      return;
    }

    const text = transcriptionData.text;
    const cleanedText = this.wakeWordDetector.cleanText(text);
    const hasWakeWord = this.wakeWordDetector.hasWakeWord(text);

    // Optional setting: only allow wake word within 10s after head moves down->up
    const requireHeadUpWindow = !!this.session.settings.get<boolean>('wake_requires_head_up');
    const now = Date.now();
    const withinHeadWindow = now <= this.headWakeWindowUntilMs;

    // Gate wake word if the optional mode is enabled
    if (!this.isListeningToQuery) {
      if (!hasWakeWord) {
        return;
      }
      if (requireHeadUpWindow && !withinHeadWindow) {
        // Wake word was spoken but not within the head-up window; ignore
        this.logger.debug('Wake word ignored: outside head-up activation window');
        return;
      }
    }

    // Request photo when wake word is detected
    if (!this.photoManager.hasPhoto() && !this.photoManager.isRequesting()) {
      this.photoManager.requestPhoto();
    }

    if (!this.isListeningToQuery) {
      // Check for cancellation phrases before starting to listen
      const queryAfterWakeWord = this.wakeWordDetector.removeWakeWord(text).toLowerCase().trim();
      const isCancellation = this.wakeWordDetector.isCancellation(queryAfterWakeWord);

      if (isCancellation) {
        this.logger.debug("Cancellation phrase detected, aborting query");
        this.handleCancellation();
        return;
      }

      // Play start listening sound
      this.audioManager.playStartListening();

      // Non-blocking location refresh on wake word
      try {
        this.session.location.getLatestLocation({accuracy: "high"}).then(location => {
          if (location) {
            console.log(`[Session ${this.sessionId}]: 📍 Wake-word location refresh received: lat=${location.lat}, lng=${location.lng}, accuracy=${location.accuracy}`);
            this.handleLocation(location);
          }
        }, error => {
          console.warn(`[Session ${this.sessionId}]: ⚠️ Error getting location on wake word:`, error);
        });
      } catch (error) {
        console.warn(`[Session ${this.sessionId}]: ⚠️ Exception getting location on wake word:`, error);
      }

      // Start 15-second maximum listening timer
      this.maxListeningTimeoutId = setTimeout(() => {
        console.log(`[Session ${this.sessionId}]: Maximum listening time (15s) reached, forcing query processing`);
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
          this.timeoutId = undefined;
        }
        this.processQuery(text, 15000);
      }, 15000);
    }

    this.isListeningToQuery = true;

    // If this is our first detection, start the transcription timer
    if (this.transcriptionStartTime === 0) {
      this.transcriptionStartTime = Date.now();
      console.log(`⏱️  [${new Date().toISOString()}] 🎙️ Started new transcription session at timestamp: ${this.transcriptionStartTime}`);
    } else {
      console.log(`⏱️  [${new Date().toISOString()}] 🔄 Continuing transcription session from timestamp: ${this.transcriptionStartTime}`);
    }

    // Remove wake word for display
    const displayText = this.wakeWordDetector.removeWakeWord(text);
    // Only show 'Listening...' if there is no text after the wake word
    if (displayText.trim().length === 0) {
      if (this.transcriptProcessor.getLastUserTranscript().trim().length !== 0) {
        this.transcriptProcessor.processString('', false);
      }
      this.session.layouts.showTextWall("Listening...", { durationMs: 10000 });
    } else {
      // Show the live query as the user is talking
      let formatted = 'Listening...\n\n' + this.transcriptProcessor.processString(displayText, !!transcriptionData.isFinal).trim();
      this.session.layouts.showTextWall(formatted, { durationMs: 20000 });
    }

    let timerDuration: number;
    if (transcriptionData.isFinal) {
      // Check if the final transcript ends with a wake word
      if (this.wakeWordDetector.endsWithWakeWord(cleanedText)) {
        this.logger.debug("transcriptionData.isFinal: ends with wake word");
        timerDuration = 10000;
      } else {
        timerDuration = 1500;
      }
    } else {
      timerDuration = 2000;
    }

    // Clear any existing timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    // Set a new timeout to process the query
    this.timeoutId = setTimeout(() => {
      this.processQuery(text, timerDuration);
    }, timerDuration);
  }

  /**
   * Handle cancellation request
   */
  private handleCancellation(): void {
    // Play cancellation sound
    this.audioManager.playCancellation();

    // Clear display
    this.session.layouts.showTextWall("Cancelled", { durationMs: 2000 });

    // Reset state
    this.resetState();
  }

  /**
   * Reset all state flags and timers
   */
  private resetState(): void {
    this.isListeningToQuery = false;
    this.isProcessingQuery = false;
    this.photoManager.clearPhoto();
    this.transcriptionStartTime = 0;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.maxListeningTimeoutId) {
      clearTimeout(this.maxListeningTimeoutId);
      this.maxListeningTimeoutId = undefined;
    }
    this.transcriptProcessor.clear();
    this.queryProcessor.clearCurrentQueryMessageId();
  }

  /**
   * Handle head position updates from the session
   */
  public handleHeadPosition(headPositionData: any): void {
    try {
      // Derive a simple position string from provided data
      let current: string | null = null;
      if (typeof headPositionData === 'string') {
        current = headPositionData.toLowerCase();
      } else if (headPositionData && typeof headPositionData.position === 'string') {
        current = String(headPositionData.position).toLowerCase();
      }

      if (!current) {
        return;
      }

      const requireHeadUpWindow = !!this.session.settings.get<boolean>('wake_requires_head_up');
      if (!requireHeadUpWindow) {
        this.lastHeadPosition = current;
        return;
      }

      // Start window only on transition down -> up
      if (this.lastHeadPosition === 'down' && current === 'up') {
        this.headWakeWindowUntilMs = Date.now() + 10_000;
        this.logger.debug({ until: this.headWakeWindowUntilMs }, 'Head up detected: wake window opened for 10s');
        this.ensureTranscriptionSubscribed();

        if (this.headWindowTimeoutId) {
          clearTimeout(this.headWindowTimeoutId);
        }
        this.headWindowTimeoutId = setTimeout(() => {
          this.headWakeWindowUntilMs = 0;
          this.headWindowTimeoutId = undefined;
        }, 10_000);
      }

      this.lastHeadPosition = current;
    } catch (error) {
      this.logger.warn(error as Error, 'Failed to handle head position event');
    }
  }

  /**
   * Initialize subscription state based on the current setting
   */
  public initTranscriptionSubscription(): void {
    this.ensureTranscriptionSubscribed();
  }

  /**
   * Handles location updates with robust error handling
   */
  public async handleLocation(locationData: any): Promise<void> {
    const locationContext = await this.locationService.processLocation(locationData);
    this.miraAgent.updateLocationContext(locationContext);
  }

  /**
   * Process and respond to the user's query
   */
  private async processQuery(rawText: string, timerDuration: number): Promise<void> {
    // Prevent multiple queries from processing simultaneously
    if (this.isProcessingQuery) {
      return;
    }

    this.isProcessingQuery = true;

    try {
      await this.queryProcessor.processQuery(rawText, timerDuration, this.transcriptionStartTime);
    } catch (error) {
      logger.error(error, `[Session ${this.sessionId}]: Error in processQuery:`);
    } finally {
      // CRITICAL: Reset state IMMEDIATELY to prevent transcript accumulation
      // These must be reset synchronously before the setTimeout delay
      console.log(`⏱️  [${new Date().toISOString()}] 🧹 Resetting transcription state (transcriptionStartTime: ${this.transcriptionStartTime} -> 0)`);
      this.transcriptionStartTime = 0;
      this.isListeningToQuery = false;
      this.transcriptProcessor.clear();
      this.queryProcessor.clearCurrentQueryMessageId();
      this.photoManager.clearPhoto();

      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = undefined;
      }
      if (this.maxListeningTimeoutId) {
        clearTimeout(this.maxListeningTimeoutId);
        this.maxListeningTimeoutId = undefined;
      }

      // Add a small delay before accepting new queries to prevent accidental wake word
      // detection immediately after audio completes (audio is now awaited in query processor)
      setTimeout(() => {
        this.isProcessingQuery = false;
        console.log(`🔓 [${new Date().toISOString()}] Processing lock released - ready for next query`);
      }, 1000); // Short 1s cooldown after audio completes
    }
  }

  /**
   * Subscribe to transcriptions if not already subscribed
   */
  public ensureTranscriptionSubscribed(): void {
    if (this.transcriptionUnsubscribe) {
      return;
    }
    this.transcriptionUnsubscribe = this.session.events.onTranscription((transcriptionData) => {
      this.handleTranscription({
        ...transcriptionData,
        notifications: notificationsManager.getLatestNotifications(this.userId, 5)
      });
    });
  }

  /**
   * Unsubscribe from transcriptions to save battery when not needed
   */
  public ensureTranscriptionUnsubscribed(): void {
    // NEVER UNSUBSCRIBE - DEBUGGING ISSUE
    return;
  }

  /**
   * Clean up resources when the session ends
   */
  cleanup(): void {
    this.audioManager.setShuttingDown(true);
    this.isProcessingQuery = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    if (this.maxListeningTimeoutId) {
      clearTimeout(this.maxListeningTimeoutId);
    }
  }
}

/**
 * Utility to clean and convert ws(s)://.../tpa-ws to https://... for API calls
 */
export function getCleanServerUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  // Remove ws:// or wss://
  let url = rawUrl.replace(/^wss?:\/\//, '');
  // Remove trailing /tpa-ws
  url = url.replace(/\/app-ws$/, '');
  // Prepend https://
  return `https://${url}`;
}
