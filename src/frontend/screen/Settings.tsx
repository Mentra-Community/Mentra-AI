import React, { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Header from '../components/Header';
import Toast from '../components/Toast';
import { useToast } from '../components/useToast';
import { useHandGesture } from '../tools/handGestures';
import SettingItem from '../ui/setting-item';

interface TranscriptionEntry {
  id: string;
  text: string;
  timestamp: string;
  isFinal: boolean;
}

// Hook to receive live transcription via SSE
const useTranscriptionStream = (userId: string) => {
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptionEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const apiUrl = window.location.origin;
    const eventSource = new EventSource(`${apiUrl}/api/transcription/stream?userId=${userId}`);

    eventSource.onopen = () => {
      console.log('[Transcription SSE] Connected');
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'transcription') {
          console.log('[Transcription SSE] Received:', data.text, 'isFinal:', data.isFinal);

          if (data.isFinal) {
            // When transcription is final, add it to history and clear current
            // Keep only the last 5 entries
            const newEntry: TranscriptionEntry = {
              id: `${Date.now()}-${Math.random()}`,
              text: data.text,
              timestamp: data.timestamp || new Date().toISOString(),
              isFinal: true
            };
            setTranscriptionHistory(prev => {
              const updated = [...prev, newEntry];
              // Keep only the last 5 entries
              return updated.slice(-5);
            });
            setCurrentTranscription('');
          } else {
            // When transcription is interim, just update current
            setCurrentTranscription(data.text);
          }
        } else if (data.type === 'connected') {
          console.log('[Transcription SSE] Connection established');
        }
      } catch (error) {
        console.error('[Transcription SSE] Error parsing message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[Transcription SSE] Error:', error);
      setIsConnected(false);
    };

    return () => {
      console.log('[Transcription SSE] Closing connection');
      eventSource.close();
      setIsConnected(false);
    };
  }, [userId]);

  return { currentTranscription, transcriptionHistory, isConnected };
};

interface SettingsProps {
  onBack: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  userId: string;
}

/**
 * Settings page component
 * Displays settings options and allows navigation back to chat
 */
