import {
  AppSession,
  logger as _logger
} from '@mentra/sdk';
import { MiraAgent } from '../agents';
import { TranscriptProcessor } from '../utils';
import { ChatManager } from './chat.manager';
import { notificationsManager } from './notifications.manager';
import { PhotoManager } from './photo.manager';
import { LocationService, clearLocationCacheForSession } from './geolocation.manager';
import { AudioPlaybackManager } from './audio-playback.manager';
import { WakeWordDetector } from './wake-word.manager';
import { QueryProcessor } from './query.manager';
import { UserSettings } from '../schemas';

const logger = _logger.child({ service: 'TranscriptionManager' });

/**
 * Debug flag to enable/disable live transcription logging
 * Set to true to see ALL transcriptions (including ambient) in terminal
 * Set to false to only see relevant transcriptions (wake word, follow-up, etc.)
 */
const DEBUG_LOG_ALL_TRANSCRIPTIONS = false;

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

  // Follow-up sound setting (cached from database)
  private followUpEnabled: boolean = false;
  private followUpSettingLoaded: boolean = false;

  // Follow-up listening mode - listens for 5 seconds without wake word after query completes
  private isInFollowUpMode: boolean = false;
  private followUpTimeoutId?: NodeJS.Timeout;
  // Track last processed query to prevent transcript accumulation bug
  // (backend doesn't properly clear/filter transcripts, so we skip text we've already processed)
  private lastProcessedQueryText: string = '';

  // Speaker lock - only listen to the person who said the wake word
  private activeSpeakerId: string | undefined = undefined;

  // Generation counter — incremented on each interrupt/reset so stale processQuery
  // finally blocks don't clobber state belonging to a newer session
  private queryGeneration: number = 0;

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
    broadcastTranscription?: (text: string, isFinal: boolean) => void,
    onConversationTurn?: (query: string, response: string, photoTimestamp?: number) => void
  ) {
    this.session = session;
    this.sessionId = sessionId;
    this.userId = userId;
    this.miraAgent = miraAgent;
    this.broadcastTranscription = broadcastTranscription || (() => {});

    // Initialize extracted services
    this.photoManager = new PhotoManager(session, sessionId);
    this.locationService = new LocationService(sessionId, session.logger);
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
      wakeWordDetector: this.wakeWordDetector,
      onConversationTurn,
      // Lazy geocoding: Only fetch location when user asks location-related questions
      onLocationRequest: async () => {
        try {
          const location = await this.session.location.getLatestLocation({ accuracy: "high" });
          if (location) {
            console.log(`[Session ${this.sessionId}]: 📍 Lazy geocoding - fetching location: lat=${location.lat}, lng=${location.lng}`);
            await this.handleLocation(location);
          }
        } catch (error) {
          console.warn(`[Session ${this.sessionId}]: ⚠️ Error fetching location for lazy geocoding:`, error);
        }
      },
    });

    // Use same settings as LiveCaptions for now
    this.transcriptProcessor = new TranscriptProcessor(30, 3, 3, false);
    this.logger = session.logger.child({ service: 'Mira.TranscriptionManager' });

    // Initialize subscription state based on setting
    this.initTranscriptionSubscription();
  }

  /**
   * Debug helper to log ALL transcriptions when DEBUG_LOG_ALL_TRANSCRIPTIONS is enabled
   */
  private debugLogTranscription(text: string, isFinal: boolean, context: string, speakerId?: string): void {
    if (DEBUG_LOG_ALL_TRANSCRIPTIONS) {
      const speaker = speakerId ? `[Speaker ${speakerId}]` : '[Speaker ?]';
      console.log(`🐛 [DEBUG] [${new Date().toISOString()}] ${speaker} ${context}: "${text}" (isFinal: ${isFinal})`);
    }
  }

  /**
   * Process incoming transcription data
   */
  async handleTranscription(transcriptionData: any): Promise<void> {
    // Debug logging (only if DEBUG_LOG_ALL_TRANSCRIPTIONS is enabled)
    this.debugLogTranscription(transcriptionData.text, transcriptionData.isFinal, 'Transcription received', transcriptionData.speakerId);

    // Broadcast transcription to SSE clients
    this.broadcastTranscription(transcriptionData.text, !!transcriptionData.isFinal);

    // If we're listening to a query and have a locked speaker, ignore other speakers
    if (this.isListeningToQuery && this.activeSpeakerId && transcriptionData.speakerId !== this.activeSpeakerId) {
      if (DEBUG_LOG_ALL_TRANSCRIPTIONS) {
        console.log(`🔇 [DEBUG] Ignoring speaker ${transcriptionData.speakerId} (locked to: ${this.activeSpeakerId})`);
      }
      return;
    }

    const text = transcriptionData.text;
    const cleanedText = this.wakeWordDetector.cleanText(text);
    const hasWakeWord = this.wakeWordDetector.hasWakeWord(text);

    if (this.isProcessingQuery) {
      if (!hasWakeWord) {
        // Not a wake word — ignore ambient speech during processing
        return;
      }
      // Wake word detected during processing — reset state so next transcription starts fresh.
      // We return here (don't process THIS transcript) because it may contain stale text
      // from the previous query's STT session. The next incoming transcription will have
      // a clean wake word and start a proper new session.
      console.log(`🔄 [${new Date().toISOString()}] Wake word detected during processing — resetting state for next query (gen ${this.queryGeneration} -> ${this.queryGeneration + 1})`);
      this.queryGeneration++; // Invalidate any in-flight processQuery finally blocks
      this.queryProcessor.aborted = true; // Tell in-flight query to skip audio/response delivery
      this.isProcessingQuery = false;
      this.isListeningToQuery = false;
      this.isInFollowUpMode = false;
      this.activeSpeakerId = undefined;
      this.transcriptionStartTime = 0;
      this.lastProcessedQueryText = '';
      this.transcriptProcessor.clear();
      this.queryProcessor.clearCurrentQueryMessageId();
      this.photoManager.clearPhoto();
      if (this.timeoutId) { clearTimeout(this.timeoutId); this.timeoutId = undefined; }
      if (this.maxListeningTimeoutId) { clearTimeout(this.maxListeningTimeoutId); this.maxListeningTimeoutId = undefined; }
      if (this.followUpTimeoutId) { clearTimeout(this.followUpTimeoutId); this.followUpTimeoutId = undefined; }
      // Return — don't process this transcript. The next transcription with a wake word
      // will be handled cleanly by the normal flow below.
      return;
    }

    // Handle follow-up mode: no wake word required, just process the transcription
    if (this.isInFollowUpMode) {
      // Per-transcription follow-up logs commented out to reduce noise
      // if (!DEBUG_LOG_ALL_TRANSCRIPTIONS) {
      //   console.log(`🔄 [${new Date().toISOString()}] Transcription received (follow-up): "${transcriptionData.text}" (isFinal: ${transcriptionData.isFinal})`);
      // }
      await this.handleFollowUpTranscription(transcriptionData);
      return;
    }

    // Optional setting: only allow wake word within 10s after head moves down->up
    const requireHeadUpWindow = !!this.session.settings.get<boolean>('wake_requires_head_up');
    const now = Date.now();
    const withinHeadWindow = now <= this.headWakeWindowUntilMs;

    // Gate wake word if the optional mode is enabled
    if (!this.isListeningToQuery) {
      if (!hasWakeWord) {
        // Skip logging ambient conversation (no wake word detected)
        // Debug logging already happened above if enabled
        return;
      }
      if (requireHeadUpWindow && !withinHeadWindow) {
        // Wake word was spoken but not within the head-up window; ignore
        this.logger.debug('Wake word ignored: outside head-up activation window');
        return;
      }
      // Log only when wake word is detected (unless debug mode already logged it)
      if (!DEBUG_LOG_ALL_TRANSCRIPTIONS) {
        console.log(`🎤 [${new Date().toISOString()}] Wake word detected: "${transcriptionData.text}" (isFinal: ${transcriptionData.isFinal})`);
      }
    } else {
      // Per-transcription listening logs commented out to reduce noise
      // if (!DEBUG_LOG_ALL_TRANSCRIPTIONS) {
      //   console.log(`🎤 [${new Date().toISOString()}] Transcription received (listening): "${transcriptionData.text}" (isFinal: ${transcriptionData.isFinal})`);
      // }
    }

    if (!this.isListeningToQuery) {
      // Request a fresh photo ONLY when we first detect the wake word (start of query)
      // This prevents taking multiple photos during the same query
      this.photoManager.requestPhoto();

      // DISABLED: Location fetch moved to query processor (lazy geocoding)
      // Only fetch location when user asks location-related questions
      // This saves ~4 API calls per query that doesn't need location
      // See: location-query-decider.ts and query.processor.ts

      // Start 15-second maximum listening timer
      this.maxListeningTimeoutId = setTimeout(() => {
        // Only fire if we're still in listening state (not already processing or reset)
        if (!this.isListeningToQuery || this.isProcessingQuery) {
          return;
        }
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
          this.timeoutId = undefined;
        }
        this.processQuery(text, 15000);
      }, 15000);
    }

    this.isListeningToQuery = true;

    // Lock onto the speaker who said the wake word
    this.activeSpeakerId = transcriptionData.speakerId;
    if (this.activeSpeakerId) {
      // console.log(`🔒 [DEBUG] Locked to speaker: ${this.activeSpeakerId}`);
    }

    // If this is our first detection, start the transcription timer
    if (this.transcriptionStartTime === 0) {
      this.transcriptionStartTime = Date.now();
      console.log(`⏱️  [${new Date().toISOString()}] 🎙️ Started new transcription session at timestamp: ${this.transcriptionStartTime}`);
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
        timerDuration = 900;
      }
    } else {
      timerDuration = 900;
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
   * Handle transcription in follow-up mode (no wake word required)
   * User has 5 seconds to speak after the follow-up sound plays
   */
  private async handleFollowUpTranscription(transcriptionData: any): Promise<void> {
    let text = transcriptionData.text;
    // Note: Already logged in handleTranscription when entering this function

    // CRITICAL: Strip out the last processed query from the transcript text
    // The backend doesn't properly clear/filter transcripts by startTime, so we get
    // accumulated text like "Previous query... New query" instead of just "New query"
    if (this.lastProcessedQueryText && text.startsWith(this.lastProcessedQueryText)) {
      const newText = text.slice(this.lastProcessedQueryText.length).trim();
      if (newText.length === 0) {
        // This is just the old query being echoed back, ignore it
        console.log(`🔇 [${new Date().toISOString()}] Ignoring echoed previous query in follow-up mode`);
        return;
      }
      console.log(`🔧 [${new Date().toISOString()}] Stripped previous query from transcript: "${text.slice(0, 50)}..." -> "${newText.slice(0, 50)}..."`);
      text = newText;
    }

    // Cancel the 5-second timeout since user is speaking
    if (this.followUpTimeoutId) {
      clearTimeout(this.followUpTimeoutId);
      this.followUpTimeoutId = undefined;
    }

    // Start transcription timer if not already started
    // Do NOT request a new photo for follow-up queries — the visual context hasn't changed
    // since the previous query (only seconds ago). This prevents the camera from firing
    // repeatedly while the user is mid-conversation.
    if (this.transcriptionStartTime === 0) {
      this.transcriptionStartTime = Date.now();
      console.log(`⏱️  [${new Date().toISOString()}] 🎙️ Started follow-up transcription at: ${this.transcriptionStartTime} (no photo — reusing context from previous query)`);
    }

    // Show the live query (no "Listening..." prefix for follow-up)
    const displayText = this.wakeWordDetector.removeWakeWord(text); // Remove wake word if user says it anyway
    if (displayText.trim().length > 0) {
      const formatted = 'Follow-up...\n\n' + this.transcriptProcessor.processString(displayText, !!transcriptionData.isFinal).trim();
      this.session.layouts.showTextWall(formatted, { durationMs: 20000 });
    }

    // Set timer to process the follow-up query
    let timerDuration: number;
    if (transcriptionData.isFinal) {
      timerDuration = 900;
    } else {
      timerDuration = 900;
    }

    // Clear any existing timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    // Set a new timeout to process the follow-up query
    this.timeoutId = setTimeout(() => {
      this.processFollowUpQuery(text, timerDuration);
    }, timerDuration);
  }

  /**
   * Start follow-up listening mode after a query completes
   * Listens for 5 seconds without requiring wake word
   */
  private async startFollowUpListening(): Promise<void> {
    console.log(`🔔 [${new Date().toISOString()}] Starting follow-up listening mode (5 second window)`);

    // CRITICAL: Set state BEFORE audio to prevent race condition
    // Transcriptions arriving during audio playback must route to follow-up handling,
    // not wake word detection. Otherwise, ambient sound during the follow-up chime
    // can trigger false activations.
    this.isInFollowUpMode = true;
    this.isProcessingQuery = false;
    this.transcriptionStartTime = 0;
    this.transcriptProcessor.clear();

    // Set timeout first (5-second window starts now, not after audio)
    this.followUpTimeoutId = setTimeout(() => {
      console.log(`⏰ [${new Date().toISOString()}] Follow-up timeout (5s) - no response, returning to normal mode`);
      this.cancelFollowUpMode();
    }, 5000);

    // console.log(`🔔 [${new Date().toISOString()}] Follow-up mode activated`);
  }

  /**
   * Cancel follow-up mode and return to normal wake word detection
   * Plays the cancellation sound to give user audio feedback
   */
  private cancelFollowUpMode(): void {
    // console.log(`🚫 [${new Date().toISOString()}] Cancelling follow-up mode`);

    // Play cancellation sound for audio feedback
    this.audioManager.playCancellation();

    this.isInFollowUpMode = false;
    this.isProcessingQuery = false;

    if (this.followUpTimeoutId) {
      clearTimeout(this.followUpTimeoutId);
      this.followUpTimeoutId = undefined;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }

    this.transcriptionStartTime = 0;
    this.transcriptProcessor.clear();
    this.photoManager.clearPhoto();

    // console.log(`🔓 [${new Date().toISOString()}] Back to normal mode - waiting for wake word`);
  }

  /**
   * Process a follow-up query (similar to processQuery but handles follow-up state)
   */
  private async processFollowUpQuery(rawText: string, timerDuration: number): Promise<void> {
    // Exit follow-up mode since we're now processing
    this.isInFollowUpMode = false;

    if (this.followUpTimeoutId) {
      clearTimeout(this.followUpTimeoutId);
      this.followUpTimeoutId = undefined;
    }

    // Prevent multiple queries from processing simultaneously
    if (this.isProcessingQuery) {
      return;
    }

    this.isProcessingQuery = true;
    console.log(`🔄 [${new Date().toISOString()}] Processing follow-up query: "${rawText}"`);

    // Store the raw text to prevent it from being re-processed in next follow-up
    // This is needed because backend doesn't properly clear/filter transcripts
    this.lastProcessedQueryText = rawText;

    try {
      // Remove wake word if user said it anyway (habit)
      const cleanedText = this.wakeWordDetector.removeWakeWord(rawText);
      await this.queryProcessor.processQuery(cleanedText, timerDuration, this.transcriptionStartTime);
    } catch (error) {
      logger.error(error, `[Session ${this.sessionId}]: Error in processFollowUpQuery:`);
    } finally {
      // Reset state after follow-up query
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

      // Check if we should start another follow-up listening session
      if (this.followUpEnabled) {
        await this.startFollowUpListening();
      } else {
        this.isProcessingQuery = false;
      }
    }
  }

  /**
   * Reset all state flags and timers
   */
  private resetState(): void {
    this.isListeningToQuery = false;
    this.isProcessingQuery = false;
    this.isInFollowUpMode = false;
    this.activeSpeakerId = undefined; // Clear speaker lock
    this.photoManager.clearPhoto();
    this.transcriptionStartTime = 0;
    this.lastProcessedQueryText = ''; // Clear to allow fresh queries
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.maxListeningTimeoutId) {
      clearTimeout(this.maxListeningTimeoutId);
      this.maxListeningTimeoutId = undefined;
    }
    if (this.followUpTimeoutId) {
      clearTimeout(this.followUpTimeoutId);
      this.followUpTimeoutId = undefined;
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
    // Load follow-up setting on initialization
    this.loadFollowUpSetting();
  }

  /**
   * Load the followUpEnabled setting from the database
   */
  private async loadFollowUpSetting(): Promise<void> {
    try {
      const settings = await UserSettings.findOne({ userId: this.userId });
      if (settings) {
        this.followUpEnabled = settings.followUpEnabled ?? false;
      }
      this.followUpSettingLoaded = true;
    } catch (error) {
      logger.warn({ error }, 'Failed to load follow-up setting, defaulting to disabled');
      this.followUpEnabled = false;
      this.followUpSettingLoaded = true;
    }
  }

  /**
   * Reload the followUpEnabled setting (called when setting changes)
   */
  public async reloadFollowUpSetting(): Promise<void> {
    await this.loadFollowUpSetting();
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

    // Capture the generation at entry — if it changes (due to interrupt), our finally block
    // must NOT reset state because a newer session owns it now.
    const myGeneration = this.queryGeneration;

    // CRITICAL: Clear both timers IMMEDIATELY on entry to prevent the other timer
    // from firing while we're processing (race condition between 900ms/10s timer and 15s max timer)
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.maxListeningTimeoutId) {
      clearTimeout(this.maxListeningTimeoutId);
      this.maxListeningTimeoutId = undefined;
    }

    let shouldEnterFollowUp = true; // Track if we should enter follow-up mode

    // Store the raw text to prevent it from being re-processed in next follow-up
    // This is needed because backend doesn't properly clear/filter transcripts
    this.lastProcessedQueryText = rawText;

    try {
      const result = await this.queryProcessor.processQuery(rawText, timerDuration, this.transcriptionStartTime, this.activeSpeakerId);
      // If processQuery returns false, it means the query was cancelled or was an affirmative phrase
      // and we should NOT enter follow-up mode
      if (result === false) {
        shouldEnterFollowUp = false;
      }
    } catch (error) {
      logger.error(error, `[Session ${this.sessionId}]: Error in processQuery:`);
    } finally {
      // If generation changed, an interrupt already reset state — don't clobber it
      if (myGeneration !== this.queryGeneration) {
        console.log(`⏱️  [${new Date().toISOString()}] 🚫 Skipping finally cleanup — session was interrupted (gen ${myGeneration} != ${this.queryGeneration})`);
        return;
      }

      // CRITICAL: Reset state IMMEDIATELY to prevent transcript accumulation
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

      // Start follow-up listening mode ONLY if query was actually processed
      // Skip follow-up for cancellations and affirmative phrases
      // IMPORTANT: Force follow-up mode if there's a pending disambiguation (AI asked "which app?")
      const hasPendingDisambiguation = this.queryProcessor.hasPendingDisambiguation();
      const shouldStartFollowUp = shouldEnterFollowUp && (this.followUpEnabled || hasPendingDisambiguation);

      if (shouldStartFollowUp) {
        await this.startFollowUpListening();
      } else {
        // Release processing lock immediately if follow-up is disabled or query was cancelled
        this.isProcessingQuery = false;
      }
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
    this.isInFollowUpMode = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    if (this.maxListeningTimeoutId) {
      clearTimeout(this.maxListeningTimeoutId);
    }
    if (this.followUpTimeoutId) {
      clearTimeout(this.followUpTimeoutId);
    }

    // Clean up location cache for this session to prevent memory leaks
    clearLocationCacheForSession(this.sessionId);
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
