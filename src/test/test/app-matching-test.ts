// Test file to demonstrate the intelligent app matching functionality
// This would be used to test the new SmartAppControlTool

interface TestApp {
  packageName: string;
  name: string;
  description: string;
}

const mockApps: TestApp[] = [
  { packageName: "com.augmentos.mira", name: "Mira", description: "AI Assistant" },
  { packageName: "com.android.camera", name: "Camera", description: "Take photos and videos" },
  { packageName: "com.instagram.android", name: "Instagram", description: "Social media app" },
  { packageName: "com.spotify.music", name: "Spotify", description: "Music streaming" },
  { packageName: "com.netflix.mediaclient", name: "Netflix", description: "Video streaming" },
  { packageName: "com.google.android.youtube", name: "YouTube", description: "Video sharing platform" }
];

// Example test cases that would demonstrate the intelligent matching:
const testCases = [
  // Exact matches
  { input: "open Mira", expected: "com.augmentos.mira" },
  { input: "start Camera", expected: "com.android.camera" },
  
  // Partial matches
  { input: "launch Insta", expected: "com.instagram.android" },
  { input: "open music app", expected: "com.spotify.music" },
  
  // Description-based matches  
  { input: "start photo app", expected: "com.android.camera" },
  { input: "open streaming", expected: "com.netflix.mediaclient" },
  
  // Fuzzy matches (typos)
  { input: "open Mira AI", expected: "com.augmentos.mira" },
  { input: "start youtub", expected: "com.google.android.youtube" },
  
  // Different action words
  { input: "close Instagram", expected: "com.instagram.android" },
  { input: "quit Spotify", expected: "com.spotify.music" },
];

console.log("Test cases for intelligent app matching:");
testCases.forEach((testCase, index) => {
  console.log(`${index + 1}. "${testCase.input}" -> should match ${testCase.expected}`);
});

export { mockApps, testCases };