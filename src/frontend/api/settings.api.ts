// API functions for user settings

const getApiUrl = () => window.location.origin;

export interface UserSettings {
  userId: string;
  textModel: string;
  visionModel: string;
  personality: 'default' | 'professional' | 'friendly' | 'candid' | 'quirky' | 'efficient';
  theme: 'light' | 'dark';
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Fetch user settings from the API
 */
export const fetchUserSettings = async (userId: string): Promise<UserSettings> => {
  const apiUrl = getApiUrl();
  const response = await fetch(`${apiUrl}/api/db/settings?userId=${userId}`);

  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }

  return response.json();
};

/**
 * Update user settings (partial update)
 */
export const updateUserSettings = async (
  userId: string,
  updates: Partial<Omit<UserSettings, 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<UserSettings> => {
  const apiUrl = getApiUrl();
  const response = await fetch(`${apiUrl}/api/db/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...updates }),
  });

  if (!response.ok) {
    throw new Error('Failed to update settings');
  }

  return response.json();
};

/**
 * Update only the theme setting
 */
export const updateTheme = async (
  userId: string,
  theme: 'light' | 'dark'
): Promise<UserSettings> => {
  const apiUrl = getApiUrl();
  const response = await fetch(`${apiUrl}/api/db/settings/theme`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, theme }),
  });

  if (!response.ok) {
    throw new Error('Failed to update theme');
  }

  return response.json();
};

/**
 * Update only the personality setting
 */
export const updatePersonality = async (
  userId: string,
  personality: 'default' | 'professional' | 'friendly' | 'candid' | 'quirky' | 'efficient'
): Promise<UserSettings> => {
  const apiUrl = getApiUrl();
  const response = await fetch(`${apiUrl}/api/db/settings/personality`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, personality }),
  });

  if (!response.ok) {
    throw new Error('Failed to update personality');
  }

  return response.json();
};
