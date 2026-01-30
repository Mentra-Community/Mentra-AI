/**
 * Wake words that trigger Mira activation
 */



export const explicitWakeWords = [
  // Canonical
  "hey mentra",

  // // Spacing / punctuation
  // "heymentra",
  // "hey-mentra",

  // // Common phonetic variants
  // "hey mantra",
  // "hey manta",
  // "hey menta",
  // "hey mentara",
  // "hey mentera",
  // "hey montra",
  // "hey montera",
  // "hey monta",
  // "hey mentro",
  // "hey mentroa",
  // "hey mentu",

  // // ASR vowel swaps
  // "hey mehntra",
  // "hey menra",
  // "hey manra",
  // "hey mendra",
  // "hey mendro",
  // "hey mentaah",

  // // Soft consonant errors
  // "hey mencha",
  // "hey menja",

  // // Extended / doubled endings
  // "hey mantraa",
  // "hey mantrae",
  // "hey montraa",

  // // Common misrecognitions (keep if your logs show them)
  // "hey mentor",
  // "hey mental",

  // // Edge but observed
  // "hey metro",
  // "hey mandra"
];



// export const explicitWakeWords = [
//   "hey mira", "he mira", "hey mara", "he mara", "hey mirror", "he mirror",
//   "hey miara", "he miara", "hey mia", "he mia", "hey mural", "he mural",
//   "hey amira", "hey myra", "he myra", "hay mira", "hai mira", "hey-mira",
//   "he-mira", "heymira", "heymara", "hey mirah", "he mirah", "hey meera", "he meera",
//   "Amira", "amira", "a mira", "a mirror", "hey miller", "he miller", "hey milla", "he milla", "hey mila", "he mila",
//   "hey miwa", "he miwa", "hey mora", "he mora", "hey moira", "he moira",
//   "hey miera", "he miera", "hey mura", "he mura", "hey maira", "he maira",
//   "hey meara", "he meara", "hey mara", "he mara", "hey mina", "he mina",
//   "hey mirra", "he mirra", "hey mir", "he mir", "hey miro", "he miro",
//   "hey miruh", "he miruh", "hey meerah", "he meerah", "hey meira", "he meira",
//   "hei mira", "hi mira", "hey mere", "he mere", "hey murra", "he murra",
//   "hey mera", "he mera", "hey neera", "he neera", "hey murah", "he murah",
//   "hey mear", "he mear", "hey miras", "he miras", "hey miora", "he miora", "hey miri", "he miri",
//   "hey maura", "he maura", "hey maya", "he maya", "hey moora", "he moora",
//   "hey mihrah", "he mihrah", "ay mira", "ey mira", "yay mira", "hey mihra",
//   "hey mera", "hey mira", "hey mila", "hey mirra", "hey amir", "hey amira", "hey mary",
//   "hey mentra", "he mentra", "hey mantra", "he mantra", "hey menta", "he menta",
//   "hey mentara", "he mentara", "hey mentera", "he mentera", "heymentra", "hey-mentra", "hey dementia",
//   "he mentioned", "hey mentioned",

//   "hey mantra", "hey manta", "hey menta", "hey metro", "hey mentor", "hey mental",
//   "hey mandra", "hey mantraa", "hey mantrae", "hey mehntra", "hey mencha",
//   "hey menja", "hey menra", "hey manra", "hey mendra", "hey montra", "hey montraa",
//   "hey montera", "hey monta", "hey minton", "hey mentaah", "hey mendro",
//   "hey mentro", "hey mentu", "hey mentroa",

//   // // weak t substitutions
//   // "hey menra", "hey menna", "hey menya", "hey menwa", "hey mena",
//   // "hey mehra", "hey mehraaa",

//   // // "men–" replaced
//   // "hey mantra", "hey mantraa", "hey mantrae", "hey mandra", "hey mandraa",
//   // "hey mantrao", "hey mentos", "hey mendes", "hey mendo", "hey mender",
//   // "hey mendy", "hey mentae", "hey mentina", "hey mentila", "hey mentara",

//   // // "-tra" replaced
//   // "hey menta", "hey menton", "hey menter", "hey mentor", "hey menture",
//   // "hey mento", "hey mentae", "hey mentira", "hey mentala", "hey mentura",
//   // "hey mentaga", "hey mentaqa", "hey mentala",

//   // // slurred variants
//   // "hemetra", "hemenra", "hemencha", "hemantra", "hementra", "hementraaa",
//   // "hemetrae", "haymentra", "haymetra", "aymentra", "amentra", "ehmentra",
//   // "eymentra", "hamentra", "hamentro",

//   // // common mishears
//   // "hey mitra", "hey mitro", "hey mitraaa", "hey metro", "hey matra",
//   // "hey mestra", "hey mestraa", "hey mestrae", "hey mestrao", "hey mistra",
//   // "hey mistraa", "hey mintra", "hey minthra", "hey myntra", "hey myntraa",
//   // "hey myntrae",

