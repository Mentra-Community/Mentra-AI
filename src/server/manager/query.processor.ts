import {
  AppSession,
  PhotoData,
  GIVE_APP_CONTROL_OF_TOOL_RESPONSE,
  logger as _logger
} from '@mentra/sdk';
import { MiraAgent } from '../agents';
import { wrapText } from '../utils';
import { getLocationQueryType } from '../utils/location-query-decider';
import { ChatManager } from './chat.manager';
import { PhotoManager } from './photo.manager';
import { AudioPlaybackManager } from './audio-playback.manager';
import { WakeWordDetector } from './wake-word.detector';

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
    console.log(`\n${"█".repeat(70)}`);
    console.log(`⏱️  [TIMESTAMP] 🚀 processQuery START: ${new Date().toISOString()}`);
    console.log(`${"█".repeat(70)}\n`);

    logger.debug("processQuery called");

    // Calculate the actual duration from transcriptionStartTime to now
    const endTime = Date.now();
    let durationSeconds = 3; // fallback default
    if (transcriptionStartTime > 0) {
      durationSeconds = Math.max(1, Math.ceil((endTime - transcriptionStartTime) / 1000));
    } else if (timerDuration) {
      durationSeconds = Math.max(1, Math.ceil(timerDuration / 1000));
    }

    console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📊 Transcription duration: ${durationSeconds}s`);

    // Play processing sounds IMMEDIATELY so user gets instant feedback
    const stopProcessingSounds = await this.audioManager.playProcessingSounds();

    // Fetch transcript from backend
    const transcriptionResponse = await this.fetchTranscript(durationSeconds, processQueryStartTime, transcriptionStartTime);
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
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🔒 Filtered to speaker ${activeSpeakerId}: ${filteredSegments.length}/${segments.length} segments`);
        segments = filteredSegments;
      } else {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ⚠️ No segments found for speaker ${activeSpeakerId}, using all segments`);
      }
    }

    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      rawCombinedText = lastSegment.text;
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📊 Using LAST segment (${lastSegment.isFinal ? 'FINAL' : 'interim'}) out of ${segments.length} total`);
    }

    console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📊 Raw transcript: "${rawCombinedText}"`);

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
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📝 Query extracted: "${query}"`);

      // LAZY GEOCODING: Only fetch location data when user asks location-related questions
      const locationQueryType = getLocationQueryType(query);
      if (locationQueryType !== 'none' && this.onLocationRequest) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📍 Location query detected (${locationQueryType}) - fetching location...`);
        await this.onLocationRequest();
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📍 Location data fetched`);
      }

      // Show the query being processed
      this.showProcessingMessage(query);

      // Check if this is a response to a pending disambiguation (e.g., user answering "which app?")
      if (this.miraAgent.hasPendingDisambiguation()) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📋 Pending disambiguation detected - routing to MiraAgent`);
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

        await this.handleAgentResponse(agentResponse, query, null, processQueryStartTime);
        return true;
      }

      // ── Single-pass pipeline: get photo, route to MiraAgent ──

      // Try to get cached photo first (non-blocking), fall back to waiting
      const photoStartTime = Date.now();
      console.log(`⏱️  [+${photoStartTime - processQueryStartTime}ms] 📸 Checking for photo...`);
      let photo = await this.photoManager.getPhoto(false);
      if (!photo) {
        // Photo not ready yet — wait up to 3s (shorter than the old 5s to avoid blocking)
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📸 No cached photo, waiting up to 3s...`);
        photo = await this.photoManager.getPhoto(true);
      }
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ${photo ? '✅ Photo retrieved' : '⚪ No photo available'}`);

      // Send query to frontend
      if (this.chatManager && query.trim().length > 0 && !this.currentQueryMessageId) {
        this.currentQueryMessageId = this.chatManager.addUserMessage(this.userId, query);
        this.chatManager.setProcessing(this.userId, true);
      }

      // Create callback for agent to wait for photo if needed (fallback)
      const getPhotoCallback = async (): Promise<PhotoData | null> => {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📸 Agent requested photo wait - calling getPhoto(true)...`);
        return await this.photoManager.getPhoto(true);
      };

      const hasDisplay = this.session.capabilities?.hasDisplay;
      const inputData = { query, originalQuery: query, photo, getPhotoCallback, hasDisplay };

      // Single agent call — MiraAgent handles everything (vision + tools + text)
      const agentStartTime = Date.now();
      console.log(`⏱️  [+${agentStartTime - processQueryStartTime}ms] 🤖 Routing to MiraAgent (single pass)...`);
      const agentResponse = await this.miraAgent.handleContext(inputData);
      const agentEndTime = Date.now();
      console.log(`⏱️  [+${agentEndTime - processQueryStartTime}ms] ✅ MiraAgent completed (took ${agentEndTime - agentStartTime}ms)`);

      // Stop processing sounds
      stopProcessingSounds();

      // If this query was aborted by a wake word interrupt, skip response delivery
      if (this.aborted) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🚫 Query was aborted — skipping response`);
        // Play the start-listening sound so user gets feedback that interrupt worked
        this.audioManager.playStartListening().catch(() => {});
        return false;
      }

      // Handle response
      await this.handleAgentResponse(agentResponse, query, photo, processQueryStartTime);

      const totalProcessTime = Date.now() - processQueryStartTime;
      console.log(`\n${"█".repeat(70)}`);
      console.log(`⏱️  [TIMESTAMP] 🏁 processQuery COMPLETE!`);
      console.log(`⏱️  Total time from start to finish: ${(totalProcessTime / 1000).toFixed(2)}s (${totalProcessTime}ms)`);
      console.log(`${"█".repeat(70)}\n`);

      return true;

    } catch (error) {
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ❌ Error in processQuery`);
      logger.error(error, `[Session ${this.sessionId}]: Error processing query:`);
      await this.audioManager.showOrSpeakText("Sorry, there was an error processing your request.");
      stopProcessingSounds();
      return false;
    }
  }

  /**
   * Fetch transcript from backend
   */
  private async fetchTranscript(durationSeconds: number, processQueryStartTime: number, transcriptionStartTime?: number): Promise<any | null> {
    let backendUrl = `${this.serverUrl}/api/transcripts/${this.sessionId}?duration=${durationSeconds}`;
    if (transcriptionStartTime && transcriptionStartTime > 0) {
      backendUrl += `&startTime=${new Date(transcriptionStartTime).toISOString()}`;
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🕐 Filtering transcripts after timestamp: ${transcriptionStartTime} (${new Date(transcriptionStartTime).toISOString()})`);
    }

    try {
      const fetchStartTime = Date.now();
      console.log(`⏱️  [+${fetchStartTime - processQueryStartTime}ms] 🌐 Fetching transcript from: ${backendUrl}`);

      logger.debug(`[Session ${this.sessionId}]: Fetching transcript from: ${backendUrl}`);
      const transcriptResponse = await fetch(backendUrl);

      const fetchEndTime = Date.now();
      console.log(`⏱️  [+${fetchEndTime - processQueryStartTime}ms] ✅ Transcript fetched (took ${fetchEndTime - fetchStartTime}ms)`);

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
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ❌ Error fetching transcript`);
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
    processQueryStartTime: number
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

    console.log(`🎯 needsCamera flag: ${needsCamera}`);

    // Always update user message with photo if one was captured
    await this.updateMessageWithPhoto(needsCamera, query, photo);

    if (!finalAnswer) {
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ⚠️  No agent response received`);
      logger.info("No insight found");
      const errorMsg = "Sorry, I couldn't find an answer to that.";
      await this.audioManager.showOrSpeakText(errorMsg);

      if (this.chatManager) {
        this.chatManager.setProcessing(this.userId, false);
        this.chatManager.addAssistantMessage(this.userId, errorMsg);
      }
    } else if (finalAnswer === GIVE_APP_CONTROL_OF_TOOL_RESPONSE) {
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🎮 App control handed over to tool`);
      if (this.chatManager) {
        this.chatManager.setProcessing(this.userId, false);
      }
    } else {
      const handled = this.tryHandleSpecialEvent(finalAnswer);

      if (!handled) {
        const displayStartTime = Date.now();
        console.log(`⏱️  [+${displayStartTime - processQueryStartTime}ms] 📱 Sending response to user...`);

        if (this.chatManager) {
          console.log(`\n${"=".repeat(70)}`);
          console.log(`📱 [WEBVIEW] Sending response to webview for user: ${this.userId}`);
          console.log(`📱 [WEBVIEW] Response: "${finalAnswer.substring(0, 100)}${finalAnswer.length > 100 ? '...' : ''}"`);
          console.log(`${"=".repeat(70)}\n`);
          this.chatManager.setProcessing(this.userId, false);
          this.chatManager.addAssistantMessage(this.userId, finalAnswer);
        } else {
          console.warn(`⚠️  [WEBVIEW] ChatManager not available - webview won't receive response`);
        }

        const responseTime = Date.now() - processQueryStartTime;
        console.log(`\n${"=".repeat(70)}`);
        console.log(`⏱️  [TIMESTAMP] 🎯 AI RESPONSE READY!`);
        console.log(`⏱️  Time from query to response: ${(responseTime / 1000).toFixed(2)}s (${responseTime}ms)`);
        console.log(`${"=".repeat(70)}\n`);

        await this.audioManager.showOrSpeakText(finalAnswer);

        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ✅ Response sent and audio completed`);

        if (this.onConversationTurn) {
          const photoTimestamp = photo ? Date.now() : undefined;
          this.onConversationTurn(query, finalAnswer, photoTimestamp);
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 💾 Conversation turn saved to database`);
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
      console.log(`📱 [WEBVIEW] 🔍 Photo not passed directly - checking cache after agent processing...`);
      const cachedPhoto = this.photoManager.getCachedPhoto();
      if (cachedPhoto) {
        finalPhoto = cachedPhoto;
        console.log(`📱 [WEBVIEW] ✅ Found photo in cache after agent processing`);
      } else {
        console.log(`📱 [WEBVIEW] ⚠️ No photo in cache`);
      }
    }

    if (this.chatManager && finalPhoto) {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`📱 [WEBVIEW] Updating message with photo for user: ${this.userId}`);
      const photoBase64 = `data:${finalPhoto.mimeType};base64,${finalPhoto.buffer.toString('base64')}`;
      console.log(`📱 [WEBVIEW] 📷 Including photo (${finalPhoto.mimeType}, ${finalPhoto.size} bytes) - always streaming photo to frontend`);
      console.log(`${"=".repeat(70)}\n`);

      if (this.currentQueryMessageId) {
        const updated = this.chatManager.updateUserMessage(this.userId, this.currentQueryMessageId, query, photoBase64);
        if (!updated) {
          console.warn(`📱 [WEBVIEW] ⚠️ Failed to update message ${this.currentQueryMessageId}, creating new message`);
          this.chatManager.addUserMessage(this.userId, query, photoBase64);
        } else {
          console.log(`📱 [WEBVIEW] ✅ Successfully updated message ${this.currentQueryMessageId} with photo`);
        }
      } else {
        console.warn(`📱 [WEBVIEW] ⚠️ No currentQueryMessageId available, creating new message`);
        this.chatManager.addUserMessage(this.userId, query, photoBase64);
      }
    } else if (this.chatManager && !finalPhoto) {
      console.log(`📱 [WEBVIEW] ℹ️ No photo available for this query`);
    } else if (!this.chatManager) {
      console.warn(`⚠️  [WEBVIEW] ChatManager not available - webview won't receive updates`);
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
