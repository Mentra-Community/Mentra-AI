/**
 * CameraQuestionAgent
 * Specialized agent for handling camera/vision-based questions with
 * dual classification: question TYPE and response LENGTH
 */

import { Agent } from "./AgentInterface";
import { LLMProvider } from "../utils";
import { HumanMessage } from "@langchain/core/messages";
import { PhotoData } from "@mentra/sdk";
import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  CameraQuestionCategory,
  PROBLEM_SOLVING_KEYWORDS,
  INSTRUCTIONS_KEYWORDS,
  GENERAL_KEYWORDS,
  QUICK_RESPONSE_KEYWORDS,
  LONG_RESPONSE_KEYWORDS,
} from "../constant/cameraKeywords";

import {
  buildCameraPrompt,
  CATEGORY_CLASSIFICATION_PROMPT,
} from "../constant/cameraPrompts";

import { ResponseMode } from "../constant/prompts";

const GEMENI_API_KEY = process.env.GEMENI_API_KEY;

/**
 * Response from CameraQuestionAgent
 */
interface CameraQuestionResponse {
  answer: string;
  category: CameraQuestionCategory;
  responseMode: ResponseMode;
  needsCamera: true;
}

/**
 * Classification result combining type and length
 */
interface QueryClassification {
  type: CameraQuestionCategory;
  length: ResponseMode;
  includeOCR: boolean;
  includeTranslation: boolean;
}

export class CameraQuestionAgent implements Agent {
  public agentId = "camera_question_agent";
  public agentName = "CameraQuestionAgent";
  public agentDescription =
    "Specialized agent for handling camera/vision-based questions with categorized responses (Problem Solving, Instructions, General) and variable response lengths (Quick, Standard, Detailed)";
  public agentPrompt = ""; // Dynamic based on classification
  public agentTools: any[] = [];

  private userId: string;
  private ai: GoogleGenAI | null = null;

  constructor(userId: string) {
    this.userId = userId;

    if (GEMENI_API_KEY) {
      this.ai = new GoogleGenAI({ apiKey: GEMENI_API_KEY });
    } else {
      console.error("[CameraQuestionAgent] ❌ GEMENI_API_KEY not set!");
    }
  }

  /**
   * Static method to check if a query should be routed to CameraQuestionAgent
   * Used by QueryProcessor for routing decisions
   */
  public static isCameraQuery(query: string): boolean {
    const queryLower = query.toLowerCase();

    const allKeywords = [
      ...PROBLEM_SOLVING_KEYWORDS,
      ...INSTRUCTIONS_KEYWORDS,
      ...GENERAL_KEYWORDS,
    ];

    return allKeywords.some(keyword => queryLower.includes(keyword));
  }

  /**
   * Classify the query into both TYPE and LENGTH categories
   */
  private async classifyQuery(query: string): Promise<QueryClassification> {
    const type = await this.classifyQuestionType(query);
    const length = this.classifyResponseLength(query);
    const includeOCR = this.shouldIncludeOCR(query);
    const includeTranslation = this.shouldIncludeTranslation(query);

    console.log(`[CameraQuestion] Classification: TYPE=${type}, LENGTH=${length}, OCR=${includeOCR}, TRANSLATE=${includeTranslation}`);

    return { type, length, includeOCR, includeTranslation };
  }

