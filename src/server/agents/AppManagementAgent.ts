// AppManagementAgent.ts - Specialized LLM agent for app management

import { Agent } from "./AgentInterface";
import { LLMProvider } from "../utils";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Tool, StructuredTool } from "langchain/tools";
import { TpaCommandsTool, TpaListAppsTool } from "../tools/TpaCommandsTool";

interface AppActionResult {
  success: boolean;
  action?: string;
  appName?: string;
  packageName?: string;
  message: string;
}

const APP_MANAGEMENT_SYSTEM_PROMPT = `You are an app name extraction assistant.

Your ONLY job is to extract the app name from user requests about opening/closing apps.

Examples:
- "start Instagram" -> return "Instagram"
- "open Netflix" -> return "Netflix"  
- "close YouTube" -> return "YouTube"
- "launch TikTok" -> return "TikTok"
- "quit Spotify" -> return "Spotify"

Just return the app name, nothing else.`

;

export class AppManagementAgent implements Agent {
  public agentId = "app_management_agent";
  public agentName = "AppManagementAgent";
  public agentDescription = "Specialized agent for managing app start/stop operations on smart glasses";
  public agentPrompt = APP_MANAGEMENT_SYSTEM_PROMPT;
  public agentTools: (Tool | StructuredTool)[];

  public messages: BaseMessage[] = [];

  constructor(cloudUrl: string, userId: string) {
    // No tools needed for simple app name extraction
    this.agentTools = [];
  }

  public async extractAppName(userQuery: string): Promise<string> {
    try {
      console.log("🤖 Extracting app name from:", userQuery);
      
      const llm = LLMProvider.getLLM(); // No tools needed
      
      const result: AIMessage = await llm.invoke([
        new SystemMessage(APP_MANAGEMENT_SYSTEM_PROMPT),
        new HumanMessage(userQuery)
      ]);

      const extractedAppName = result.content.toString().trim();
      console.log("📱 Extracted app name:", extractedAppName);
      
      return extractedAppName;

    } catch (error) {
      console.error("[AppManagementAgent] Error extracting app name:", error);
      return "";
    }
  }

  // Keep this for backward compatibility but simplify it
  public async handleAppRequest(userQuery: string): Promise<AppActionResult> {
    const appName = await this.extractAppName(userQuery);
    
    if (appName) {
      return {
        success: true,
        appName: appName,
        message: `Extracted app name: ${appName}`
      };
    } else {
      return {
        success: false,
        message: "Could not extract app name from request"
      };
    }
  }

  // Required by Agent interface but not used in this context
  public async handleContext(userContext: Record<string, any>): Promise<any> {
    const query = userContext.query || "";
    return await this.handleAppRequest(query);
  }
}