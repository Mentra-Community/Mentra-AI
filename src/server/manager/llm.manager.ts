import { ChatOpenAI } from "@langchain/openai";
import { AzureChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || "";
const AZURE_OPENAI_API_INSTANCE_NAME = process.env.AZURE_OPENAI_API_INSTANCE_NAME || "";
const AZURE_OPENAI_API_DEPLOYMENT_NAME = process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME || "";
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || "2023-05-15";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMENI_API_KEY || "";

// LLM Configuration
export enum LLMModel {
  GPT4 = 'gpt-4o',
  GPT4_MINI = 'gpt-4o-mini',
  CLAUDE = 'claude-3',
  GEMINI = 'gemini-pro',
}

export enum LLMService {
  AZURE = 'azure',
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
}

export const LLM_MODEL = process.env.LLM_MODEL || LLMModel.GPT4;
export const LLM_PROVIDER = process.env.LLM_PROVIDER || LLMService.AZURE;

export class LLMProvider {
  static getLLM(maxTokens: number = 300) {
    const model = typeof LLM_MODEL === 'string' ? LLM_MODEL as LLMModel : LLM_MODEL;
    const provider = LLM_PROVIDER || LLMService.AZURE;

    if (provider === LLMService.GEMINI) {
      return new ChatGoogleGenerativeAI({
        model: model,
        temperature: 0.3,
        maxOutputTokens: maxTokens,
        apiKey: GEMINI_API_KEY,
      });
    } else if (provider === LLMService.AZURE) {
      return new AzureChatOpenAI({
        modelName: model,
        temperature: 0.3,
        maxTokens: maxTokens,
        azureOpenAIApiKey: AZURE_OPENAI_API_KEY,
        azureOpenAIApiVersion: AZURE_OPENAI_API_VERSION,
        azureOpenAIApiInstanceName: AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiDeploymentName: AZURE_OPENAI_API_DEPLOYMENT_NAME,
      });
    } else if (provider === LLMService.OPENAI) {
      return new ChatOpenAI({
        modelName: model,
        temperature: 0.3,
        maxTokens: maxTokens,
        openAIApiKey: OPENAI_API_KEY,
      });
    } else if (provider === LLMService.ANTHROPIC) {
      return new ChatAnthropic({
        modelName: model,
        temperature: 0.3,
        maxTokens: maxTokens,
        anthropicApiKey: ANTHROPIC_API_KEY,
      });
    } else {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
}
