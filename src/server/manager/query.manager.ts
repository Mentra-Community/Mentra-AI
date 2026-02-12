import {
  AppSession,
  PhotoData,
  GIVE_APP_CONTROL_OF_TOOL_RESPONSE,
  logger as _logger
} from '@mentra/sdk';
import { MiraAgent } from '../agents';
import { wrapText } from '../utils';
import { getLocationQueryType } from '../utils/geocoding-utils/location-keywords.util';
import { ChatManager } from './chat.manager';
import { PhotoManager } from './photo.manager';
import { AudioPlaybackManager } from './audio-playback.manager';
import { WakeWordDetector } from './wake-word.manager';

const logger = _logger.child({ service: 'QueryProcessor' });

interface QueryProcessorConfig {
  session: AppSession;
  sessionId: string;
  userId: string;
  miraAgent: MiraAgent;
  serverUrl: string;
  chatManager?: ChatManager;
  photoManager: PhotoManager;
  audioManager: AudioPlaybackManager;
  wakeWordDetector: WakeWordDetector;
  onConversationTurn?: (query: string, response: string, photoTimestamp?: number) => void;
  onLocationRequest?: () => Promise<void>;
}

/**
 * Handles query processing and response generation.
 *
 * Simplified single-pass pipeline:
 *   Wake word → photo (always) → MiraAgent (with image in user message) → response
 */
export class QueryProcessor {
  private session: AppSession;
  private sessionId: string;
  private userId: string;
  private miraAgent: MiraAgent;
  private serverUrl: string;
  private chatManager?: ChatManager;
  private photoManager: PhotoManager;
  private audioManager: AudioPlaybackManager;
  private wakeWordDetector: WakeWordDetector;
  private currentQueryMessageId?: string;
  private onConversationTurn?: (query: string, response: string, photoTimestamp?: number) => void;
  private onLocationRequest?: () => Promise<void>;

  // Set to true by TranscriptionManager when a wake word interrupts this query.
  // Checked before speaking so an interrupted query doesn't play audio over the new one.
  public aborted: boolean = false;

  constructor(config: QueryProcessorConfig) {
    this.session = config.session;
    this.sessionId = config.sessionId;
    this.userId = config.userId;
    this.miraAgent = config.miraAgent;
    this.serverUrl = config.serverUrl;
    this.chatManager = config.chatManager;
    this.photoManager = config.photoManager;
    this.audioManager = config.audioManager;
    this.wakeWordDetector = config.wakeWordDetector;
    this.onConversationTurn = config.onConversationTurn;
    this.onLocationRequest = config.onLocationRequest;
  }

  /**
   * Process and respond to the user's query
   */
  async processQuery(rawText: string, timerDuration: number, transcriptionStartTime: number, activeSpeakerId?: string): Promise<boolean> {
    this.aborted = false; // Reset abort flag for this new query
    const processQueryStartTime = Date.now();
    console.log(`🚀 processQuery START`);

    logger.debug("processQuery called");

    // Calculate the actual duration from transcriptionStartTime to now
    const endTime = Date.now();
    let durationSeconds = 3; // fallback default
    if (transcriptionStartTime > 0) {
      durationSeconds = Math.max(1, Math.ceil((endTime - transcriptionStartTime) / 1000));
    } else if (timerDuration) {
      durationSeconds = Math.max(1, Math.ceil(timerDuration / 1000));
    }

    // console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📊 Transcription duration: ${durationSeconds}s`);

    // Play processing sounds IMMEDIATELY so user gets instant feedback
    const stopProcessingSounds = await this.audioManager.playProcessingSounds();

    // Fetch transcript from backend
    const transcriptionResponse = await this.fetchTranscript(durationSeconds, transcriptionStartTime);
    if (!transcriptionResponse) {
      stopProcessingSounds();
      return false;
    }

    // Get the transcript text - use only the LAST segment (final or interim)
    let segments = transcriptionResponse.segments;
    let rawCombinedText = '';

    // Filter segments by speaker ID if we have an active speaker locked
    if (activeSpeakerId && segments.length > 0) {
      const filteredSegments = segments.filter((seg: any) => seg.speakerId === activeSpeakerId);
      if (filteredSegments.length > 0) {
        segments = filteredSegments;
      }
    }

    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      rawCombinedText = lastSegment.text;
    }

    // console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📊 Raw transcript: "${rawCombinedText}"`);

    // Remove wake word from query
    let query = this.wakeWordDetector.removeWakeWord(rawCombinedText);

    // Clear transcripts from backend to prevent accumulation
    this.clearTranscripts(transcriptionStartTime).catch((err: Error) => {
      logger.warn(`Failed to clear transcripts: ${err.message}`);
    });

    if (query.trim().length === 0) {
      stopProcessingSounds();
      await this.audioManager.playCancellation();
      this.session.layouts.showTextWall(
        wrapText("No query provided.", 30),
        { durationMs: 3000 }
      );
      return false;
    }

