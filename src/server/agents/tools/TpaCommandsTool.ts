import { StructuredTool } from '@langchain/core/tools';
import axios from 'axios';
import { z } from 'zod';
import {
  logger as _logger
} from '@mentra/sdk';
import { stringify } from 'querystring';

const AUGMENTOS_API_KEY = process.env.AUGMENTOS_API_KEY;
const PACKAGE_NAME = process.env.PACKAGE_NAME;

//console.log("$$$$$ AUGMENTOS_API_KEY:", AUGMENTOS_API_KEY);
//console.log("$$$$$ PACKAGE_NAME:", PACKAGE_NAME);

const ACTIONS = ['start', 'stop'] as const;

interface AppInfo {
  packageName: string;
  name: string;
  description: string;
  is_running: boolean;
  is_foreground?: boolean;
}

interface ToolParameter {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

interface AppTool {
  id: string;
  description: string;
  activationPhrases?: string[];
  parameters?: Record<string, ToolParameter> | ToolParameter[];
}

interface AppWithTools {
  packageName: string;
  name: string;
  description: string;
  is_running: boolean;
  tools: AppTool[];
}

const TpaCommandsInputSchema = z.object({
  action: z.enum(['start', 'stop']).describe("The action to perform: 'start' or 'stop'"),
  packageName: z.string().describe("The exact package name of the app to start or stop")
});

const TpaListAppsInputSchema = z.object({
  includeRunning: z.boolean().optional().describe("Whether to include running status in the response")
});

export class TpaListAppsTool extends StructuredTool {
  name = 'TPA_ListApps';
  description = 'List all available apps with their package names, names, descriptions, and running status. ALWAYS use this tool FIRST before TPA_Commands to find the correct package name. Match the user\'s request to an app name in the list. If no app matches, tell the user the app was not found - do NOT guess or suggest similar apps.';
  schema = TpaListAppsInputSchema;
  
  private userId: string;
  private cloudUrl: string;

  constructor(cloudUrl: string, userId: string) {
    super();
    this.cloudUrl = cloudUrl;
    this.userId = userId;
  }

  async _call(input: { includeRunning?: boolean }): Promise<string> {

    const logger = _logger.child({app: PACKAGE_NAME});
    logger.debug("[TpaCommandsTool.ts] Running...")
    console.log("TpaListAppsTool Input:", input);
    try {
      const apps = await this.getAllApps();
      let result: string;
      if (input.includeRunning) {
        result = JSON.stringify(apps, null, 2);
      } else {
        // Return simplified info without running status
        const simplifiedApps = apps.map(app => ({
          packageName: app.packageName,
          name: app.name,
          description: app.description
        }));
        result = JSON.stringify(simplifiedApps, null, 2);
      }
      console.log(`[TpaListAppsTool] Fetched apps:`, JSON.stringify(apps, null, 2));
      console.log(`[TpaListAppsTool] Returning to LLM:`, result);
      return result;
    } catch (error) {
      const errorMsg = `Error fetching apps: ${error}`;
      console.log(`[TpaListAppsTool] Returning error to LLM:`, errorMsg);
      return errorMsg;
    }
  }

  public async getAllApps(): Promise<AppInfo[]> {
    try {
      // Use the correct API endpoint from the routes file
      const url = `${this.cloudUrl}/api/sdk/system-app/apps?apiKey=${AUGMENTOS_API_KEY}&packageName=${PACKAGE_NAME}&userId=${this.userId}`;
      console.log(`[TpaListAppsTool] Fetching apps from URL: ${url}`);
      console.log(`[TpaListAppsTool] API Key: ${AUGMENTOS_API_KEY ? 'Present' : 'Missing'}`);
      console.log(`[TpaListAppsTool] Package Name: ${PACKAGE_NAME}`);
      console.log(`[TpaListAppsTool] User ID: ${this.userId}`);

      const response = await axios.get(url);
      console.log(`[TpaListAppsTool] API Response status: ${response.status}`);
      console.log(`[TpaListAppsTool] API Response data:`, JSON.stringify(response.data, null, 2));

      // Check if the response has the expected structure
      if (!response.data || !response.data.success) {
        console.error('[TpaListAppsTool] Invalid response format from API:', response.data);
        return [];
      }

      // Extract app data from the response
      const apps = response.data.data || [];
      console.log(`[TpaListAppsTool] Found ${apps.length} apps in response`);

      // Extract only the fields we need
      const processedApps = apps.map((app: any) => ({
        packageName: app.packageName,
        name: app.name,
        description: app.description || '',
        is_running: !!app.is_running,
        is_foreground: !!app.is_foreground
      }));

      console.log(`[TpaListAppsTool] Processed apps:`, JSON.stringify(processedApps, null, 2));
      return processedApps;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[TpaListAppsTool] Axios error fetching apps:', error.response?.data || error.message);
        console.error('[TpaListAppsTool] Error status:', error.response?.status);
        console.error('[TpaListAppsTool] Error config:', error.config);
      } else {
        console.error('[TpaListAppsTool] Unknown error fetching apps:', error);
      }
      
      // Return fallback apps if API fails
      console.log('[TpaListAppsTool] Returning fallback apps due to API error');
      return [];
    }
  }
}

export class TpaCommandsTool extends StructuredTool {
  name = 'TPA_Commands';
  description = 'Start or stop apps on smart glasses. IMPORTANT: You MUST use TPA_ListApps first to get the exact package name. Only call this tool with a package name that exists in the TPA_ListApps response. Never guess package names.';
  schema = TpaCommandsInputSchema;
  
  private userId: string;
  private cloudUrl: string;