  /**
   * Classify question TYPE using keyword matching with LLM fallback
   */
  private async classifyQuestionType(query: string): Promise<CameraQuestionCategory> {
    const queryLower = query.toLowerCase();

    // Fast path: keyword-based detection
    for (const keyword of PROBLEM_SOLVING_KEYWORDS) {
      if (queryLower.includes(keyword)) {
        console.log(`[CameraQuestion] Type: PROBLEM_SOLVING (keyword: "${keyword}")`);
        return CameraQuestionCategory.PROBLEM_SOLVING;
      }
    }

    for (const keyword of INSTRUCTIONS_KEYWORDS) {
      if (queryLower.includes(keyword)) {
        console.log(`[CameraQuestion] Type: INSTRUCTIONS (keyword: "${keyword}")`);
        return CameraQuestionCategory.INSTRUCTIONS;
      }
    }

    for (const keyword of GENERAL_KEYWORDS) {
      if (queryLower.includes(keyword)) {
        console.log(`[CameraQuestion] Type: GENERAL (keyword: "${keyword}")`);
        return CameraQuestionCategory.GENERAL;
      }
    }

    // Fallback: LLM classification for ambiguous queries
    console.log(`[CameraQuestion] No keyword match, using LLM classification`);
    return await this.classifyTypeWithLLM(query);
  }

  /**
   * Use LLM to classify ambiguous queries
   */
  private async classifyTypeWithLLM(query: string): Promise<CameraQuestionCategory> {
    try {
      const llm = LLMProvider.getLLM(100);
      const prompt = CATEGORY_CLASSIFICATION_PROMPT.replace("{query}", query);

      const result = await llm.invoke([new HumanMessage(prompt)]);
      const classification = result.content.toString().trim().toUpperCase();

      if (classification.includes('PROBLEM_SOLVING')) {
        return CameraQuestionCategory.PROBLEM_SOLVING;
      } else if (classification.includes('INSTRUCTIONS')) {
        return CameraQuestionCategory.INSTRUCTIONS;
      }

      return CameraQuestionCategory.GENERAL; // Default
    } catch (error) {
      console.error('[CameraQuestion] LLM classification error:', error);
      return CameraQuestionCategory.GENERAL;
    }
  }

  /**
   * Classify response LENGTH based on keywords and query complexity
   */
  private classifyResponseLength(query: string): ResponseMode {
    const queryLower = query.toLowerCase();

    // Check for explicit QUICK indicators
    for (const keyword of QUICK_RESPONSE_KEYWORDS) {
      if (queryLower.includes(keyword)) {
        console.log(`[CameraQuestion] Length: QUICK (keyword: "${keyword}")`);
        return ResponseMode.QUICK;
      }
    }

    // Check for explicit DETAILED indicators
    for (const keyword of LONG_RESPONSE_KEYWORDS) {
      if (queryLower.includes(keyword)) {
        console.log(`[CameraQuestion] Length: DETAILED (keyword: "${keyword}")`);
        return ResponseMode.DETAILED;
      }
    }

    // Heuristics for default classification
    const wordCount = query.trim().split(/\s+/).length;

    // Very short queries (≤5 words) default to QUICK
    if (wordCount <= 5) {
      console.log(`[CameraQuestion] Length: QUICK (short query, ${wordCount} words)`);
      return ResponseMode.QUICK;
    }

    // Multiple question marks suggest need for more detail
    const questionMarks = (query.match(/\?/g) || []).length;
    if (questionMarks > 1) {
      console.log(`[CameraQuestion] Length: DETAILED (multiple questions)`);
      return ResponseMode.DETAILED;
    }

    // Default to STANDARD
    console.log(`[CameraQuestion] Length: STANDARD (default)`);
    return ResponseMode.STANDARD;
  }

  /**
   * Check if query needs OCR capabilities
   */
  private shouldIncludeOCR(query: string): boolean {
    const ocrKeywords = ['read', 'text', 'say', 'written', 'sign', 'label', 'document'];
    const queryLower = query.toLowerCase();
    return ocrKeywords.some(keyword => queryLower.includes(keyword));
  }

  /**
   * Check if query needs translation capabilities
   */
  private shouldIncludeTranslation(query: string): boolean {
    const translateKeywords = ['translate', 'translation', 'language', 'foreign', 'english'];
    const queryLower = query.toLowerCase();
    return translateKeywords.some(keyword => queryLower.includes(keyword));
  }

