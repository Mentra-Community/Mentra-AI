import { Agent } from './AgentInterface';
import axios from 'axios';
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';
import { LLMProvider } from '../utils'; // Utility to easily swap LLMs
import { NEWS_AGENT_PROMPT } from '../constant/prompts';

/** 
 * Minimal interface for a news article as returned by NewsAPI.
 */
interface Article {
  title: string;
  description: string;
  publishedAt: string;
}

/** 
 * The JSON structure we expect from the model's output. 
 */
interface NewsSummaries {
  news_summaries: string[];
}

/**
 * The NewsSummarizeAgent fetches recent news articles and generates
 * short bullet summaries for each, returning them as a list of strings.
 */
export class NewsAgent implements Agent {
  public agentId = 'news_summarize';
  public agentName = 'News Summarizer';
  public agentDescription = 'Fetches and summarizes recent news articles';
  public agentPrompt = NEWS_AGENT_PROMPT;
  public agentTools = [];

  /**
   * Main method from the `Agent` interface.
   * Each call returns the entire list of news summaries.
   */
  public async handleContext(userContext: Record<string, any>): Promise<any> {
    try {
      // 1) Fetch the articles
      const articles = await this.fetchNewsArticles();

      // console.log(articles);

      if (!articles.length) {
        console.log(`[NewsSummarizeAgent] No articles found.`);
        return { news_summaries: [] };
      }

      // 2) Get summaries from the LLM
      const summariesResult = await this.summarizeArticlesWithLLM(articles);
      if (!summariesResult || !summariesResult.news_summaries.length) {
        return { news_summaries: [] };
      }

      // console.log(summariesResult);
      
      // Return all the summaries.
      return summariesResult;

    } catch (err) {
      console.error(`[NewsSummarizeAgent] Error handling context:`, err);
      return { news_summaries: [] };
    }
  }

  /**
   * Fetch top headlines (tech news, in this example) from the NewsAPI.
   * Replace the query or category as you wish. 
   */
  private async fetchNewsArticles(): Promise<Article[]> {
    const apiKey = "9dfaf1c1608d4ae99da8580b212e9f64";
    const url = `https://newsapi.org/v2/top-headlines?country=us&category=technology&apiKey=${apiKey}`;
    
    try {
      const response = await axios.get(url);
      const data = response.data || {};
      const rawArticles = data.articles || [];

      // Filter each article to only include relevant keys
      return rawArticles.map((article: any) => ({
        title: article.title || '',
        description: article.description || '',
        publishedAt: article.publishedAt || '',
      }));
    } catch (err) {
      console.error('[NewsSummarizeAgent] Error fetching news articles:', err);
      return [];
    }
  }

  /**
   * Uses LangChainJS to process articles via an LLM and return structured summaries.
   */
  private async summarizeArticlesWithLLM(articles: Article[]): Promise<NewsSummaries | null> {
    try {
      // Initialize LLM via `LLMProvider`
      const llm = LLMProvider.getLLM(); // Returns a `ChatOpenAI` or another model

      // Define the structured output parser (forces JSON format)
      const outputParser = new JsonOutputFunctionsParser({
        argsOnly: true,
      });

      // Define the prompt
      const prompt = new PromptTemplate({
        template: this.agentPrompt,
        inputVariables: ['news_articles'],
      });

      // Format prompt with news articles
      const formattedPrompt = await prompt.format({
        news_articles: JSON.stringify(articles, null, 2),
      });

      // Run LLM
      const response = await llm.invoke(formattedPrompt);
      const responseText = response.content.toString();
      
      // Parse JSON output and ensure it matches NewsSummaries interface
      const parsed = await outputParser.parse(responseText) as { news_summaries?: string[] };
      return {
        news_summaries: parsed.news_summaries || []
      };

    } catch (err) {
      console.error('[NewsSummarizeAgent] Error calling LangChain LLM:', err);
      return null;
    }
  }
}