  constructor(cloudUrl: string, userId: string) {
    super();
    this.cloudUrl = cloudUrl;
    this.userId = userId;
  }

  async _call(input: { action: string, packageName: string }): Promise<string> {
    console.log("TpaCommandsTool Input:", input);
    try {
      return await this.executeCommand(input.action, input.packageName);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.message || error.message;
        return `Error: ${errorMessage}`;
      }
      return `Unknown error: ${error}`;
    }
  }

  private async executeCommand(action: string, packageName: string): Promise<string> {
    try {
      // Use the miniapps API endpoint with API key auth
      const url = `${this.cloudUrl}/api/sdk/system-app/${packageName}/${action}?apiKey=${AUGMENTOS_API_KEY}&packageName=${PACKAGE_NAME}&userId=${this.userId}`;
      console.log(`[TPA_Commands] Executing command: ${action} for package: ${packageName}`);
      console.log(`[TPA_Commands] Request URL:`, url);
      const response = await axios.post(url);
      console.log(`[TPA_Commands] Response:`, response.data);
      // Check if the response indicates success
      if (response.data && response.data.success) {
        return `Successfully ${action === 'start' ? 'started' : 'stopped'} app ${packageName}`;
      } else {
        const message = response.data?.message || 'Unknown error';
        return `Failed to ${action} app: ${message}`;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`[TPA_Commands] Axios error while trying to ${action} app ${packageName}:`, error.response?.data || error.message);
        const errorMessage = error.response?.data?.message || error.message;
        return `Failed to ${action} app: ${errorMessage}`;
      }
      console.error(`[TPA_Commands] Unknown error while trying to ${action} app ${packageName}:`, error);
      return `Unknown error while trying to ${action} app: ${error}`;
    }
  }
}

const TpaListAppsWithToolsInputSchema = z.object({
  onlyRunning: z.boolean().optional().describe("If true, only return apps that are currently running (default: true)")
});

/**
 * Tool that lists apps along with their available tools and parameter requirements.
 * This helps the LLM understand what tools are available and what parameters they need.
 */
export class TpaListAppsWithToolsTool extends StructuredTool {
  name = 'TPA_ListAppsWithTools';
  description = `List all apps with their available tools and required parameters.
Use this BEFORE calling TPA_InvokeTool to understand what tools are available and what parameters they need.

Returns apps with their tools in this format:
- packageName: The app's package name (use this for TPA_InvokeTool)
- name: Human-readable app name
- tools: Array of available tools with:
  - id: The tool ID to use with TPA_InvokeTool
  - description: What the tool does
  - parameters: Required/optional parameters for the tool

IMPORTANT: Check the 'parameters' field of each tool to know what parameters are required!`;

  schema = TpaListAppsWithToolsInputSchema;

  private userId: string;
  private cloudUrl: string;

  constructor(cloudUrl: string, userId: string) {
    super();
    this.cloudUrl = cloudUrl;
    this.userId = userId;
  }

  async _call(input: { onlyRunning?: boolean }): Promise<string> {
    const onlyRunning = input.onlyRunning !== false; // Default to true
    console.log(`[TPA_ListAppsWithTools] Fetching apps with tools (onlyRunning: ${onlyRunning})`);

    try {
      const url = `${this.cloudUrl}/api/sdk/system-app/apps?apiKey=${AUGMENTOS_API_KEY}&packageName=${PACKAGE_NAME}&userId=${this.userId}`;
      const response = await axios.get(url);

      if (!response.data || !response.data.success) {
        return 'Error: Failed to fetch apps';
      }

      const apps = response.data.data || [];

      // Filter and format apps with their tools
      const appsWithTools: AppWithTools[] = apps
        .filter((app: any) => !onlyRunning || app.is_running)
        .filter((app: any) => app.tools && app.tools.length > 0)
        .map((app: any) => ({
          packageName: app.packageName,
          name: app.name,
          description: app.description || '',
          is_running: !!app.is_running,
          tools: (app.tools || []).map((tool: any) => ({
            id: tool.id,
            description: tool.description || '',
            activationPhrases: tool.activationPhrases || [],
            parameters: tool.parameters || {}
          }))
        }));

      if (appsWithTools.length === 0) {
        return onlyRunning
          ? 'No running apps with tools found. Start an app first using SmartAppControl.'
          : 'No apps with tools found.';
      }

      // Format output for LLM readability
      const formattedOutput = appsWithTools.map(app => {
        const toolsInfo = app.tools.map(tool => {
          let paramInfo = 'No parameters required';
          if (tool.parameters && Object.keys(tool.parameters).length > 0) {
            // Handle both object and array formats for parameters
            if (Array.isArray(tool.parameters)) {
              paramInfo = `Parameters: ${JSON.stringify(tool.parameters)}`;
            } else {
              paramInfo = `Parameters: ${JSON.stringify(tool.parameters)}`;
            }
          }
          return `  - ${tool.id}: ${tool.description}\n    ${paramInfo}`;
        }).join('\n');

        return `📱 ${app.name} (${app.packageName}) ${app.is_running ? '[RUNNING]' : ''}\n${toolsInfo}`;
      }).join('\n\n');

      console.log(`[TPA_ListAppsWithTools] Found ${appsWithTools.length} apps with tools`);
      return formattedOutput;

    } catch (error) {
      console.error('[TPA_ListAppsWithTools] Error:', error);
      if (axios.isAxiosError(error)) {
        return `Error fetching apps: ${error.response?.data?.message || error.message}`;
      }
      return `Error fetching apps: ${error}`;
    }
  }
}