//   // // real word confusables
//   // "hey mentor", "hey mental", "hey metric", "hey mattress", "hey metro",
//   // "hey matter", "hey metal", "hey medra", "hey menorah", "hey minerva",
//   // "hey mantra", "hey mantle", "hey mehta", "hey meta",

//   // // vowel swaps
//   // "hi mentra", "hi mantra", "hi manta", "hi metro", "hi myntra", "hi mintra",
//   // "hi mentro", "hi mentao", "hi mantro", "hi montro",

//   // // accent-based
//   // "hay mentraa", "hye mentraah", "hey mehn-tra", "hey main-tra",
//   // "hey man-tra", "hey meh-tra", "hey mayn-tra", "hey min-tra",
//   // "hey men-dra", "hey men-traa",

//   // // esl / kid variants
//   // "hey menta", "hey menthwa", "hey mentula", "hey mentwa", "hey mengra",
//   // "hey mengla", "hey mencha", "hey man-cha", "hey metchra", "hey metra",
//   // "hey maytra", "hey meetra",

//   // // additional name variants
//   // "hey myntra", "he myntra", "hi myntra", "hay myntra",
//   // "hey mitch", "he mitch", "hi mitch", "hay mitch",
//   // "hey mitchell", "he mitchell", "hi mitchell", "hay mitchell",
//   // "hey mitchel", "he mitchel", "hey mitchall", "hey michell",

//   // // weird ones here:
//   // "a mantra", "a mentra", "a mentora", "a mentara", "it mentioned",

//   // // additional sound-alike words
//   // "hey everyone", "he everyone", "hi everyone",
//   // "hey middle", "he middle", "hi middle",
//   // "hey matt", "he matt", "hi matt", "hey mat", "he mat",
//   // "hey inventory", "he inventory", "hi inventory",
//   // "hey man", "he man", "hi man",
//   // "hey mensha", "he mensha", "hi mensha", "hey mensa", "he mensa", "hey amanda", "hey mention", "payment",
// ];

/**
 * Cancellation phrases that cancel Mira activation
 */
export const cancellationPhrases = [
  "never mind", "nevermind", "cancel", "stop", "ignore that",
  "that was a mistake", "didn't want to activate you",
  "didn't mean to activate you", "false alarm", "go away",
  "not you", "wasn't talking to you", "ignore", "disregard",
  "didn't mean to", "didn't want to", "wasn't for you"
];

/**
 * Vision keywords that indicate a query requires camera/image analysis
 */
export const visionKeywords = [
  // ============ GENERAL IDENTIFICATION ============
  'what am i looking at', 'what is this', 'what is that',
  'identify this', 'identify that', 'what do you see', 'describe what',
  'tell me about this', 'tell me about that', 'what\'s in front of me',
  'can you see', 'look at this', 'look at that', 'check this out',
  'what\'s this', 'what\'s that', 'whats this', 'whats that',
  'what kind of', 'what type of', 'what brand', 'what model',
  'who is this', 'who is that', 'who\'s this', 'who\'s that',

  // ============ READING / OCR ============
  'read this', 'read that', 'read it', 'what does this say',
  'what does that say', 'what does it say', 'what is written',
  'can you read', 'read the text', 'read the sign', 'read the label',
  'what\'s written', 'whats written', 'translate this', 'translate that',

  // ============ COUNTING / COLORS / QUANTITIES ============
  'what color', 'what colour', 'how many', 'how much',
  'count the', 'count how many', 'how big', 'how small',
  'how tall', 'how long', 'how wide', 'what size',

  // ============ DESCRIPTION ============
  'describe this', 'describe that', 'describe what you see',
  'tell me what you see', 'explain what you see',
  'what do you notice', 'what can you tell me about',

  // ============ PROBLEM SOLVING (implies looking at something) ============
  'solve this', 'fix this', 'what\'s wrong', 'whats wrong',
  'what is wrong', 'how do i fix', 'how do i solve', 'how can i fix',
  'help me fix', 'help me solve', 'help me with this',
  'what\'s the problem', 'whats the problem', 'what is the problem',
  'diagnose this', 'troubleshoot this', 'debug this',
  'why isn\'t this working', 'why isnt this working',
  'why is this broken', 'why doesn\'t this work', 'why doesnt this work',
  'this isn\'t working', 'this isnt working', 'this doesn\'t work',
  'not working', 'broken', 'stuck', 'jammed',
  'what should i do', 'what do i do', 'how do i repair',

  // ============ INSTRUCTIONS (implies looking at something) ============
  'how do i use this', 'how do i use that', 'how does this work',
  'how does that work', 'show me how', 'teach me how',
  'how to use this', 'how to use that', 'what does this do',
  'what does that do', 'how do i operate', 'how to operate',
  'how do i turn this on', 'how do i turn this off',
  'how do i set this up', 'how to set up', 'where do i',
  'which button', 'what button', 'where is the', 'how do i connect',
  'guide me', 'walk me through', 'step by step',

  // ============ LOCATION / SPATIAL ============
  'where is this', 'where is that', 'where am i',
  'what place is this', 'what building', 'what store',
  'what restaurant', 'what street'
];
