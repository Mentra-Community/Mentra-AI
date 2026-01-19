import {
  AppSession,
  PhotoData,
  GIVE_APP_CONTROL_OF_TOOL_RESPONSE,
  logger as _logger
} from '@mentra/sdk';
import { MiraAgent, CameraQuestionAgent } from '../agents';
import { wrapText, getCancellationDecider } from '../utils';
import { getVisionQueryDecider, VisionQueryDecider, VisionDecision } from '../utils/vision-query-decider';
import { getRecallMemoryDecider, RecallMemoryDecider, RecallDecision } from '../utils/recall-memory-decider';
import { getAppToolQueryDecider, AppToolQueryDecider, AppToolDecision } from '../utils/app-tool-query-decider';
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
  cameraQuestionAgent?: CameraQuestionAgent;
  serverUrl: string;
  chatManager?: ChatManager;
  photoManager: PhotoManager;
  audioManager: AudioPlaybackManager;
  wakeWordDetector: WakeWordDetector;
  onRequestClarification?: () => void; // Callback to trigger new listening session
  onConversationTurn?: (query: string, response: string, photoTimestamp?: number) => void; // Callback to save conversation turn
}

/**
 * Pending clarification state for ambiguous vision queries
 */
interface PendingClarification {
  originalQuery: string;
  photo: PhotoData | null;
  processQueryStartTime: number;
}

/**
 * Handles query processing and response generation
 */
export class QueryProcessor {
  private session: AppSession;
  private sessionId: string;
  private userId: string;
  private miraAgent: MiraAgent;
  private cameraQuestionAgent?: CameraQuestionAgent;
  private serverUrl: string;
  private chatManager?: ChatManager;
  private photoManager: PhotoManager;
  private audioManager: AudioPlaybackManager;
  private wakeWordDetector: WakeWordDetector;
  private currentQueryMessageId?: string;
  private visionQueryDecider: VisionQueryDecider;
  private recallMemoryDecider: RecallMemoryDecider;
  private appToolQueryDecider: AppToolQueryDecider;
  private onRequestClarification?: () => void;
  private onConversationTurn?: (query: string, response: string, photoTimestamp?: number) => void;
  private pendingClarification: PendingClarification | null = null;

  constructor(config: QueryProcessorConfig) {
    this.session = config.session;
    this.sessionId = config.sessionId;
    this.userId = config.userId;
    this.miraAgent = config.miraAgent;
    this.cameraQuestionAgent = config.cameraQuestionAgent;
    this.serverUrl = config.serverUrl;
    this.chatManager = config.chatManager;
    this.photoManager = config.photoManager;
    this.audioManager = config.audioManager;
    this.wakeWordDetector = config.wakeWordDetector;
    this.visionQueryDecider = getVisionQueryDecider();
    this.recallMemoryDecider = getRecallMemoryDecider();
    this.appToolQueryDecider = getAppToolQueryDecider();
    this.onRequestClarification = config.onRequestClarification;
    this.onConversationTurn = config.onConversationTurn;
  }