    try {
      // LAZY GEOCODING: Only fetch location data when user asks location-related questions
      const locationQueryType = getLocationQueryType(query);
      if (locationQueryType !== 'none' && this.onLocationRequest) {
        await this.onLocationRequest();
      }

      // Show the query being processed
      this.showProcessingMessage(query);

      // Check if this is a response to a pending disambiguation (e.g., user answering "which app?")
      if (this.miraAgent.hasPendingDisambiguation()) {
        stopProcessingSounds();

        if (this.chatManager && query.trim().length > 0 && !this.currentQueryMessageId) {
          this.currentQueryMessageId = this.chatManager.addUserMessage(this.userId, query);
          this.chatManager.setProcessing(this.userId, true);
        }

        const agentResponse = await this.miraAgent.handleContext({
          query,
          originalQuery: query,
          photo: null,
          getPhotoCallback: async () => null,
          hasDisplay: this.session.capabilities?.hasDisplay,
        });

        await this.handleAgentResponse(agentResponse, query, null);
        return true;
      }

      // ── Single-pass pipeline: get photo, route to MiraAgent ──

      // Try to get cached photo first (non-blocking), fall back to waiting
      let photo = await this.photoManager.getPhoto(false);
      if (!photo) {
        photo = await this.photoManager.getPhoto(true);
      }

      // Send query to frontend
      if (this.chatManager && query.trim().length > 0 && !this.currentQueryMessageId) {
        this.currentQueryMessageId = this.chatManager.addUserMessage(this.userId, query);
        this.chatManager.setProcessing(this.userId, true);
      }

      // Create callback for agent to wait for photo if needed (fallback)
      const getPhotoCallback = async (): Promise<PhotoData | null> => {
        return await this.photoManager.getPhoto(true);
      };

      const hasDisplay = this.session.capabilities?.hasDisplay;
      const inputData = { query, originalQuery: query, photo, getPhotoCallback, hasDisplay };

      // Single agent call — MiraAgent handles everything (vision + tools + text)
      const agentResponse = await this.miraAgent.handleContext(inputData);

      // Stop processing sounds
      stopProcessingSounds();

      // If this query was aborted by a wake word interrupt, skip response delivery
      if (this.aborted) {
        // Play the start-listening sound so user gets feedback that interrupt worked
        this.audioManager.playStartListening().catch(() => {});
        return false;
      }

      // Handle response
      await this.handleAgentResponse(agentResponse, query, photo);

      const totalProcessTime = Date.now() - processQueryStartTime;
      console.log(`🏁 processQuery COMPLETE (${(totalProcessTime / 1000).toFixed(2)}s)`);

      return true;

    } catch (error) {
      // Error logged by logger below
      logger.error(error, `[Session ${this.sessionId}]: Error processing query:`);
      await this.audioManager.showOrSpeakText("Sorry, there was an error processing your request.");
      stopProcessingSounds();
      return false;
    }
  }

  /**
   * Fetch transcript from backend
   */
  private async fetchTranscript(durationSeconds: number, transcriptionStartTime?: number): Promise<any | null> {
    let backendUrl = `${this.serverUrl}/api/transcripts/${this.sessionId}?duration=${durationSeconds}`;
    if (transcriptionStartTime && transcriptionStartTime > 0) {
      backendUrl += `&startTime=${new Date(transcriptionStartTime).toISOString()}`;
    }

    try {
      logger.debug(`[Session ${this.sessionId}]: Fetching transcript from: ${backendUrl}`);
      const transcriptResponse = await fetch(backendUrl);

      logger.debug(`[Session ${this.sessionId}]: Response status: ${transcriptResponse.status}`);

      if (!transcriptResponse.ok) {
        throw new Error(`HTTP ${transcriptResponse.status}: ${transcriptResponse.statusText}`);
      }

      const responseText = await transcriptResponse.text();
      logger.debug(`[Session ${this.sessionId}]: Raw response body:`, responseText);

      if (!responseText || responseText.trim() === '') {
        throw new Error('Empty response body received');
      }

      const transcriptionResponse = JSON.parse(responseText);

      if (!transcriptionResponse || !transcriptionResponse.segments || !Array.isArray(transcriptionResponse.segments)) {
        logger.error({ transcriptionResponse }, `[Session ${this.sessionId}]: Invalid response structure:`);
        this.session.layouts.showTextWall(
          wrapText("Sorry, the transcript format was invalid. Please try again.", 30),
          { durationMs: 5000 }
        );
        return null;
      }

      return transcriptionResponse;

    } catch (fetchError) {
      logger.error(fetchError, `[Session ${this.sessionId}]: Error fetching transcript:`);
      this.session.layouts.showTextWall(
        wrapText("Sorry, there was an error retrieving your transcript. Please try again.", 30),
        { durationMs: 5000 }
      );
      return null;
    }
  }

  /**
   * Clear transcripts from backend to prevent accumulation
   */
  private async clearTranscripts(beforeTimestamp: number): Promise<void> {
    const clearUrl = `${this.serverUrl}/api/transcripts/${this.sessionId}/clear?before=${beforeTimestamp}`;
    try {
      logger.debug(`[Session ${this.sessionId}]: Clearing transcripts before ${beforeTimestamp}`);
      const response = await fetch(clearUrl, { method: 'DELETE' });
      if (!response.ok) {
        logger.warn(`[Session ${this.sessionId}]: Failed to clear transcripts: ${response.status}`);
      }
    } catch (error) {
      logger.warn(`[Session ${this.sessionId}]: Error clearing transcripts:`, error);
    }
  }

  /**
   * Show processing message on display
   */
  private showProcessingMessage(query: string): void {
    let displayQuery = query;
    if (displayQuery.length > 60) {
      displayQuery = displayQuery.slice(0, 60).trim() + ' ...';
    }
    this.session.layouts.showTextWall(
      wrapText("Processing query: " + displayQuery, 30),
      { durationMs: 8000 }
    );
  }

  /**
   * Handle agent response and send to user
   */
  private async handleAgentResponse(
    agentResponse: any,
    query: string,
    photo: PhotoData | null,
  ): Promise<void> {
    let finalAnswer: string;
    let needsCamera = false;

    if (agentResponse && typeof agentResponse === 'object' && 'answer' in agentResponse) {
      finalAnswer = agentResponse.answer;
      needsCamera = agentResponse.needsCamera || false;
    } else if (typeof agentResponse === 'string') {
      finalAnswer = agentResponse;
    } else {
      finalAnswer = agentResponse;
    }

    // console.log(`🎯 needsCamera flag: ${needsCamera}`);

    // Log query + answer summary
    console.log(`────────────────────────────────────`);
    console.log(`📝 Query:  "${query}"`);
    console.log(`🤖 Answer: ${finalAnswer || '(no answer)'}`);
    console.log(`────────────────────────────────────`);

    // Always update user message with photo if one was captured
    await this.updateMessageWithPhoto(needsCamera, query, photo);

    if (!finalAnswer) {
      logger.info("No insight found");
      const errorMsg = "Sorry, I couldn't find an answer to that.";
      await this.audioManager.showOrSpeakText(errorMsg);

      if (this.chatManager) {
        this.chatManager.setProcessing(this.userId, false);
        this.chatManager.addAssistantMessage(this.userId, errorMsg);
      }
    } else if (finalAnswer === GIVE_APP_CONTROL_OF_TOOL_RESPONSE) {
      if (this.chatManager) {
        this.chatManager.setProcessing(this.userId, false);
      }
    } else {
      const handled = this.tryHandleSpecialEvent(finalAnswer);

      if (!handled) {
        if (this.chatManager) {
          this.chatManager.setProcessing(this.userId, false);
          this.chatManager.addAssistantMessage(this.userId, finalAnswer);
        } else {
          console.warn(`⚠️  [WEBVIEW] ChatManager not available - webview won't receive response`);
        }

        await this.audioManager.showOrSpeakText(finalAnswer);

        if (this.onConversationTurn) {
          const photoTimestamp = photo ? Date.now() : undefined;
          this.onConversationTurn(query, finalAnswer, photoTimestamp);
        }
      }
    }
  }

  /**
   * Update user message with photo if available
   */
  private async updateMessageWithPhoto(_needsCamera: boolean, query: string, photo: PhotoData | null): Promise<void> {
    let finalPhoto = photo;
    if (!finalPhoto) {
      const cachedPhoto = this.photoManager.getCachedPhoto();
      if (cachedPhoto) {
        finalPhoto = cachedPhoto;
      }
    }

    if (this.chatManager && finalPhoto) {
      const photoBase64 = `data:${finalPhoto.mimeType};base64,${finalPhoto.buffer.toString('base64')}`;

      if (this.currentQueryMessageId) {
        const updated = this.chatManager.updateUserMessage(this.userId, this.currentQueryMessageId, query, photoBase64);
        if (!updated) {
          this.chatManager.addUserMessage(this.userId, query, photoBase64);
        }
      } else {
        this.chatManager.addUserMessage(this.userId, query, photoBase64);
      }
    }
  }

  /**
   * Try to handle special event responses (JSON formatted)
   */
  private tryHandleSpecialEvent(finalAnswer: string): boolean {
    if (typeof finalAnswer === 'string') {
      try {
        const parsed = JSON.parse(finalAnswer);
        if (parsed && parsed.event) {
          switch (parsed.event) {
            default:
              break;
          }
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }
    return false;
  }

  /**
   * Clear the current query message ID
   */
  clearCurrentQueryMessageId(): void {
    this.currentQueryMessageId = undefined;
  }

  /**
   * Check if there's a pending disambiguation
   */
  hasPendingDisambiguation(): boolean {
    return this.miraAgent.hasPendingDisambiguation();
  }
}
