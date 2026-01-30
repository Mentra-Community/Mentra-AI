/**
 * Quick test to preview how different personalities affect the prompt
 * Run with: bun run test-personalities.ts
 */

import { buildSystemPromptWithPersonality } from './src/server/utils/prompt.util';
import { PersonalityType } from './src/server/constant/personality';

const personalities: PersonalityType[] = ['default', 'professional', 'friendly', 'candid', 'quirky', 'efficient'];

console.log('🎭 PERSONALITY PROMPT PREVIEW\n');
console.log('='='.repeat(80) + '\n');

for (const personality of personalities) {
  console.log(`\n${'▼'.repeat(40)}`);
  console.log(`🎭 PERSONALITY: ${personality.toUpperCase()}`);
  console.log('▼'.repeat(40) + '\n');

  const prompt = buildSystemPromptWithPersonality(personality);

  // Show just the personality section (first 800 chars after "You are Mentra AI")
  const personalitySection = prompt.substring(0, 1000);
  console.log(personalitySection);
  console.log('\n' + '─'.repeat(80));
}

console.log('\n\n✅ Prompt preview complete! The personalities should now be MUCH more distinct.');
console.log('💡 Key improvements:');
console.log('   1. Removed conflicting tone descriptors from base prompt');
console.log('   2. Made personality section visually prominent with borders');
console.log('   3. Added concrete examples to each personality');
console.log('   4. Changed response mode instructions to preserve personality');
console.log('   5. Emphasized that personality is CORE IDENTITY\n');
