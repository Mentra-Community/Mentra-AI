import { useState, useEffect } from 'react'
import PersonalityButton from '../ui/personality-button'
import { Sparkles, Briefcase, Heart, Lightbulb, Palette, Zap, LucideIcon } from 'lucide-react'
import { fetchUserSettings, updatePersonality } from '../api/settings.api'

interface Personality {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
}

interface PersonalitySettingProps {
  userId: string;
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

function PersonalitySetting({ userId }: PersonalitySettingProps) {
  const [selectedPersonality, setSelectedPersonality] = useState<string>('default')
  const [isLoading, setIsLoading] = useState(false)

  // Load user's personality preference on mount
  useEffect(() => {
    const loadPersonality = async () => {
      try {
        const settings = await fetchUserSettings(userId);
        setSelectedPersonality(settings.personality);
        console.log('✅ Loaded personality:', settings.personality);
      } catch (error) {
        console.error('Failed to load personality:', error);
      }
    };

    if (userId) {
      loadPersonality();
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
      // Could revert selection on error if needed
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto px-8">
      <h1 className="text-[24px] font-bold mb-2" style={{ color: 'var(--secondary-foreground)' }}>
        Chat Personality
      </h1>
      <p className="text-[14px] mb-6" style={{ color: 'var(--secondary-foreground)' }}>
        Choose how your AI assistant should communicate
      </p>

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
  )
}

export default PersonalitySetting