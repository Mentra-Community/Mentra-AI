// src/utils/analyzeImage.ts
import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import { logger as _logger } from "@mentra/sdk";
import type { Logger } from "pino";

const GEMENI_API_KEY = process.env.GEMENI_API_KEY;

if (!GEMENI_API_KEY) {
  _logger.error("GEMENI_API_KEY environment variable is not set");
  process.exit(1);
}

/**
 * Analyze an image using Google GenAI.
 * @param imagePath - Path to the image file.
 * @param question - The question or prompt to ask about the image.
 * @param model - (Optional) Model name to use. Default: "gemini-flash-lite-latest".
 * @param logger - (Optional) Logger instance for BetterStack logging.
 * @returns The AI's text response.
 */

export async function analyzeImage(
  imagePath: string,
  question: string,
  model = 
  // "gemini-flash-lite-latest"
  "gemini-3-flash-preview"
  ,
  logger?: Logger
): Promise<string | null> {
  const log = logger || _logger.child({ service: "GeminiAPI" });
  const startTime = Date.now();
  const ai = new GoogleGenAI({ apiKey: GEMENI_API_KEY });

  log.info(
    { model, questionLength: question.length, apiType: 'Gemini', operation: 'analyzeImage' },
    `🤖 Calling Gemini API for image analysis with model: ${model}`
  );

  const prompt = `You are the visual system for smart glasses. Respond naturally as the user's eyes, using first-person perspective.

CRITICAL - Camera Perspective: The camera is mounted on the user's face pointing OUTWARD. You see what they're LOOKING AT, not them. The user is INVISIBLE to you. If you see a person, that is SOMEONE ELSE - say "I see a person" NOT "I see you".

Guidelines:
- Say "I see..." not "In this image, I see..."
- Be conversational and direct
- Answer in 75 words or fewer
- Be SPECIFIC: identify exact names of apps, products, brands, buildings, landmarks, etc. A specific answer like "That's the Spotify app, it's a music streaming service" is far better than "I see an app on a phone screen"
- FOCUS ON THE USER'S QUESTION - answer what they actually asked
- If asked "what is this and what does it do?", identify it AND explain its purpose
- NEVER use markdown formatting - plain text only, this will be spoken aloud

User's Question: "${question}"
`;

  const promptStartTime = Date.now();
  const imageData = fs.readFileSync(imagePath).toString("base64");

  const response = await ai.models.generateContent({
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

  const promptEndTime = Date.now();

  let textResponse: string | null = null;

  if (
    response.candidates &&
    response.candidates[0]?.content?.parts
  ) {
    for (const part of response.candidates[0].content.parts) {
      if (part.text) {
        textResponse = part.text;
      } else if (part.inlineData) {
        const imgData = part.inlineData.data;
        if (typeof imgData === "string") {
          const buffer = Buffer.from(imgData, "base64");
          fs.writeFileSync("gemini-native-image.png", buffer);
        }
      }
    }
  } else {
    log.error({ model, apiType: 'Gemini', operation: 'analyzeImage', success: false }, "Response does not contain expected candidates or content");
  }

  const totalTime = promptEndTime - startTime;
  const llmTime = promptEndTime - promptStartTime;

  log.info(
    {
      model,
      llmTimeMs: llmTime,
      totalTimeMs: totalTime,
      responseLength: textResponse?.length || 0,
      success: true,
      apiType: 'Gemini',
      operation: 'analyzeImage'
    },
    `✅ Gemini API call successful (${llmTime}ms LLM + ${totalTime}ms total)`
  );

  return textResponse;
}