  /**
   * Process and respond to the user's query
   */
  async processQuery(rawText: string, timerDuration: number, transcriptionStartTime: number): Promise<boolean> {
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
      return false;
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

    // Check if query is just an affirmative phrase (e.g., "Hey Mentra, thank you")
    const cancellationDecider = getCancellationDecider();
    const isAffirmative = cancellationDecider.isAffirmativePhrase(query);

    if (isAffirmative) {
      console.log(`✅ [${new Date().toISOString()}] Initial query is affirmative phrase - not processing`);
      // Play a simple acknowledgment instead of entering follow-up mode
      await this.audioManager.showOrSpeakText("You're welcome!");
      return false; // Don't enter follow-up mode for affirmative phrases
    }

    // Check if query is a cancellation phrase (safety net)
    if (this.wakeWordDetector.isCancellation(query)) {
      logger.debug("Cancellation detected in processQuery");
      await this.audioManager.playCancellation();
      this.session.layouts.showTextWall("Cancelled", { durationMs: 2000 });
      return false; // Don't enter follow-up mode for cancellation phrases
    }

    if (query.trim().length === 0) {
      this.session.layouts.showTextWall(
        wrapText("No query provided.", 30),
        { durationMs: 5000 }
      );
      return false;
    }

    // Check if this is a clarification response to a pending vision query
    if (this.pendingClarification) {
      await this.handleClarificationResponse(query);
      return false; // Clarification responses should NOT enter follow-up mode (they're just yes/no answers)
    }

    // Play processing sounds
    const stopProcessingSounds = await this.audioManager.playProcessingSounds();

    try {
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📝 Query extracted: "${query}"`);

      // Show the query being processed
      this.showProcessingMessage(query);

      // Get conversation history for context-aware decisions
      const conversationHistory = this.miraAgent.getConversationHistoryForDecider();

      // Check if this is a response to a pending disambiguation (e.g., user answering "which app?")
      // This check MUST happen before recallDecision to prevent misclassification as RECALL
      if (this.miraAgent.hasPendingDisambiguation()) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📋 Pending disambiguation detected - routing to MiraAgent`);
        stopProcessingSounds();

        // Send query to frontend
        if (this.chatManager && query.trim().length > 0 && !this.currentQueryMessageId) {
          this.currentQueryMessageId = this.chatManager.addUserMessage(this.userId, query);
          this.chatManager.setProcessing(this.userId, true);
        }

        // Route directly to MiraAgent which will handle the disambiguation response
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

      // Check if this is a memory recall or vision retry query (AI-powered with conversation context)
      const recallDecision = await this.recallMemoryDecider.checkIfNeedsRecall(query, conversationHistory);

      // Handle VISION_RETRY - user is retrying a vision query (e.g., "how about now?")
      if (recallDecision === RecallDecision.VISION_RETRY) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🔄 VISION RETRY DETECTED - Injecting previous context`);

        // Get the last conversation turn to find what the user was originally asking about
        const fullHistory = this.miraAgent.getFullConversationHistory();
        let enhancedQuery = query;

        if (fullHistory.length > 0) {
          // Get the most recent turn - this should contain the previous vision query
          const lastTurn = fullHistory[fullHistory.length - 1];
          // Enhance the retry query with the previous context
          enhancedQuery = `${lastTurn.query}\n\n[USER IS NOW SAYING: "${query}" - This is a retry/follow-up. They are repositioning to show you what they originally asked about. Answer their original question: "${lastTurn.query}"]`;
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📚 Enhanced retry query with previous context: "${lastTurn.query}"`);
        }

        // Route to CameraQuestionAgent with enhanced query
        const photoStartTime = Date.now();
        console.log(`⏱️  [+${photoStartTime - processQueryStartTime}ms] 📸 Getting photo for vision retry...`);
        const photo = await this.photoManager.getPhoto(false);
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ${photo ? '✅ Photo retrieved' : '⚪ No photo available (will wait only if needed)'}`);

        // Send query to frontend
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
        const inputData = { query: enhancedQuery, photo, getPhotoCallback, hasDisplay };

        if (this.cameraQuestionAgent) {
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📷 Routing vision retry to CameraQuestionAgent...`);
          const agentResponse = await this.cameraQuestionAgent.handleContext(inputData);
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ✅ CameraQuestionAgent completed`);

          // Store the conversation turn in MiraAgent (use original query, not enhanced)
          const responseText = agentResponse?.answer || (typeof agentResponse === 'string' ? agentResponse : '');
          if (responseText) {
            this.miraAgent.addExternalConversationTurn(query, responseText);
            console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📚 Added vision retry response to MiraAgent conversation history`);
          }

          stopProcessingSounds();
          await this.handleAgentResponse(agentResponse, query, photo, processQueryStartTime);
        } else {
          // Fallback to MiraAgent if no CameraQuestionAgent
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🤖 No CameraQuestionAgent - Routing to MiraAgent...`);
          const agentResponse = await this.miraAgent.handleContext(inputData);
          stopProcessingSounds();
          await this.handleAgentResponse(agentResponse, query, photo, processQueryStartTime);
        }
        return true; // Vision retry completed successfully
      }

      if (recallDecision === RecallDecision.RECALL) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🧠 MEMORY RECALL DETECTED - Skipping vision check`);
        stopProcessingSounds();

        // Send query to frontend
        if (this.chatManager && query.trim().length > 0 && !this.currentQueryMessageId) {
          this.currentQueryMessageId = this.chatManager.addUserMessage(this.userId, query);
          this.chatManager.setProcessing(this.userId, true);
        }

        // Build enhanced query with explicit conversation context for memory recall
        const fullHistory = this.miraAgent.getFullConversationHistory();
        let enhancedQuery = query;
        if (fullHistory.length > 0) {
          const contextSummary = fullHistory
            .map((turn, idx) => {
              const isLast = idx === fullHistory.length - 1;
              const prefix = isLast
                ? `[${idx + 1}] (MOST RECENT - REPEAT THIS ONE IF USER SAYS "REPEAT THAT")`
                : `[${idx + 1}]`;
              return `${prefix} User asked: "${turn.query}" -> You answered: "${turn.response}"`;
            })
            .join('\n');
          enhancedQuery = `${query}\n\n[IMPORTANT - MEMORY RECALL: The user is asking you to recall/repeat information from our previous conversation. You MUST extract the relevant information from the conversation history below and provide it in your response. Do NOT just say "that's the summary" - actually repeat the specific details they're asking about.]\n\n[CONTEXT FROM PREVIOUS EXCHANGES:\n${contextSummary}]`;
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📚 Injected ${fullHistory.length} conversation turns into query`);
        }

        // Route directly to MiraAgent for memory recall (no photo needed)
        const agentResponse = await this.miraAgent.handleContext({
          query: enhancedQuery,
          originalQuery: query, // Pass original query for conversation history storage
          photo: null,
          getPhotoCallback: async () => null,
          hasDisplay: true,
        });

        await this.handleAgentResponse(agentResponse, query, null, processQueryStartTime);
        return true; // Memory recall completed successfully
      }

      // Check if this is an app tool query (AI-powered with available tools context)
      const availableTools = this.miraAgent.getToolInfo();
      const appToolDecision = await this.appToolQueryDecider.checkIfNeedsAppTool(query, availableTools, conversationHistory);
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🔧 App tool decision: ${appToolDecision}`);

      // Determine if we should use minimal tools (for non-app-tool queries)
      // UNSURE is treated as APP_TOOL - use full tools and let the AI decide
      const useMinimalTools = appToolDecision === AppToolDecision.NO_TOOL;

      // Skip vision check if this is clearly an app tool query
      // APP_TOOL queries are for tools like "what apps am I running", not vision queries
      let visionDecision = VisionDecision.NO;
      if (appToolDecision !== AppToolDecision.APP_TOOL) {
        // Detect vision queries using AI decider (YES/NO/UNSURE)
        visionDecision = await this.visionQueryDecider.checkIfNeedsCamera(query, conversationHistory);
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🤖 Vision decision: ${visionDecision}`);
      } else {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 🤖 Vision decision: SKIPPED (APP_TOOL query)`);
      }

      // Handle UNSURE case - ask user for clarification
      if (visionDecision === VisionDecision.UNSURE && this.onRequestClarification) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ❓ UNSURE - Asking user for clarification`);
        stopProcessingSounds();

        // Get photo now in case they say yes
        const photo = await this.photoManager.getPhoto(false);

        // Store the pending query
        this.pendingClarification = {
          originalQuery: query,
          photo,
          processQueryStartTime,
        };

        // Ask the user for clarification
        await this.audioManager.showOrSpeakText("Do you want me to use the camera to see what you're looking at?");

        // Trigger new listening session
        this.onRequestClarification();
        return true; // Clarification requested - still allow follow-up
      }

      const isVisionQuery = visionDecision === VisionDecision.YES;
      if (isVisionQuery) {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 👁️  VISION QUERY DETECTED`);
        // NOTE: We no longer clear conversation history here to preserve context for follow-up questions
        // Users may ask follow-up questions like "tell me more about that brand" or "what else do they make?"
      }

      // Get photo without waiting (non-blocking) - returns cached photo or null
      const photoStartTime = Date.now();
      console.log(`⏱️  [+${photoStartTime - processQueryStartTime}ms] 📸 Getting photo from wake word activation...`);
      const photo = await this.photoManager.getPhoto(false);
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ${photo ? '✅ Photo retrieved' : '⚪ No photo available (will wait only if needed)'}`);

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
      const inputData = { query, photo, getPhotoCallback, hasDisplay, useMinimalTools };

      // Route to appropriate agent based on query type
      let agentResponse: any;
      const agentStartTime = Date.now();

      // Use CameraQuestionAgent for vision queries if available
      if (isVisionQuery && this.cameraQuestionAgent) {
        console.log(`⏱️  [+${agentStartTime - processQueryStartTime}ms] 📷 Routing to CameraQuestionAgent...`);
        agentResponse = await this.cameraQuestionAgent.handleContext(inputData);
        const agentEndTime = Date.now();
        console.log(`⏱️  [+${agentEndTime - processQueryStartTime}ms] ✅ CameraQuestionAgent completed (took ${agentEndTime - agentStartTime}ms)`);

        // Store the conversation turn in MiraAgent so recall queries can access it
        const responseText = agentResponse?.answer || (typeof agentResponse === 'string' ? agentResponse : '');
        if (responseText) {
          this.miraAgent.addExternalConversationTurn(query, responseText);
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📚 Added CameraQuestionAgent response to MiraAgent conversation history`);
        }
      } else {
        // Use MiraAgent for general queries (not a vision query)
        // Clear cached photo since it won't be used
        if (!isVisionQuery && photo) {
          this.photoManager.clearPhoto();
          console.log(`⏱️  [+${agentStartTime - processQueryStartTime}ms] 📸 Vision decider: NO - cleared cached photo`);
        }
        console.log(`⏱️  [+${agentStartTime - processQueryStartTime}ms] 🤖 Invoking MiraAgent.handleContext...`);
        agentResponse = await this.miraAgent.handleContext(inputData);
        const agentEndTime = Date.now();
        console.log(`⏱️  [+${agentEndTime - processQueryStartTime}ms] ✅ MiraAgent completed (took ${agentEndTime - agentStartTime}ms)`);
      }

      // Stop processing sounds
      stopProcessingSounds();

      // Handle response
      await this.handleAgentResponse(agentResponse, query, photo, processQueryStartTime);

      const totalProcessTime = Date.now() - processQueryStartTime;
      console.log(`\n${"█".repeat(70)}`);
      console.log(`⏱️  [TIMESTAMP] 🏁 processQuery COMPLETE!`);
      console.log(`⏱️  Total time from start to finish: ${(totalProcessTime / 1000).toFixed(2)}s (${totalProcessTime}ms)`);
      console.log(`${"█".repeat(70)}\n`);

      return true; // Query processed successfully - allow follow-up mode

    } catch (error) {
      console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] ❌ Error in processQuery`);
      logger.error(error, `[Session ${this.sessionId}]: Error processing query:`);
      await this.audioManager.showOrSpeakText("Sorry, there was an error processing your request.");
      stopProcessingSounds();
      return false; // Error occurred - don't enter follow-up mode
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
   * Handle clarification response (yes/no) for ambiguous vision queries
   */
  private async handleClarificationResponse(response: string): Promise<void> {
    const pending = this.pendingClarification!;
    this.pendingClarification = null; // Clear pending state

    const responseLower = response.toLowerCase().trim();
    console.log(`🤖 Clarification response: "${responseLower}"`);

    // Check if user said yes (wants camera)
    const yesPatterns = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'please', 'do it', 'go ahead', 'use camera', 'use the camera'];
    const noPatterns = ['no', 'nope', 'nah', 'don\'t', 'dont', 'no thanks', 'nevermind', 'never mind', 'cancel'];

    let useCamera = false;

    for (const pattern of yesPatterns) {
      if (responseLower.includes(pattern)) {
        useCamera = true;
        break;
      }
    }

    // Check for explicit no (overrides yes if both somehow present)
    for (const pattern of noPatterns) {
      if (responseLower.includes(pattern)) {
        useCamera = false;
        break;
      }
    }

    console.log(`🤖 User wants camera: ${useCamera}`);

    // Play processing sounds
    const stopProcessingSounds = await this.audioManager.playProcessingSounds();

    try {
      const { originalQuery, photo, processQueryStartTime } = pending;

      // Send query to frontend if not already sent
      if (this.chatManager && originalQuery.trim().length > 0 && !this.currentQueryMessageId) {
        this.currentQueryMessageId = this.chatManager.addUserMessage(this.userId, originalQuery);
        this.chatManager.setProcessing(this.userId, true);
      }

      // Create callback for agent to wait for photo if needed
      const getPhotoCallback = async (): Promise<PhotoData | null> => {
        console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📸 Agent requested photo wait - calling getPhoto(true)...`);
        return await this.photoManager.getPhoto(true);
      };

      const hasDisplay = this.session.capabilities?.hasDisplay;
      const inputData = { query: originalQuery, photo, getPhotoCallback, hasDisplay };

      let agentResponse: any;
      const agentStartTime = Date.now();

      if (useCamera && this.cameraQuestionAgent) {
        // User confirmed they want camera
        console.log(`⏱️  [+${agentStartTime - processQueryStartTime}ms] 📷 User confirmed camera - Routing to CameraQuestionAgent...`);
        this.miraAgent.clearConversationHistory();
        agentResponse = await this.cameraQuestionAgent.handleContext(inputData);
        const agentEndTime = Date.now();
        console.log(`⏱️  [+${agentEndTime - processQueryStartTime}ms] ✅ CameraQuestionAgent completed (took ${agentEndTime - agentStartTime}ms)`);

        // Store the conversation turn in MiraAgent so recall queries can access it
        const responseText = agentResponse?.answer || (typeof agentResponse === 'string' ? agentResponse : '');
        if (responseText) {
          this.miraAgent.addExternalConversationTurn(originalQuery, responseText);
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 📚 Added CameraQuestionAgent response to MiraAgent conversation history`);
        }
      } else {
        // User said no or no camera agent available - clear cached photo
        this.photoManager.clearPhoto();
        console.log(`⏱️  [+${agentStartTime - processQueryStartTime}ms] 🤖 No camera needed - cleared cached photo, routing to MiraAgent...`);
        agentResponse = await this.miraAgent.handleContext(inputData);
        const agentEndTime = Date.now();
        console.log(`⏱️  [+${agentEndTime - processQueryStartTime}ms] ✅ MiraAgent completed (took ${agentEndTime - agentStartTime}ms)`);
      }

      // Stop processing sounds
      stopProcessingSounds();

      // Handle response
      await this.handleAgentResponse(agentResponse, originalQuery, photo, processQueryStartTime);

    } catch (error) {
      console.error('Error handling clarification response:', error);
      stopProcessingSounds();
      await this.audioManager.showOrSpeakText("Sorry, there was an error processing your request.");
    }
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

        // Save conversation turn to database (if callback is set)
        if (this.onConversationTurn) {
          // Get photo timestamp if camera was used
          const photoTimestamp = needsCamera && photo ? Date.now() : undefined;
          this.onConversationTurn(query, finalAnswer, photoTimestamp);
          console.log(`⏱️  [+${Date.now() - processQueryStartTime}ms] 💾 Conversation turn saved to database`);
        }
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
