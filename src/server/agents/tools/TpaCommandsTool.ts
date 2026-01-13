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

const TpaCommandsInputSchema = z.object({
  action: z.enum(['start', 'stop']).describe("The action to perform: 'start' or 'stop'"),
  packageName: z.string().describe("The exact package name of the app to start or stop")
});

const TpaListAppsInputSchema = z.object({
  includeRunning: z.boolean().optional().describe("Whether to include running status in the response")
});

export class TpaListAppsTool extends StructuredTool {
  name = 'TPA_ListApps';
  description = 'List all available apps with their package names, names, descriptions, and running status. Use this tool when you need to find the correct package name for an app before using TPA_Commands.';
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
      const url = `${this.cloudUrl}/api/apps?apiKey=${AUGMENTOS_API_KEY}&packageName=${PACKAGE_NAME}&userId=${this.userId}`;
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
  description = 'Start or stop apps on smart glasses by providing the exact package name. Use this tool when you know the exact package name of the app to start or stop.';
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
      // Use the correct API endpoint from the routes file
      const url = `${this.cloudUrl}/api/apps/${packageName}/${action}?apiKey=${AUGMENTOS_API_KEY}&packageName=${PACKAGE_NAME}&userId=${this.userId}`;
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
