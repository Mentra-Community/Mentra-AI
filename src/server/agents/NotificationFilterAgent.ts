import { Agent } from "./AgentInterface";
import { PromptTemplate } from "@langchain/core/prompts";
import { HumanMessage } from "@langchain/core/messages";
import { LLMProvider } from "../utils";
import { NOTIFICATION_FILTER_PROMPT } from "../constant/prompts";

// Define interfaces for notifications and response
export interface NotificationRank {
  uuid: string;
  summary: string;
  rank: number;
  appName?: string;
  title?: string;
  text?: string;
  timestamp?: string;
}

export interface NotificationFilterResponse {
  notification_ranking: NotificationRank[];
}

export class NotificationFilterAgent implements Agent {
  public agentId = "notification_filter";
  public agentName = "NotificationFilterAgent";
  public agentDescription =
    "Filters notifications by importance and provides concise summaries for display on smart glasses.";
  public agentPrompt = NOTIFICATION_FILTER_PROMPT;
  // This agent doesn't use additional tools.
  public agentTools: any[] = [];

  /**
   * Parses the LLM output expecting a valid JSON string with key "notification_ranking".
   */
  private parseOutput(text: string): NotificationFilterResponse {
    // Remove Markdown code block markers if they exist.
    // For example, if text starts with "```json" and ends with "```"
    const trimmedText = text.trim();
    let jsonText = trimmedText;
    if (trimmedText.startsWith("```")) {
      // Remove the starting code fence (e.g., ```json)
      const firstLineBreak = trimmedText.indexOf("\n");
      if (firstLineBreak !== -1) {
        jsonText = trimmedText.substring(firstLineBreak).trim();
      }
      // Remove the trailing code fence if it exists.
      if (jsonText.endsWith("```")) {
        jsonText = jsonText.substring(0, jsonText.length - 3).trim();
      }
    }
    
    try {
      const parsed: NotificationFilterResponse = JSON.parse(jsonText);
      if (
        parsed &&
        Array.isArray(parsed.notification_ranking) &&
        parsed.notification_ranking.every(
          (n) =>
            typeof n.uuid === "string" &&
            typeof n.summary === "string" &&
            typeof n.rank === "number"
        )
      ) {
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse LLM output:", e);
    }
    // Return an empty ranking if parsing fails.
    return { notification_ranking: [] };
  }  

  /**
   * Handles the context which is expected to include a "notifications" field (an array).
   */
  public async handleContext(userContext: Record<string, any>): Promise<any> {
    try {
      let notifications: any[] = userContext.notifications;
      if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
        return [];
      }

      // Convert timestamps if they are in milliseconds (number) to a readable string.
      notifications = notifications.map((notification) => {
        if (notification.timestamp && typeof notification.timestamp === "number") {
          // Convert from ms to a readable UTC string.
          notification.timestamp = new Date(notification.timestamp)
            .toISOString()
            .replace("T", " ")
            .substring(0, 19);
        }
        return notification;
      });

      // Convert notifications array to a JSON string.
      const notificationsStr = JSON.stringify(notifications, null, 2);

      // console.log("NOTIFICATIONS STR:");
      // console.log(notificationsStr);

      // Prepare the prompt using the notifications string.
      const promptTemplate = new PromptTemplate({
        template: this.agentPrompt,
        inputVariables: ["notifications"],
      });

      const finalPrompt = await promptTemplate.format({
        notifications: notificationsStr 
      });
      // Initialize LLM with settings.
      const llm = LLMProvider.getLLM();

      // Call the LLM.
      const response = await llm.invoke(finalPrompt);
      
      // Expect the LLM response to have a "content" property.
      if (!response || !response.content) {
        console.error("LLM response missing content");
        return [];
      }

      const content = typeof response.content === 'string' 
        ? response.content 
        : Array.isArray(response.content) 
          ? response.content[0].type === 'text' 
            ? response.content[0].text 
            : ''
          : '';

      const parsedOutput = this.parseOutput(content);
      const rankingList = parsedOutput.notification_ranking;

      // Create a lookup of original notifications by uuid.
      const notificationsMap: { [key: string]: any } = {};
      notifications.forEach((n) => {
        notificationsMap[n.uuid] = n;
      });

      // Enrich each ranked notification with additional fields from the original notification.
      const enrichedRankingList = rankingList.map((rank) => {
        const original = notificationsMap[rank.uuid] || {};
        return {
          ...rank,
          appName: original.appName || "",
          title: original.title || "",
          text: original.text || "",
          timestamp: original.timestamp || "",
        };
      });

      // console.log("RANKING LIST:");
      console.log(enrichedRankingList);
      return enrichedRankingList;
    } catch (err) {
      console.error("[NotificationFilterAgent] Error:", err);
      return [];
    }
  }
}
