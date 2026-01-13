import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  logger as _logger
} from '@mentra/sdk';

// Define the input schema using zod
const ThinkingInputSchema = z.object({
  thought: z.string().min(1).describe('The thought, reasoning step, or internal memo to process'),
});

const PACKAGE_NAME = process.env.PACKAGE_NAME;


// Type for the thinking input based on the schema
type ThinkingInput = z.infer<typeof ThinkingInputSchema>;

/**
 * ThinkingTool allows the agent to organize its internal thought process
 * by writing out reasoning steps, considerations, or internal memos to self.
 * This tool helps the agent structure its thinking and maintain context
 * during complex reasoning tasks.
 *
 * Input: { "thought": string }
 * Output: Returns a confirmation that the thought was processed
 */
export class ThinkingTool extends StructuredTool {
  name = 'Internal_Thinking';
  description = 'Allows the agent to write out internal thoughts, reasoning steps, or memos to self. Use this tool to organize your thinking process, note important considerations, or structure your approach to complex problems. Input: { "thought": string } with your thoughts.';
  schema = ThinkingInputSchema;

  /**
   * Processes the agent's internal thoughts and provides confirmation
   * @param input - Object with thought property (string)
   * @returns Promise<string> - Confirmation message
   */
  async _call(input: ThinkingInput): Promise<string> {

    const logger = _logger.child({app: PACKAGE_NAME});
    logger.debug("[ThinkingTool] Running...")
    const { thought } = input;

    // Validate that thought is not empty
    if (!thought || thought.trim() === '') {
      return 'No thought provided. Please provide some content to think about.';
    }

    const trimmedThought = thought.trim();

    // Log the thought for debugging purposes (optional)
    console.log(`[ThinkingTool] Agent thought: ${trimmedThought}`);
    logger.debug(`[ThinkingTool] Thought done:  ${trimmedThought}`)


    // Return a confirmation that acknowledges the thought was processed
    // This helps the agent know the tool executed successfully
    return `Thought processed: "${trimmedThought}"\nContinuing with reasoning...`;
  }
}