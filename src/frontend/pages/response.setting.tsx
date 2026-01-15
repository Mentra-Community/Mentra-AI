import { useState, useEffect } from 'react'
import PersonalityButton from '../ui/personality-button'
import SettingItem from '../ui/setting-item'
import ToggleSwitch from '../ui/toggle-switch'
import { Sparkles, Briefcase, Heart, Lightbulb, Palette, Zap, LucideIcon } from 'lucide-react'
import { fetchUserSettings, updatePersonality, updateFollowUpEnabled } from '../api/settings.api'

interface Personality {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
}

interface ResponseSettingProps {
  userId: string;
  showToast: (message: string, type: 'success' | 'error') => void;
}

const personalities: Personality[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Clear and neutral',
    icon: Sparkles
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'Formal and professional',
    icon: Briefcase
  },
  {
    id: 'friendly',
    name: 'Friendly',
    description: 'Warm and conversational',
    icon: Heart
  },
  {
    id: 'candid',
    name: 'Candid',
    description: 'Direct and honest',
    icon: Lightbulb
  },
  {
    id: 'quirky',
    name: 'Quirky',
    description: 'Playful and imaginative',
    icon: Palette
  },
  {
    id: 'efficient',
    name: 'Efficient',
    description: 'Concise and focused',
    icon: Zap
  }
]

function ResponseSetting({ userId, showToast }: ResponseSettingProps) {
  const [selectedPersonality, setSelectedPersonality] = useState<string>('default')
  const [followUpEnabled, setFollowUpEnabled] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  // Load user's settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await fetchUserSettings(userId);
        setSelectedPersonality(settings.personality);
        setFollowUpEnabled(settings.followUpEnabled ?? true);
        console.log('✅ Loaded response settings:', settings.personality, settings.followUpEnabled);
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };

    if (userId) {
      loadSettings();
    }
  }, [userId]);

  const handleSelectPersonality = async (personalityId: string) => {
    setIsLoading(true);
    setSelectedPersonality(personalityId);

    try {
      await updatePersonality(userId, personalityId as any);
      console.log('✅ Personality saved:', personalityId);
    } catch (error) {
      console.error('Failed to save personality:', error);
    } finally {
      setIsLoading(false);
    }
  }

  const handleFollowUpToggle = async () => {
    const newValue = !followUpEnabled;
    setFollowUpEnabled(newValue);

    try {
      await updateFollowUpEnabled(userId, newValue);
      console.log('✅ Follow-up setting synced:', newValue);
    } catch (error) {
      console.error('Failed to update follow-up setting:', error);
      showToast('Failed to save follow-up preference', 'error');
      setFollowUpEnabled(!newValue);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto px-8">
      <h1 className="text-[24px] font-bold mb-2" style={{ color: 'var(--secondary-foreground)' }}>
        AI Response
      </h1>
      <p className="text-[14px] mb-6" style={{ color: 'var(--secondary-foreground)' }}>
        Customize how your AI assistant responds
      </p>

      {/* Follow-up Toggle Section */}
      <div className="mb-6">
        <h2 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--secondary-foreground)' }}>
          Behavior
        </h2>
        <SettingItem
          isFirstItem={true}
          isLastItem={true}
          settingItemName="Follow-up"
          description="Enable contextual follow-ups"
          customContent={
            <ToggleSwitch
              isOn={followUpEnabled}
              onToggle={handleFollowUpToggle}
              label="Follow-up"
            />
          }
        />
      </div>

      {/* Personality Section */}
      <div>
        <h2 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--secondary-foreground)' }}>
          Personality
        </h2>
        <div className="space-y-2">
          {personalities.map((personality, index) => (
            <PersonalityButton
              key={personality.id}
              name={personality.name}
              description={personality.description}
              icon={personality.icon}
              isSelected={selectedPersonality === personality.id}
              onClick={() => handleSelectPersonality(personality.id)}
              isFirstItem={index === 0}
              isLastItem={index === personalities.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default ResponseSetting
