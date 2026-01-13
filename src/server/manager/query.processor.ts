import {
  AppSession,
  PhotoData,
  GIVE_APP_CONTROL_OF_TOOL_RESPONSE,
  logger as _logger
} from '@mentra/sdk';
import { MiraAgent } from '../agents';
import { wrapText } from '../utils';
import { visionKeywords } from '../constant/wakeWords';
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
}

/**
 * Handles query processing and response generation
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
  }

  /**
   * Process and respond to the user's query
   */
  async processQuery(rawText: string, timerDuration: number, transcriptionStartTime: number): Promise<void> {
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

    // Fetch transcript from backend
    const transcriptionResponse = await this.fetchTranscript(durationSeconds, processQueryStartTime, transcriptionStartTime);
    if (!transcriptionResponse) {
      return;
    }

    // Get the transcript text - use only the LAST segment (final or interim)
    // Speech-to-text providers send cumulative text in each segment, so we only need the last one
    // Using multiple segments causes duplication when queries arrive close together
    const segments = transcriptionResponse.segments;
    let rawCombinedText = '';

    if (segments.length > 0) {
      // Always use the LAST segment - it contains the most complete/recent text
      const lastSegment = segments[segments.length - 1];
      rawCombinedText = lastSegment.text;
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📊 Using LAST segment (${lastSegment.isFinal ? 'FINAL' : 'interim'}) out of ${segments.length} total`);
    }

    console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📊 Raw transcript: "${rawCombinedText}"`);

    // Remove wake word from query
    const query = this.wakeWordDetector.removeWakeWord(rawCombinedText);

    // Clear transcripts from backend to prevent accumulation
    this.clearTranscripts(transcriptionStartTime).catch((err: Error) => {
      logger.warn(`Failed to clear transcripts: ${err.message}`);
    });

    // Check if query is a cancellation phrase (safety net)
    if (this.wakeWordDetector.isCancellation(query)) {
      logger.debug("Cancellation detected in processQuery");
      await this.audioManager.playCancellation();
      this.session.layouts.showTextWall("Cancelled", { durationMs: 2000 });
      return;
    }

    if (query.trim().length === 0) {
      this.session.layouts.showTextWall(
        wrapText("No query provided.", 30),
        { durationMs: 5000 }
      );
      return;
    }

    // Play processing sounds
    const stopProcessingSounds = await this.audioManager.playProcessingSounds();

    try {
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📝 Query extracted: "${query}"`);

      // Show the query being processed
      this.showProcessingMessage(query);

      // Detect vision queries to clear conversation history
      const isVisionQuery = this.isVisionQuery(query);
      if (isVisionQuery) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 👁️  VISION QUERY DETECTED - Clearing conversation history`);
        this.miraAgent.clearConversationHistory();
      }

      // Get photo without waiting (non-blocking) - returns cached photo or null
      const photoStartTime = Date.now();
      console.log(`⏱️  [+${photoStartTime - processQueryStartTime}ms] 📸 Getting photo from wake word activation...`);
      const photo = await this.photoManager.getPhoto(false);
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ${photo ? '✅ Photo retrieved' : '⚪ No photo available (will wait only if needed)'}`);

      // Process with agent
      const agentStartTime = Date.now();
      console.log(`⏱️  [+${agentStartTime - processQueryStartTime}ms] 🤖 Invoking MiraAgent.handleContext...`);

      // Send query to frontend if not already sent
      if (this.chatManager && query.trim().length > 0 && !this.currentQueryMessageId) {
        this.currentQueryMessageId = this.chatManager.addUserMessage(this.userId, query);
        this.chatManager.setProcessing(this.userId, true);
      }

      // Create callback for agent to wait for photo if needed
      const getPhotoCallback = async (): Promise<PhotoData | null> => {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📸 Agent requested photo wait - calling getPhoto(true)...`);
        return await this.photoManager.getPhoto(true);
      };

      const hasDisplay = this.session.capabilities?.hasDisplay;
      const inputData = { query, photo, getPhotoCallback, hasDisplay };
      const agentResponse = await this.miraAgent.handleContext(inputData);

      const agentEndTime = Date.now();
      console.log(`⏱️  [+${agentEndTime - processQueryStartTime}ms] ✅ MiraAgent completed (took ${agentEndTime - agentStartTime}ms)`);

      // Stop processing sounds
      stopProcessingSounds();

      // Handle response
      await this.handleAgentResponse(agentResponse, query, photo, processQueryStartTime);

      const totalProcessTime = Date.now() - processQueryStartTime;
      console.log(`\n${"█".repeat(70)}`);
      console.log(`⏱️  [TIMESTAMP] 🏁 processQuery COMPLETE!`);
      console.log(`⏱️  Total time from start to finish: ${(totalProcessTime / 1000).toFixed(2)}s (${totalProcessTime}ms)`);
      console.log(`${"█".repeat(70)}\n`);

    } catch (error) {
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ❌ Error in processQuery`);
      logger.error(error, `[Session ${this.sessionId}]: Error processing query:`);
      await this.audioManager.showOrSpeakText("Sorry, there was an error processing your request.");
      stopProcessingSounds();
    }
  }

  /**
   * Fetch transcript from backend
   */
  private async fetchTranscript(durationSeconds: number, processQueryStartTime: number, transcriptionStartTime?: number): Promise<any | null> {
    // Add timestamp filter to prevent getting old transcripts
    let backendUrl = `${this.serverUrl}/api/transcripts/${this.sessionId}?duration=${durationSeconds}`;
    if (transcriptionStartTime && transcriptionStartTime > 0) {
      // Use startTime parameter which the backend supports (ISO format)
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
   * Check if query is a vision query
   */
  private isVisionQuery(query: string): boolean {
    const queryLower = query.toLowerCase();
    return visionKeywords.some(keyword => queryLower.includes(keyword));
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
    // Extract answer and needsCamera flag from response
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

    // Update user message with photo if camera was needed
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

        // Send response to webview FIRST (before audio starts playing)
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

        // Log response time (query to AI response ready, before audio)
        const responseTime = Date.now() - processQueryStartTime;
        console.log(`\n${"=".repeat(70)}`);
        console.log(`⏱️  [TIMESTAMP] 🎯 AI RESPONSE READY!`);
        console.log(`⏱️  Time from query to response: ${(responseTime / 1000).toFixed(2)}s (${responseTime}ms)`);
        console.log(`${"=".repeat(70)}\n`);

        // Then display/speak on glasses
        // We await this to ensure audio completes before releasing the processing lock
        await this.audioManager.showOrSpeakText(finalAnswer);

        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ✅ Response sent and audio completed`);
      }
    }
  }

  /**
   * Update user message with photo if needed
   */
  private async updateMessageWithPhoto(needsCamera: boolean, query: string, photo: PhotoData | null): Promise<void> {
    let finalPhoto = photo;
    if (needsCamera && !finalPhoto) {
      console.log(`📱 [WEBVIEW] 🔍 Camera needed but photo not available - checking cache after agent processing...`);
      const cachedPhoto = this.photoManager.getCachedPhoto();
      if (cachedPhoto) {
        finalPhoto = cachedPhoto;
        console.log(`📱 [WEBVIEW] ✅ Found photo in cache after agent processing`);
      } else {
        console.log(`📱 [WEBVIEW] ⚠️ No photo in cache - agent may not have received it yet`);
      }
    }

    if (this.chatManager && needsCamera && finalPhoto) {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`📱 [WEBVIEW] Updating message with photo for user: ${this.userId}`);
      const photoBase64 = `data:${finalPhoto.mimeType};base64,${finalPhoto.buffer.toString('base64')}`;
      console.log(`📱 [WEBVIEW] 📷 Including photo (${finalPhoto.mimeType}, ${finalPhoto.size} bytes) - camera was needed`);
      console.log(`${"=".repeat(70)}\n`);

      // Try to update the existing message if we have its ID
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
    } else if (this.chatManager && needsCamera && !finalPhoto) {
      console.log(`📱 [WEBVIEW] ⚠️ Camera was needed but no photo available even after checking cache`);
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

        // Generic event handler for tool outputs
        if (parsed && parsed.event) {
          switch (parsed.event) {
            default:
              // Unknown event, fall through to default display
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
}
