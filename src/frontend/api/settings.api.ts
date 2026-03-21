// API functions for user settings

const getApiUrl = () => window.location.origin;

export interface UserSettings {
  userId: string;
  theme: 'light' | 'dark';
  chatHistoryEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}
  
/**
 * Fetch user settings from the API
 */
export const fetchUserSettings = async (userId: string): Promise<UserSettings> => {
  const apiUrl = getApiUrl();
  const response = await fetch(`${apiUrl}/api/settings?userId=${encodeURIComponent(userId)}`);

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
  const response = await fetch(`${apiUrl}/api/settings`, {
    method: 'PATCH',
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
  return updateUserSettings(userId, { theme });
};

/**
 * Update only the chatHistoryEnabled setting
 */
export const updateChatHistoryEnabled = async (
  userId: string,
  chatHistoryEnabled: boolean
): Promise<UserSettings> => {
  return updateUserSettings(userId, { chatHistoryEnabled });
};