  /**
   * Analyze image with a custom prompt using Gemini
   */
  private async analyzeImageWithPrompt(
    imagePath: string,
    prompt: string,
    responseMode: ResponseMode
  ): Promise<string | null> {
    if (!this.ai) {
      console.error("[CameraQuestion] Gemini AI not initialized");
      return null;
    }

    const startTime = Date.now();

    // Select model based on response mode (faster model for quick responses)
    const model = responseMode === ResponseMode.QUICK
      ? "gemini-flash-lite-latest"
      : "gemini-flash-lite-latest"; // Can use different models for detailed responses

    console.log(`[CameraQuestion] ⏳ Analyzing image with ${responseMode} mode...`);

    try {
      const imageData = fs.readFileSync(imagePath).toString("base64");

      const response = await this.ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: imageData,
                },
              },
            ],
          },
        ],
      });

      const endTime = Date.now();
      console.log(`[CameraQuestion] ✅ Image analysis complete (${endTime - startTime}ms)`);

      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.text) {
            console.log(`[CameraQuestion] Response: ${part.text.substring(0, 100)}...`);
            return part.text;
          }
        }
      }

      console.error("[CameraQuestion] No text response from Gemini");
      return null;
    } catch (error) {
      console.error("[CameraQuestion] Image analysis error:", error);
      return null;
    }
  }

  /**
   * Main entry point - implements Agent interface
   */
  public async handleContext(userContext: Record<string, any>): Promise<CameraQuestionResponse> {
    const startTime = Date.now();
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[CameraQuestion] ⏱️  START: ${new Date().toISOString()}`);
    console.log(`${"=".repeat(60)}\n`);

    const query = userContext.query || "";
    let photo = userContext.photo as PhotoData | null;
    const getPhotoCallback = userContext.getPhotoCallback as (() => Promise<PhotoData | null>) | undefined;
    const locationContext = userContext.locationContext as string | undefined;

    // Step 1: Classify the query (type + length)
    const classification = await this.classifyQuery(query);

    // Step 2: Ensure we have a photo
    if (!photo && getPhotoCallback) {
      console.log(`[CameraQuestion] 📸 Waiting for photo...`);
      try {
        photo = await getPhotoCallback();
      } catch (error) {
        console.error(`[CameraQuestion] Error getting photo:`, error);
      }
    }

    if (!photo) {
      console.log(`[CameraQuestion] ⚠️ No photo available`);
      return {
        answer: "I need to see what you're looking at. Please make sure the camera has a clear view.",
        category: classification.type,
        responseMode: classification.length,
        needsCamera: true
      };
    }

    // Step 3: Build category-specific prompt
    const prompt = buildCameraPrompt(
      classification.type,
      classification.length,
      query,
      classification.includeOCR,
      classification.includeTranslation,
      locationContext
    );

    console.log(`[CameraQuestion] 📝 Built prompt for ${classification.type} + ${classification.length}`);

    // Step 4: Process image with custom prompt
    try {
      const tempDir = os.tmpdir();
      const tempImagePath = path.join(tempDir, `camera-question-${Date.now()}.jpg`);
      fs.writeFileSync(tempImagePath, photo.buffer);

      const result = await this.analyzeImageWithPrompt(
        tempImagePath,
        prompt,
        classification.length
      );

      // Cleanup temp file
      fs.unlinkSync(tempImagePath);

      const totalTime = Date.now() - startTime;
      console.log(`\n${"=".repeat(60)}`);
      console.log(`[CameraQuestion] ⏱️  COMPLETE: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
      console.log(`${"=".repeat(60)}\n`);

      return {
        answer: result || "I couldn't analyze that image. Please try again.",
        category: classification.type,
        responseMode: classification.length,
        needsCamera: true
      };
    } catch (error) {
      console.error('[CameraQuestion] Error processing image:', error);
      return {
        answer: "Sorry, I had trouble analyzing that. Please try again.",
        category: classification.type,
        responseMode: classification.length,
        needsCamera: true
      };
    }
  }
}
