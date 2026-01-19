import { StructuredTool } from '@langchain/core/tools';
import axios from 'axios';
import { z } from 'zod';

const AUGMENTOS_API_KEY = process.env.AUGMENTOS_API_KEY;
const PACKAGE_NAME = process.env.PACKAGE_NAME;

const TpaToolInvokeInputSchema = z.object({
  targetPackageName: z.string().describe("The package name of the app that has the tool (e.g., 'com.mentra.notes')"),
  toolId: z.string().describe("The ID of the tool to invoke (e.g., 'add_reminder', 'take_note')"),
  parameters: z.record(z.any()).optional().describe("Parameters to pass to the tool as key-value pairs. Check tool description for required parameters.")
});

/**
 * Tool that allows MiraAgent to invoke tools on third-party apps (TPAs).
 * This enables the AI to use app-specific functionality like adding reminders,
 * taking notes, searching conversations, etc.
 */
export class TpaToolInvokeTool extends StructuredTool {
  name = 'TPA_InvokeTool';
  description = `Invoke a tool on a third-party app. Use TPA_ListAppsWithTools first to see available tools and their required parameters.

IMPORTANT WORKFLOW:
1. FIRST call TPA_ListAppsWithTools to get the list of running apps and their tools with parameter requirements
2. THEN call this tool with the correct targetPackageName, toolId, and parameters

CRITICAL: Many tools require parameters (like "text" for add_reminder, "reminderId" for mark_reminder_complete).
Check the tool's parameter requirements from TPA_ListAppsWithTools before calling.
Empty parameters will cause errors for tools that require them.`;

  schema = TpaToolInvokeInputSchema;

  private userId: string;
  private cloudUrl: string;

  constructor(cloudUrl: string, userId: string) {
    super();
    this.cloudUrl = cloudUrl;
    this.userId = userId;
  }

  async _call(input: { targetPackageName: string; toolId: string; parameters?: Record<string, any> }): Promise<string> {
    console.log("[TPA_InvokeTool] Invoking tool:", input);

    try {
      // Use the system-app API endpoint to invoke the tool
      const url = `${this.cloudUrl}/api/system-app/invoke-tool?apiKey=${AUGMENTOS_API_KEY}&packageName=${PACKAGE_NAME}&userId=${this.userId}`;

      const payload = {
        targetPackageName: input.targetPackageName,
        toolId: input.toolId,
        parameters: input.parameters || {}
      };

      console.log(`[TPA_InvokeTool] Request URL: ${url}`);
      console.log(`[TPA_InvokeTool] Payload:`, JSON.stringify(payload, null, 2));

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout for tool execution
      });

      console.log(`[TPA_InvokeTool] Response:`, response.data);

      if (response.data && response.data.success) {
        const result = response.data.result || response.data.message || 'Tool executed successfully';
        return typeof result === 'string' ? result : JSON.stringify(result);
      } else {
        const message = response.data?.message || response.data?.error || 'Unknown error';
        return `Failed to invoke tool: ${message}`;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`[TPA_InvokeTool] Axios error:`, error.response?.data || error.message);
        const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message;
        return `Failed to invoke tool: ${errorMessage}`;
      }
      console.error(`[TPA_InvokeTool] Unknown error:`, error);
      return `Unknown error invoking tool: ${error}`;
    }
  }
}
