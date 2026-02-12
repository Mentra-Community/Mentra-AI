import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { TpaListAppsTool } from './TpaCommandsTool';
import { LLMProvider } from '../../utils';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

const IntelligentAppMatchingInputSchema = z.object({
  userRequest: z.string().describe("The user's request to open/start/launch an app (e.g., 'open Mira', 'start camera', 'launch Instagram')")
});


const APP_MATCHING_SYSTEM_PROMPT = `You are an intelligent app matching assistant. Your job is to find the best matching app from a list of available apps based on a user's request.

Given:
1. A user request (like "open Mira", "start camera", "launch Instagram", etc.)
2. A list of available apps with their names, package names, and descriptions

Your task is to:
1. Analyze the user's request to understand what app they want
2. Compare it against all available apps
3. Find the best match considering:
   - Exact name matches (highest priority)
   - Partial name matches
   - Description matches (if the user describes functionality)
   - Common alternative names or abbreviations
   - Fuzzy matching for typos or similar sounding names

IMPORTANT - Disambiguation Required:
If multiple apps have very similar names (e.g., same base name with variants like "[Dev]", "[Test]", "[Dev Aryan]", etc.), you MUST return a disambiguation response so the user can choose.

When disambiguation is needed, return:
{
  "needsDisambiguation": true,
  "candidates": [
    { "packageName": "com.example.app", "name": "App Name", "description": "..." },
    { "packageName": "com.example.app.dev", "name": "App Name [Dev]", "description": "..." }
  ],
  "reasoning": "Multiple apps with similar names found"
}

When a single clear match is found, respond with:
{
  "packageName": "the.exact.package.name",
  "name": "App Name",
  "description": "App description",
  "confidence": "high|medium|low",
  "reasoning": "Brief explanation of why this app was chosen"
}

Confidence levels:
- "high": Exact or very close name match
- "medium": Partial match or description-based match
- "low": Best guess but uncertain

If no reasonable match is found, return:
{
  "packageName": "",
  "name": "",
  "description": "",
  "confidence": "low",
  "reasoning": "No suitable app found matching the request"
}`;

export class IntelligentAppMatchingTool extends StructuredTool {
  name = 'IntelligentAppMatching';
  description = 'Intelligently matches user app requests to available apps using semantic understanding. Use this when the user wants to open/start/launch an app.';
  schema = IntelligentAppMatchingInputSchema;
  
  private tpaListTool: TpaListAppsTool;

  constructor(cloudUrl: string, userId: string) {
    super();
    this.tpaListTool = new TpaListAppsTool(cloudUrl, userId);
  }

  async _call(input: { userRequest: string }): Promise<string> {
    console.log("[IntelligentAppMatching] Processing request:", input.userRequest);
    
    try {
      // First, get all available apps
      const appsResult = await this.tpaListTool._call({ includeRunning: false });
      let apps: any[];
      
      try {
        apps = JSON.parse(appsResult);
      } catch (parseError) {
        console.error("[IntelligentAppMatching] Error parsing apps list:", parseError);
        return JSON.stringify({
          packageName: "",
          name: "",
          description: "",
          confidence: "low",
          reasoning: "Error retrieving available apps"
        });
      }

      if (!Array.isArray(apps) || apps.length === 0) {
        return JSON.stringify({
          packageName: "",
          name: "",
          description: "",
          confidence: "low",
          reasoning: "No apps available"
        });
      }

      // Prepare the context for the LLM
      const appsListForLLM = apps.map(app => 
        `- Name: "${app.name}", Package: "${app.packageName}", Description: "${app.description}"`
      ).join('\n');

      const userPrompt = `User Request: "${input.userRequest}"

Available Apps:
${appsListForLLM}

Find the best matching app and respond with the JSON format specified.`;

      // Use LLM to find the best match
      const llm = LLMProvider.getLLM();
      const result: AIMessage = await llm.invoke([
        new SystemMessage(APP_MATCHING_SYSTEM_PROMPT),
        new HumanMessage(userPrompt)
      ]);

      let response = result.content.toString().trim();
      
      // Clean up the response - sometimes LLMs add extra text
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        response = jsonMatch[0];
      }

      // Validate the JSON response
      try {
        const parsedResponse = JSON.parse(response);
        if (parsedResponse.packageName && parsedResponse.name) {
          console.log(`[IntelligentAppMatching] Found match: ${parsedResponse.name} (${parsedResponse.packageName}) with confidence: ${parsedResponse.confidence}`);
        }
        return response;
      } catch (jsonError) {
        console.error("[IntelligentAppMatching] Invalid JSON response from LLM:", response);
        return JSON.stringify({
          packageName: "",
          name: "",
          description: "",
          confidence: "low",
          reasoning: "Error processing app matching request"
        });
      }

    } catch (error) {
      console.error("[IntelligentAppMatching] Error:", error);
      return JSON.stringify({
        packageName: "",
        name: "",
        description: "",
        confidence: "low",
        reasoning: `Error during app matching: ${error}`
      });
    }
  }
}