import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Lottie from 'lottie-react';
import Sidebar from '../components/Sidebar';
import MentraLogoAnimation from '../../public/figma-parth-assets/anim/Mentralogo2.json';
import MiraBackground from '../../public/figma-parth-assets/anim/Mira-Background.json';
import { MiraBackgroundAnimation } from '../components/MiraBackgroundAnimation';
import ShieldIcon from '../../public/figma-parth-assets/icons/shield-icon.svg';
import ChatIcon from '../../public/figma-parth-assets/icons/chat-icon.svg';
import WhiteMira from '../../public/figma-parth-assets/icons/white-mira-logo.svg';
import ColorMiraLogo from '../../public/figma-parth-assets/icons/color-mira-logo.svg';




interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: Date;
  image?: string;
}

interface ChatInterfaceProps {
  userId: string;
  recipientId: string;
}

/**
 * ChatInterface component - Beautiful dark-themed chat UI
 * Shows messages between the current user and Mira assistant
 * Messages are stored in memory and broadcast in real-time
 */
function ChatInterface({ userId, recipientId }: ChatInterfaceProps): React.JSX.Element {
  // Fun thinking words list
  const thinkingWords = [
    "doodling",
    "vibing",
    "cooking",
    "pondering",
    "brewing",
    "crafting",
    "dreaming",
    "computing",
    "processing",
    "brainstorming",
    "conjuring",
    "imagining"
  ];

  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [thinkingWord, setThinkingWord] = useState(() =>
    thinkingWords[Math.floor(Math.random() * thinkingWords.length)]
  );
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  // const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [imageScale, setImageScale] = useState(1);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isPrivateMode, setIsPrivateMode] = useState(() => {
    // Load private mode preference from localStorage
    const saved = localStorage.getItem('mira-private-mode');
    return saved ? JSON.parse(saved) : false;
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  console.log('[ChatInterface] Component rendered. State:', {
    userId,
    recipientId,
    messageCount: messages.length,
    isProcessing,
  });


  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Sync dark mode with private mode
  useEffect(() => {
    setIsDarkMode(isPrivateMode);
  }, [isPrivateMode]);

  // Save private mode preference to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('mira-private-mode', JSON.stringify(isPrivateMode));
    console.log('[ChatInterface] 💾 Saved private mode to localStorage:', isPrivateMode);
  }, [isPrivateMode]);

  // Apply dark class to root element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Set up SSE connection for real-time updates
  useEffect(() => {
    console.log('[ChatInterface] useEffect triggered, userId:', userId, 'recipientId:', recipientId);

    if (!userId || !recipientId) {
      console.warn('[ChatInterface] No userId or recipientId provided, skipping SSE setup');
      return;
    }

    // Connect to SSE endpoint
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const backendUrl = isDev ? 'http://localhost:3002' : '';
    const sseUrl = `${backendUrl}/api/chat/stream?userId=${encodeURIComponent(userId)}&recipientId=${encodeURIComponent(recipientId)}`;
    console.log('[ChatInterface] 📡 Connecting to SSE:', sseUrl);

    const eventSource = new EventSource(sseUrl);
    sseRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[ChatInterface] ✅ SSE connected successfully!');
    };

    eventSource.onmessage = (event) => {
      console.log('[ChatInterface] 📨 SSE message received:', event.data);

      if (!event.data || event.data.trim() === '') {
        return;
      }

      try {
        const data = JSON.parse(event.data);
        console.log('[ChatInterface] Parsed message:', data);

        if (data.type === 'message') {
          console.log('[ChatInterface] Adding message from:', data.senderId, 'to:', data.recipientId);

          const isRelevant =
            (data.senderId === userId && data.recipientId === recipientId) ||
            (data.senderId === recipientId && data.recipientId === userId);

          if (isRelevant) {
            // If it's a message FROM the user (not from Mira), show processing indicator
            if (data.senderId === userId) {
              const randomWord = thinkingWords[Math.floor(Math.random() * thinkingWords.length)];
              setThinkingWord(randomWord);
              setIsProcessing(true);
            } else {
              // If it's Mira's response, hide processing
              setIsProcessing(false);
            }

            setMessages(prev => {
              const newMessages = [...prev, {
                id: data.id || Date.now().toString(),
                senderId: data.senderId,
                recipientId: data.recipientId,
                content: data.content,
                timestamp: new Date(data.timestamp),
                image: data.image
              }];
              console.log('[ChatInterface] Updated messages array:', newMessages);
              return newMessages;
            });
          } else {
            console.log('[ChatInterface] Ignoring message from different conversation');
          }
        } else if (data.type === 'message_update') {
          console.log('[ChatInterface] 🔄 Updating message:', data.id);

          const isRelevant =
            (data.senderId === userId && data.recipientId === recipientId) ||
            (data.senderId === recipientId && data.recipientId === userId);

          if (isRelevant) {
            setMessages(prev => {
              const messageIndex = prev.findIndex(m => m.id === data.id);
              if (messageIndex === -1) {
                console.warn('[ChatInterface] ⚠️ Message not found for update:', data.id);
                return prev;
              }

              const updatedMessages = [...prev];
              updatedMessages[messageIndex] = {
                ...updatedMessages[messageIndex],
                content: data.content,
                image: data.image,
                timestamp: new Date(data.timestamp)
              };
              console.log('[ChatInterface] ✅ Message updated:', data.id);
              return updatedMessages;
            });
          } else {
            console.log('[ChatInterface] Ignoring message update from different conversation');
          }
        } else if (data.type === 'processing') {
          console.log('[ChatInterface] 🔄 Processing indicator shown');
          const randomWord = thinkingWords[Math.floor(Math.random() * thinkingWords.length)];
          setThinkingWord(randomWord);
          setIsProcessing(true);
        } else if (data.type === 'idle') {
          console.log('[ChatInterface] ⏸️ Processing complete');
          setIsProcessing(false);
        } else if (data.type === 'history') {
          console.log('[ChatInterface] 📜 Received history with', data.messages?.length || 0, 'messages');
          setMessages(data.messages.map((msg: any) => ({
            id: msg.id,
            senderId: msg.senderId,
            recipientId: msg.recipientId,
            content: msg.content,
            timestamp: new Date(msg.timestamp),
            image: msg.image
          })));
        }
      } catch (error) {
        console.error('[ChatInterface] ❌ Error parsing SSE message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[ChatInterface] ❌ SSE error:', error);
    };

    return () => {
      console.log('[ChatInterface] Closing SSE connection');
      eventSource.close();
    };
  }, [userId, recipientId]);


  return (
    <div className={`h-screen flex overflow-hidden ${isDarkMode ? 'dark' : ''}`} style={{ backgroundColor: 'var(--background)' }}>
      {/* Sidebar */}
      {/* <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isDarkMode={isDarkMode}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      /> */}

      {/* Overlay for mobile */}
      {/* {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )} */}

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative" style={{ backgroundColor: 'var(--background)' }}>
        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto relative">
          {/* Gradient background at bottom - visible only when no messages */}
              <div
                className="fixed inset-0 pointer-events-none overflow-hidden flex items-end justify-center h-full "
                style={{ paddingBottom: '0px' }}
              >
                  {/* <Lottie
                    animationData={MiraBackground}
                    loop={true}
                    autoplay={true}
                    // className="w-[778px] -mb-[480px]"
                    className='trans'
                  /> */}
                  <MiraBackgroundAnimation className='-mb-[500px]'/>
              </div>

          {/* Welcome Screen - Shows centered when no messages */}
          <AnimatePresence mode="wait">
            {messages.length === 0 && (
              <motion.div
                key="welcome-screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute inset-0 flex flex-col items-center justify-center px-6 z-10"
              >
                {/* Logo - Starts in center of screen, moves up smoothly */}
                <div className=' flex flex-col items-center -mt-[80px]'>
                  <motion.div
                    initial={{ y: '5vh' }}
                    animate={{ y: 0 }}
                    transition={{
                      duration: 0.7,
                      ease: [0.25, 0.1, 0.25, 1],
                      delay: 0.3
                    }}
                    className="mb-[10px]"
                  >
                    <Lottie
                      animationData={MentraLogoAnimation}
                      loop={true}
                      autoplay={true}
                      className="w-[150px] h-[150px]"
                    />
                  </motion.div>
                                    <h1 className="text-[20px] sm:text-4xl md:text-5xl lg:text-6xl font-semibold flex gap-[4px]  justify-center">
                    {['Start', 'with', '"Hey', 'Mira"'].map((word, index) => (
                      <motion.span
                        key={index}
                        initial={{ opacity: 0, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        transition={{
                          duration: 0.5,
                          ease: [0.25, 0.1, 0.25, 1],
                          delay: 0.7 + (index * 0.15)
                        }}
                        style={{ color: 'var(--secondary-foreground)' }}
                      >
                        {word}
                      </motion.span>
                    ))}
                  </h1>

                </div>


                {/* Text Content - Words appear one by one with blur-to-focus effect */}

              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat Messages - Fades in when messages appear */}
          {messages.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="px-4 py-6 relative z-20"
            >
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((message, index) => {
                  const isOwnMessage = message.senderId === userId;
                  return (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                      className={`flex flex-col gap-2 ${isOwnMessage ? 'items-end' : 'items-start'}`}
                    >
                      {/* Avatar and Name */}
                      <div className={`flex items-center gap-2 ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className=" ml-[8px]">

                          {!isOwnMessage && (
                            <img src={ColorMiraLogo} alt="Shield" className="w-[40px] h-[40px]" />

                            )}
                        </div>
                          
                      </div>

                      {/* Message Content */}
                      <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
                        {message.image && (
                          <div className="mb-2">
                            <img
                              src={message.image}
                              alt="Message context"
                              className="rounded-[8px] max-w-xs h-auto cursor-zoom-in hover:opacity-90 transition-opacity "
                              style={{ maxWidth: '200px' }}
                              onClick={() => setZoomedImage(message.image!)}
                            />
                          </div>
                        )}
                       <div className={` text-[var(--foreground)] leading-relaxed whitespace-pre-line pt-[8px] pb-[8px] pr-[16px] pl-[16px] rounded-[16px] inline-block max-w-lg text-[16px]  ${
                          isOwnMessage
                            ? 'bg-[var(--primary-foreground)] rounded-br-md font-medium text-[var(--secondary-foreground:)]'
                            : 'bg-transparent pl-0 font-medium *:text-[var(--secondary-foreground:)]'
                        }`}>
                          {message.content}
                        </div>
                        <div className={`text-[10px] ml-[15px] mt-1.5 ${isOwnMessage ? 'text-right' : 'text-left'} w-full text-gray-400`}>
                          {message.timestamp.toLocaleTimeString()}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}

                {/* Processing Indicator */}
                {isProcessing && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2"
                  >
                    <div className="flex-shrink-0">
                      <img src={ColorMiraLogo} alt="Shield" className="w-[40px] h-[40px]" />
                    </div>
                    <motion.div
                      className="text-sm text-gray-500 italic"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                    >
                      {`Mira ${thinkingWord}...`.split("").map((char, index) => (
                        <motion.span
                          key={index}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          {char}
                        </motion.span>
                      ))}
                    </motion.div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </motion.div>
          )}
        </div>

        {/* Sticky Bottom Bar */}
        <AnimatePresence>
          {messages.length > 0 && (
            <motion.div
              initial={{ y: 120, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 120, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30,
                duration: 0.5
              }}
              className={`sticky bottom-0 left-0 right-0   h-[111px] ${
                isDarkMode ? 'border-purple-500/20' : 'border-purple-200'
              }`}
            >
              <div className="max-w-3xl mx-auto   flex items-center justify-between h-full">
                {/* Left Button - Shield (Private Mode Toggle) */}
                <button
                  onClick={() => setIsPrivateMode(!isPrivateMode)}
                  className={`rounded-full ml-[24px] transition-all duration-500 ease-in-out hover:opacity-80 hover:scale-110 ${
                    isPrivateMode ? 'opacity-100 scale-100' : 'opacity-40 scale-95'
                  }`}
                >
                  <img src={ShieldIcon} alt="Shield" className="w-[40px] h-[40px] drop-shadow-[0_0_8px_rgba(0,0,0,0.4)]" />
                </button>
                <div className='flex flex-col justify-center items-center'>
                  <AnimatePresence mode="wait">
                    {isPrivateMode ? (
                      <motion.div
                        key="lock-icon"
                        initial={{ opacity: 0, scale: 0.8, rotateZ: -20 }}
                        animate={{ opacity: 1, scale: 1, rotateZ: 0 }}
                        exit={{ opacity: 0, scale: 0.8, rotateZ: 20 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                      >
                        <Lock className="w-[32px] h-[32px]" style={{ color: isDarkMode ? '#ffffff' : 'var(--background)' }} />
                      </motion.div>
                    ) : (
                      <motion.img
                        key="mira-icon"
                        src={WhiteMira}
                        alt="Mira"
                        className="w-[32px] h-[32px]"
                        initial={{ opacity: 0, scale: 0.8, rotateZ: 20 }}
                        animate={{ opacity: 1, scale: 1, rotateZ: 0 }}
                        exit={{ opacity: 0, scale: 0.8, rotateZ: -20 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                      />
                    )}
                  </AnimatePresence>

                  <motion.div
                    key={isPrivateMode ? 'private-text' : 'mira-text'}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className={`text-white text-[18px] mt-[4px] f transition-colors duration-`}
                  >
                    {isPrivateMode ? 'Private Chat' : 'Start with "Hey Mira"'}
                  </motion.div>
                </div>

                {/* Right Button - Chat */}
                <button
                  onClick={() => setIsPrivateMode(false)}
                  className={` rounded-full mr-[24px] transition-all duration-500 ease-in-out hover:opacity-80 hover:scale-110 shadow-4xl ${
                    !isPrivateMode ? 'opacity-100 scale-100' : 'opacity-40 scale-95'
                  }`}
                >
                  <img src={ChatIcon} alt="Chat" className="w-[40px] h-[40px] drop-shadow-[0_0_8px_rgba(0,0,0,0.3)]"  />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Image Zoom Modal */}
      {zoomedImage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center overflow-hidden"
        >
          <div className="relative w-full h-full flex items-center justify-center">
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{
                scale: imageScale,
                x: imagePosition.x,
                y: imagePosition.y
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              src={zoomedImage}
              alt="Zoomed view"
              className="max-w-full max-h-full object-contain rounded-lg select-none"
              style={{
                touchAction: 'none',
                cursor: isDragging ? 'grabbing' : 'grab'
              }}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                setImageScale(prev => Math.min(Math.max(0.5, prev + delta), 5));
              }}
              onTouchStart={(e) => {
                if (e.touches.length === 1) {
                  // Single finger - start dragging
                  setIsDragging(true);
                  setDragStart({
                    x: e.touches[0].clientX - imagePosition.x,
                    y: e.touches[0].clientY - imagePosition.y
                  });
                }
              }}
              onTouchMove={(e) => {
                e.preventDefault();

                if (e.touches.length === 1 && isDragging) {
                  // Single finger - drag the image
                  setImagePosition({
                    x: e.touches[0].clientX - dragStart.x,
                    y: e.touches[0].clientY - dragStart.y
                  });
                }
              }}
              onTouchEnd={(e) => {
                if (e.touches.length === 0) {
                  setIsDragging(false);
                }
              }}
              onMouseDown={(e) => {
                setIsDragging(true);
                setDragStart({
                  x: e.clientX - imagePosition.x,
                  y: e.clientY - imagePosition.y
                });
              }}
              onMouseMove={(e) => {
                if (isDragging) {
                  setImagePosition({
                    x: e.clientX - dragStart.x,
                    y: e.clientY - dragStart.y
                  });
                }
              }}
              onMouseUp={() => setIsDragging(false)}
              onMouseLeave={() => setIsDragging(false)}
            />
            {/* Close button */}
            <button
              className="absolute top-4 left-4 w-[40px] h-[40px] bg-[var(--background)] backdrop-blur-sm rounded-full flex justify-center items-center z-10"
              onClick={() => {
                setZoomedImage(null);
                setImageScale(1);
                setImagePosition({ x: 0, y: 0 });
                setIsDragging(false);
              }}
            >
              <X size={20} color='var(--foreground)'/>
            </button>
            {/* Zoom controls */}
            <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 flex justify-between items-center bg-[var(--background)] w-[200px] h-[56px] rounded-full px-[24px] py-[16px]">
              <button
                onClick={() => setImageScale(prev => Math.max(0.5, prev - 0.2))}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color='var(--foreground)'>
                  <path d="M20.9999 20.9999L16.6499 16.6499M8 11H14M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => {
                  setImageScale(1);
                  setImagePosition({ x: 0, y: 0 });
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color='var(--foreground)'>
                  <path d="M2 12H5M5 12C5 15.866 8.13401 19 12 19M5 12C5 8.13401 8.13401 5 12 5M19 12H22M19 12C19 15.866 15.866 19 12 19M19 12C19 8.13401 15.866 5 12 5M12 2V5M12 19V22M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => setImageScale(prev => Math.min(5, prev + 0.2))}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" color='var(--foreground)'>
                  <path d="M3 10C3 10.9193 3.18106 11.8295 3.53284 12.6788C3.88463 13.5281 4.40024 14.2997 5.05025 14.9497C5.70026 15.5998 6.47194 16.1154 7.32122 16.4672C8.1705 16.8189 9.08075 17 10 17C10.9193 17 11.8295 16.8189 12.6788 16.4672C13.5281 16.1154 14.2997 15.5998 14.9497 14.9497C15.5998 14.2997 16.1154 13.5281 16.4672 12.6788C16.8189 11.8295 17 10.9193 17 10C17 9.08075 16.8189 8.1705 16.4672 7.32122C16.1154 6.47194 15.5998 5.70026 14.9497 5.05025C14.2997 4.40024 13.5281 3.88463 12.6788 3.53284C11.8295 3.18106 10.9193 3 10 3C9.08075 3 8.1705 3.18106 7.32122 3.53284C6.47194 3.88463 5.70026 4.40024 5.05025 5.05025C4.40024 5.70026 3.88463 6.47194 3.53284 7.32122C3.18106 8.1705 3 9.08075 3 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 10H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M10 7V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M21 21L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            {/* Hint text */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/60 text-xs bg-black/50 backdrop-blur-sm px-4 py-2 rounded-full">
              Drag to pan • Scroll to zoom
            </div>
          </div>
        </motion.div>
      )}

      
    </div>
  );
}

export default ChatInterface;
