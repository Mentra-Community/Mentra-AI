/**
 * Camera Question Classification Keywords
 * Used by CameraQuestionAgent to categorize vision-based queries
 */

/**
 * Question TYPE categories - what kind of help the user needs
 */
export enum CameraQuestionCategory {
  PROBLEM_SOLVING = 'problem_solving',  // Diagnose and fix issues
  INSTRUCTIONS = 'instructions',         // How to use/operate something
  GENERAL = 'general',                   // Identification, OCR, translation
}

/**
 * Keywords indicating the user needs help fixing/diagnosing something
 * Response: Analyze image, identify issue, provide solution steps
 */
export const PROBLEM_SOLVING_KEYWORDS = [
  'fix', 'wrong', 'broken', 'not working', 'problem', 'issue', 'error',
  'why is', 'why does', 'why won\'t', 'why isn\'t', 'why doesn\'t',
  'stuck', 'jammed', 'diagnose', 'troubleshoot', 'debug',
  'repair', 'solve', 'what\'s wrong', 'whats wrong',
  'how do i fix', 'how to fix', 'doesn\'t work', 'isn\'t working',
  'won\'t start', 'won\'t turn on', 'won\'t work', 'stopped working',
  'help me fix', 'can you fix', 'figure out what\'s wrong'
];

/**
 * Keywords indicating the user wants to learn how to use something
 * Response: Brief overview and key usage steps
 */
export const INSTRUCTIONS_KEYWORDS = [
  'how do i use', 'how to use', 'how do you use', 'how does this work',
  'show me how', 'teach me', 'guide me', 'help me use',
  'instructions', 'steps to', 'how do i', 'how to',
  'walk me through', 'demonstrate', 'operate', 'work this',
  'turn on', 'turn off', 'switch on', 'switch off',
  'set up', 'setup', 'configure', 'install', 'connect',
  'what button', 'which button', 'where do i', 'where should i'
];

/**
 * Keywords indicating general identification, reading, or description
 * Response: Identification, OCR, translation, contextual info
 */
export const GENERAL_KEYWORDS = [
  'what is this', 'what\'s this', 'whats this',
  'what is that', 'what\'s that', 'whats that',
  'what am i looking at', 'what do you see', 'what can you see',
  'identify', 'identify this', 'tell me about', 'tell me about this',
  'describe', 'describe this', 'describe what',
  'read this', 'read that', 'read it', 'what does it say', 'what does this say',
  'translate', 'translate this', 'what language',
  'what color', 'what colour', 'how many', 'how much',
  'who is', 'who\'s this', 'who is that',
  'where is', 'what brand', 'what type', 'what kind'
];

/**
 * Keywords indicating the user wants a QUICK/SHORT response
 * Response: 20-30 words max, direct answer
 */
export const QUICK_RESPONSE_KEYWORDS = [
  'quick', 'quickly', 'brief', 'briefly', 'short', 'fast',
  'just tell me', 'just say', 'simply', 'simple answer',
  'one word', 'yes or no', 'real quick', 'in a word'
];

/**
 * Keywords indicating the user wants a DETAILED/LONG response
 * Response: 150-200 words, comprehensive explanation
 */
export const LONG_RESPONSE_KEYWORDS = [
  'explain', 'explain in detail', 'detailed', 'in detail',
  'elaborate', 'tell me more', 'more about',
  'comprehensive', 'thoroughly', 'everything about', 'all about',
  'full explanation', 'complete explanation', 'walk me through',
  'step by step', 'break it down', 'give me details'
];

/**
 * All camera-related keywords combined (for quick detection)
 */
export const ALL_CAMERA_KEYWORDS = [
  ...PROBLEM_SOLVING_KEYWORDS,
  ...INSTRUCTIONS_KEYWORDS,
  ...GENERAL_KEYWORDS
];
