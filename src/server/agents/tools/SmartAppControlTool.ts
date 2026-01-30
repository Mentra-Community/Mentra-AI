import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { IntelligentAppMatchingTool } from './IntelligentAppMatchingTool';
import { TpaCommandsTool } from './TpaCommandsTool';

const SmartAppControlInputSchema = z.object({
  userRequest: z.string().describe("The user's complete request to control an app (e.g., 'open Mira', 'start Instagram', 'close YouTube', 'launch camera app')")
});

export class SmartAppControlTool extends StructuredTool {
  name = 'SmartAppControl';
  description = 'Intelligently controls apps by understanding user requests in natural language. Automatically finds the best matching app and performs the requested action (start/stop/open/close/launch/quit). Use this for ANY user request involving app control.';
  schema = SmartAppControlInputSchema;
  
  private userId: string;
  private cloudUrl: string;
  private appMatcher: IntelligentAppMatchingTool;
  private appController: TpaCommandsTool;

  constructor(cloudUrl: string, userId: string) {
    super();
    this.cloudUrl = cloudUrl;
    this.userId = userId;
    this.appMatcher = new IntelligentAppMatchingTool(cloudUrl, userId);
    this.appController = new TpaCommandsTool(cloudUrl, userId);
  }

  async _call(input: { userRequest: string }): Promise<string> {
    console.log("[SmartAppControl] Processing request:", input.userRequest);
    
    try {
      // Extract the action from the user request
      const action = this.extractAction(input.userRequest);
      if (!action) {
        return "Sorry, I couldn't understand what you want to do with the app. Please use words like 'open', 'start', 'close', 'stop', or 'quit'.";
      }

      // Use intelligent matching to find the best app
      const matchingResult = await this.appMatcher._call({ userRequest: input.userRequest });
      
      let appMatch;
      try {
        appMatch = JSON.parse(matchingResult);
      } catch (parseError) {
        console.error("[SmartAppControl] Error parsing app match result:", parseError);
        return "Sorry, I had trouble finding the app you mentioned.";
      }

      // Handle disambiguation case - multiple similar apps found
      if (appMatch.needsDisambiguation && appMatch.candidates?.length > 0) {
        const options = appMatch.candidates
          .map((c: any) => `'${c.name}'`)
          .join(' or ');
        return `I found multiple apps with similar names. Which one would you like: ${options}?`;
      }

      // Check if we found a reasonable match
      if (!appMatch.packageName || appMatch.confidence === 'low') {
        if (appMatch.reasoning && appMatch.reasoning.includes("No suitable app found")) {
          return `Sorry, I couldn't find an app matching "${input.userRequest}". Please check the app name and try again.`;
        } else {
          return `Sorry, I had trouble finding the app you mentioned. ${appMatch.reasoning}`;
        }
      }

      // Provide feedback on uncertain matches
      let confidenceMessage = "";
      if (appMatch.confidence === 'medium') {
        confidenceMessage = ` (I think you meant ${appMatch.name})`;
      }

      // Execute the action using the found package name
      const actionResult = await this.appController._call({
        action: action,
        packageName: appMatch.packageName
      });

      // Return the original result with confidence message if needed
      return `${actionResult}${confidenceMessage}`;

    } catch (error) {
      console.error("[SmartAppControl] Error:", error);
      return `Sorry, there was an error processing your app request: ${error}`;
    }
  }

  private extractAction(userRequest: string): 'start' | 'stop' | null {
    const request = userRequest.toLowerCase();
    
    // Words that indicate starting/opening an app
    const startWords = ['open', 'start', 'launch', 'run', 'begin', 'activate'];
    // Words that indicate stopping/closing an app
    const stopWords = ['close', 'stop', 'quit', 'end', 'exit', 'kill', 'terminate', 'shutdown'];
    
    for (const word of startWords) {
      if (request.includes(word)) {
        return 'start';
      }
    }
    
    for (const word of stopWords) {
      if (request.includes(word)) {
        return 'stop';
      }
    }
    
    // Default to start if no clear action is found but there's app-related language
    if (request.includes('app')) {
      return 'start';
    }
    
    return null;
  }
}