function Settings({ onBack, isDarkMode, onToggleDarkMode, userId }: SettingsProps): React.JSX.Element {
  const gestureAreaRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const transcriptionScrollRef = useRef<HTMLDivElement>(null);
  const [devModeEnabled, setDevModeEnabled] = useState(() => {
    // Load dev mode state from localStorage
    const saved = localStorage.getItem('mira-dev-mode');
    return saved ? JSON.parse(saved) : false;
  });
  const { toastState, showToast, hideToast } = useToast();

  // Connect to transcription SSE stream
  const { currentTranscription, transcriptionHistory, isConnected } = useTranscriptionStream(userId);

  // Auto-scroll to bottom when new transcriptions arrive
  useEffect(() => {
    if (transcriptionScrollRef.current) {
      transcriptionScrollRef.current.scrollTop = transcriptionScrollRef.current.scrollHeight;
    }
  }, [transcriptionHistory, currentTranscription]);

  // Save dev mode state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('mira-dev-mode', JSON.stringify(devModeEnabled));
  }, [devModeEnabled]);

  // Setup hand gesture detector
  useHandGesture(gestureAreaRef, {
    threshold: 30, // Reduced from 50 to make it easier
    timeout: 5000, // Increased from 3000 to give more time
    onGestureDetected: (event) => {
      console.log('🎉 Gesture detected in Settings:', event);
      const newState = !devModeEnabled;
      setDevModeEnabled(newState);
      showToast(newState ? 'Dev Mode Enabled' : 'Dev Mode Disabled', 'success');
    }
  });

  // Prevent overscroll bounce
  useEffect(() => {
    const preventOverscroll = (e: TouchEvent) => {
      const target = scrollAreaRef.current;
      if (!target) return;

      const scrollTop = target.scrollTop;
      const scrollHeight = target.scrollHeight;
      const height = target.clientHeight;

      const delta = e.touches[0].clientY - (e.touches[0].target as any).startY;

      if ((scrollTop === 0 && delta > 0) || (scrollTop + height >= scrollHeight && delta < 0)) {
        e.preventDefault();
      }
    };

    const element = scrollAreaRef.current;
    if (element) {
      element.addEventListener('touchstart', (e: any) => {
        e.target.startY = e.touches[0].clientY;
      }, { passive: false });

      element.addEventListener('touchmove', preventOverscroll, { passive: false });
    }

    return () => {
      if (element) {
        element.removeEventListener('touchmove', preventOverscroll);
      }
    };
  }, []);

  return (
    <div
      ref={gestureAreaRef}
      className={`h-screen flex flex-col ${isDarkMode ? 'dark' : ''}`}
      style={{
        backgroundColor: 'var(--background)',
        overscrollBehavior: 'none',
        touchAction: 'pan-y'
      }}
    >
      {/* Header */}
      <Header
        isDarkMode={isDarkMode}
        onToggleDarkMode={onToggleDarkMode}
        onSettingsClick={onBack}
      />

      {/* Settings Content */}
      <motion.div
        ref={scrollAreaRef}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 px-[24px] pt-[24px] space-y-3 overflow-y-auto"
        style={{
          overscrollBehavior: 'none',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y'
        }}
      >
        {/* Conversation Model Setting Row */}
        <div
          className="flex items-center justify-between px-[16px] rounded-[16px] h-[56px]"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <span
            className="text-[14px] font-medium font-semibold"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            Conversation Model
          </span>
          <span
            className="text-[14px] font-normal"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            GPT-4.1-mini
          </span>
        </div>

        {/* Vision Model Setting Row */}
        <div
          className="flex items-center justify-between px-[16px] rounded-[16px] h-[56px]"
          style={{ backgroundColor: 'var(--primary-foreground)' }}
        >
          <span
            className="text-[14px] font-medium font-semibold"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            Vision Model
          </span>
          <span
            className="text-[14px] font-normal"
            style={{ color: 'var(--secondary-foreground)' }}
          >
            Gemini Flash Latest
          </span>
        </div>

          <SettingItem isFirstItem={false} isLastItem={false} settingItemName="Gemini Flash Latest"/>


        {/* Dev Mode Badge (shown when enabled) */}
        {devModeEnabled && (
          <div className='flex flex-col gap-3'>
            <div className='w-full bg-[#e5e5e56f] rounded-[20px] p-[16px] flex flex-col gap-2'>
              <div className='flex items-center justify-between'>
                <div className='text-[14px] font-semibold'
                  style={{ color: 'var(--secondary-foreground)' }}
                >Microphone Test</div>
                <div className={`text-[12px] ${isConnected ? 'text-green-500' : 'text-red-500'}`}>
                  {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
                </div>
              </div>
              <div
                ref={transcriptionScrollRef}
                className='bg-white dark:bg-gray-800 rounded-[12px] p-[12px] h-[300px] overflow-y-auto'
                style={{
                  color: 'var(--secondary-foreground)',
                }}
              >
                {transcriptionHistory.length === 0 && !currentTranscription ? (
                  <div className='text-[14px] text-gray-400 italic'>
                    Waiting for transcription...
                  </div>
                ) : (
                  <div className='flex flex-col gap-1'>
                    {/* Show history of final transcriptions */}
                    {transcriptionHistory.map((entry) => (
                      <div
                        key={entry.id}
                        className='bg-blue-50 dark:bg-blue-900/20 rounded-[8px] p-[5px] border border-blue-200 dark:border-blue-800'
                      >
                        <div className='text-[7px] leading-relaxed whitespace-pre-wrap'>
                          {entry.text}
                        </div>
                        <div className='text-[5px] text-gray-500 dark:text-gray-400 '>
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}

                    {/* Show current interim transcription */}
                    {currentTranscription && (
                      <div className='bg-gray-100 dark:bg-gray-700/50 rounded-[8px] p-[10px] border border-dashed border-gray-300 dark:border-gray-600'>
                        <div className='text-[10px] leading-relaxed whitespace-pre-wrap text-gray-600 dark:text-gray-300 italic'>
                          {currentTranscription}
                        </div>
                        <div className='text-[10px] text-gray-400 mt-1'>
                          (listening...)
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Toast Notification */}
      <Toast
      
        show={toastState.show}
        message={toastState.message}
        type={toastState.type}
        duration={300000}
        onClose={hideToast}
      />
    </div>
  );
}

export default Settings;
