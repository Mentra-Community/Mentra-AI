import {
  AppSession,
  logger as _logger
} from '@mentra/sdk';
import { MiraAgent, CameraQuestionAgent } from '../agents';
import { TranscriptProcessor, getCancellationDecider, CancellationDecider, CancellationDecision, CancellationResult } from '../utils';
import { ChatManager } from './chat.manager';
import { notificationsManager } from './notifications.manager';
import { PhotoManager } from './photo.manager';
import { LocationService } from './location.service';
import { AudioPlaybackManager } from './audio-playback.manager';
import { WakeWordDetector } from './wake-word.detector';
import { QueryProcessor } from './query.processor';
import { UserSettings } from '../schemas';

const logger = _logger.child({ service: 'TranscriptionManager' });

/**
 * Debug flag to enable/disable live transcription logging
 * Set to true to see ALL transcriptions (including ambient) in terminal
 * Set to false to only see relevant transcriptions (wake word, follow-up, etc.)
 */
const DEBUG_LOG_ALL_TRANSCRIPTIONS = true;

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

  // Clarification mode flag - prevents state reset when waiting for yes/no response
  private isWaitingForClarification: boolean = false;

  // Follow-up sound setting (cached from database)
  private followUpEnabled: boolean = false;
  private followUpSettingLoaded: boolean = false;

  // Follow-up listening mode - listens for 5 seconds without wake word after query completes
  private isInFollowUpMode: boolean = false;
  private followUpTimeoutId?: NodeJS.Timeout;
  private isEndingFollowUpGracefully: boolean = false; // Guard to prevent double execution

  // Track last processed query to prevent transcript accumulation bug
  // (backend doesn't properly clear/filter transcripts, so we skip text we've already processed)
  private lastProcessedQueryText: string = '';

  // Speaker lock - only listen to the person who said the wake word
  private activeSpeakerId: string | undefined = undefined;

  // Extracted managers and services
  private photoManager: PhotoManager;
  private locationService: LocationService;
  private audioManager: AudioPlaybackManager;
  private wakeWordDetector: WakeWordDetector;
  private queryProcessor: QueryProcessor;
  private cameraQuestionAgent: CameraQuestionAgent;
  private cancellationDecider: CancellationDecider;

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
    this.locationService = new LocationService(sessionId);
    this.audioManager = new AudioPlaybackManager(session, sessionId);
    this.wakeWordDetector = new WakeWordDetector();
    this.cancellationDecider = getCancellationDecider();
    this.cameraQuestionAgent = new CameraQuestionAgent(userId);
    this.queryProcessor = new QueryProcessor({
      session,
      sessionId,
      userId,
      miraAgent,
      cameraQuestionAgent: this.cameraQuestionAgent,
      serverUrl,
      chatManager,
      photoManager: this.photoManager,
      audioManager: this.audioManager,
      wakeWordDetector: this.wakeWordDetector,
      onRequestClarification: () => this.startClarificationListening(),
      onConversationTurn,
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

    if (this.isProcessingQuery) {
      this.logger.info(`[Session ${this.sessionId}]: Query already in progress. Ignoring transcription.`);
      return;
    }

    const text = transcriptionData.text;
    const cleanedText = this.wakeWordDetector.cleanText(text);
    const hasWakeWord = this.wakeWordDetector.hasWakeWord(text);

    // Handle follow-up mode: no wake word required, just process the transcription
    if (this.isInFollowUpMode) {
      // Log only if debug mode is not already logging everything
      if (!DEBUG_LOG_ALL_TRANSCRIPTIONS) {
        console.log(`🔄 [${new Date().toISOString()}] Transcription received (follow-up): "${transcriptionData.text}" (isFinal: ${transcriptionData.isFinal})`);
      }
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
      // Log when actively listening to a query (unless debug mode already logged it)
      if (!DEBUG_LOG_ALL_TRANSCRIPTIONS) {
        console.log(`🎤 [${new Date().toISOString()}] Transcription received (listening): "${transcriptionData.text}" (isFinal: ${transcriptionData.isFinal})`);
      }
    }

    if (!this.isListeningToQuery) {
      // Request a fresh photo ONLY when we first detect the wake word (start of query)
      // This prevents taking multiple photos during the same query
      this.photoManager.requestPhoto();

      // Play start listening sound immediately (don't wait for AI cancellation check)
      this.audioManager.playStartListening();

      // Check for cancellation phrases using AI-powered detection (non-blocking)
      // This runs in parallel with the user continuing to speak
      const queryAfterWakeWord = this.wakeWordDetector.removeWakeWord(text).trim();
      this.cancellationDecider.checkIfWantsToCancelAsync(queryAfterWakeWord).then(cancellationCheck => {
        if (cancellationCheck === CancellationDecision.CANCEL && !this.isProcessingQuery) {
          this.logger.debug("Cancellation phrase detected by AI, aborting query");
          this.handleCancellation();
        }
      }).catch(error => {
        console.error(`❌ AI cancellation check failed:`, error);
        // On error, continue processing (don't cancel)
      });

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

    // Lock onto the speaker who said the wake word
    this.activeSpeakerId = transcriptionData.speakerId;
    if (this.activeSpeakerId) {
      console.log(`🔒 [DEBUG] Locked to speaker: ${this.activeSpeakerId}`);
    }

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

    // CRITICAL: Only check for cancellation/affirmative on FINAL transcriptions
    // Checking on partial transcriptions (isFinal: false) causes false positives
    // Example: "You got" (partial) → incorrectly detected as affirmative
    //          "You got to find it" (complete) → correctly not affirmative
    if (transcriptionData.isFinal) {
      // Check for cancellation using AI-powered context-aware decider for follow-up mode
      // This checks both affirmative phrases and cancellation phrases
      const result = await this.cancellationDecider.checkIfWantsToCancelInFollowUpMode(text);

      // Handle affirmative phrases (user wants to end conversation gracefully)
      // IMPORTANT: Only end gracefully if NOT in clarification mode
      // In clarification mode, "sure"/"yes" means "continue with task", not "end conversation"
      if (result.isAffirmative && !this.isListeningToQuery) {
        console.log(`✅ [${new Date().toISOString()}] Affirmative phrase detected - ending follow-up mode gracefully`);

        // Cancel any pending query processing timeout
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
          this.timeoutId = undefined;
        }

        // Use void to explicitly acknowledge we're not awaiting this async call
        // The guard inside endFollowUpModeGracefully prevents concurrent executions
        void this.endFollowUpModeGracefully();
        return;
      }

      // Handle cancellation commands (user wants to stop immediately)
      if (result.decision === CancellationDecision.CANCEL) {
        console.log(`🚫 [${new Date().toISOString()}] Follow-up cancelled by user`);
        this.cancelFollowUpMode();
        return;
      }
    }

    // Start transcription timer if not already started
    // Request photo ONLY at the start of a new follow-up query (not on every transcription)
    if (this.transcriptionStartTime === 0) {
      // Request a fresh photo for potential vision query
      this.photoManager.requestPhoto();
      this.transcriptionStartTime = Date.now();
      console.log(`⏱️  [${new Date().toISOString()}] 🎙️ Started follow-up transcription at: ${this.transcriptionStartTime}`);
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
      timerDuration = 1500; // Shorter timeout for follow-ups
    } else {
      timerDuration = 2000;
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

    // Play the follow-up sound (state is already set, so transcriptions route correctly)
    await this.audioManager.playFollowUp();
    console.log(`🔔 [${new Date().toISOString()}] Follow-up sound completed`);
  }

  /**
   * Cancel follow-up mode and return to normal wake word detection
   * Plays the cancellation sound to give user audio feedback
   */
  private cancelFollowUpMode(): void {
    console.log(`🚫 [${new Date().toISOString()}] Cancelling follow-up mode`);

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

    console.log(`🔓 [${new Date().toISOString()}] Back to normal mode - waiting for wake word`);
  }

  /**
   * End follow-up mode gracefully (user said affirmative phrase like "thank you")
   * Plays cancellation sound to acknowledge the end of conversation
   */
  private async endFollowUpModeGracefully(): Promise<void> {
    // Guard against double execution (interim + final transcriptions)
    if (this.isEndingFollowUpGracefully) {
      console.log(`⏭️  [${new Date().toISOString()}] Already ending follow-up gracefully, skipping duplicate call`);
      return;
    }

    this.isEndingFollowUpGracefully = true;
    console.log(`👋 [${new Date().toISOString()}] Ending follow-up mode gracefully (affirmative acknowledgment)`);

    // CRITICAL: Exit follow-up mode IMMEDIATELY (synchronously) before async audio
    // This prevents accepting transcriptions without wake word while audio is playing
    this.isInFollowUpMode = false;
    this.isProcessingQuery = false;

    // Clear all timeouts immediately
    if (this.followUpTimeoutId) {
      clearTimeout(this.followUpTimeoutId);
      this.followUpTimeoutId = undefined;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }

    // Clear transcription state immediately
    this.transcriptionStartTime = 0;
    this.transcriptProcessor.clear();
    this.photoManager.clearPhoto();

    console.log(`🔓 [${new Date().toISOString()}] Exited follow-up mode - back to normal mode (audio acknowledgment will play)`);

    try {
      // Send a friendly acknowledgment message (async, but state is already reset)
      const acknowledgmentMessage = "I'm always here to help, just let me know.";

      // Display on glasses and speak the message
      await this.audioManager.showOrSpeakText(acknowledgmentMessage);

      // Play cancellation sound to acknowledge conversation end
      this.audioManager.playCancellation();
    } catch (error) {
      console.error(`❌ Error in endFollowUpModeGracefully:`, error);
    } finally {
      // Reset guard flag
      this.isEndingFollowUpGracefully = false;
      console.log(`✅ [${new Date().toISOString()}] Graceful exit complete`);
    }
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
      // Check if we're waiting for clarification FIRST before resetting any state
      // If waiting for clarification, skip all state resets and don't start follow-up mode
      if (this.isWaitingForClarification) {
        console.log(`🔓 [${new Date().toISOString()}] Skipping state reset - waiting for clarification response`);
        // Don't reset state or start follow-up mode, the clarification listener will handle it
        this.isProcessingQuery = false;
        return;
      }

      // Reset state after follow-up query
      console.log(`⏱️  [${new Date().toISOString()}] 🧹 Resetting state after follow-up query`);
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
        console.log(`🔓 [${new Date().toISOString()}] Processing lock released - ready for next query`);
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
   * Start a clarification listening session (for yes/no responses)
   * Called when vision query decider returns UNSURE
   */
  private startClarificationListening(): void {
    console.log(`🎙️ [${new Date().toISOString()}] Starting clarification listening session`);

    // Clear timeouts
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.maxListeningTimeoutId) {
      clearTimeout(this.maxListeningTimeoutId);
      this.maxListeningTimeoutId = undefined;
    }
    this.transcriptProcessor.clear();

    // Set flag to indicate we're waiting for clarification
    // This will be checked in processQuery finally block
    this.isWaitingForClarification = true;

    // Use setTimeout to ensure this runs AFTER the current processQuery finally block completes
    setTimeout(() => {
      // Play the start listening sound
      this.audioManager.playStartListening();

      // Show listening indicator
      this.session.layouts.showTextWall("Listening for yes or no...", { durationMs: 10000 });

      // Set up to listen for the next transcription (yes/no response)
      this.isListeningToQuery = true;
      this.isProcessingQuery = false;
      this.transcriptionStartTime = Date.now();

      console.log(`🎙️ [${new Date().toISOString()}] Clarification listening active (isListeningToQuery: ${this.isListeningToQuery})`);

      // Set a 10-second timeout for clarification response
      this.maxListeningTimeoutId = setTimeout(() => {
        console.log(`[Session ${this.sessionId}]: Clarification timeout (10s) reached`);
        this.isWaitingForClarification = false;
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
          this.timeoutId = undefined;
        }
        // Process with whatever we have (or empty) - will default to "no" for camera
        this.processQuery("no", 10000);
      }, 10000);
    }, 100); // Small delay to let processQuery finish first
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
        console.log(`🔔 [Session ${this.sessionId}]: Follow-up sound ${this.followUpEnabled ? 'enabled' : 'disabled'}`);
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
      // If waiting for clarification response, don't reset state yet
      // but DO release the processing lock so the clarification response can be processed
      if (this.isWaitingForClarification) {
        console.log(`⏱️  [${new Date().toISOString()}] 🎙️ Waiting for clarification - skipping state reset but releasing lock`);
        this.isWaitingForClarification = false; // Reset flag, startClarificationListening will handle the rest
        this.isProcessingQuery = false; // Release lock so clarification response can be processed
        return;
      }

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

      // Start follow-up listening mode ONLY if query was actually processed
      // Skip follow-up for cancellations and affirmative phrases
      // IMPORTANT: Force follow-up mode if there's a pending disambiguation (AI asked "which app?")
      const hasPendingDisambiguation = this.queryProcessor.hasPendingDisambiguation();
      const shouldStartFollowUp = shouldEnterFollowUp && (this.followUpEnabled || hasPendingDisambiguation);

      if (shouldStartFollowUp) {
        if (hasPendingDisambiguation && !this.followUpEnabled) {
          console.log(`🔔 [${new Date().toISOString()}] Forcing follow-up mode for disambiguation response (follow-up normally disabled)`);
        }
        await this.startFollowUpListening();
      } else {
        // Release processing lock immediately if follow-up is disabled or query was cancelled
        this.isProcessingQuery = false;
        if (!shouldEnterFollowUp) {
          console.log(`🔓 [${new Date().toISOString()}] Skipping follow-up mode (query was cancelled or affirmative)`);
        } else {
          console.log(`🔓 [${new Date().toISOString()}] Processing lock released - ready for next query`);
        }
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
