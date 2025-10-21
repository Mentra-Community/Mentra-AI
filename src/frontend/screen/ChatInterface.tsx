import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Menu, X, Search, Plus, MessageSquare, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AnimatedLogo from '../components/AnimeLogo';


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
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [imageScale, setImageScale] = useState(1);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDarkMode, setIsDarkMode] = useState(true);
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
          setIsProcessing(false);

          const isRelevant =
            (data.senderId === userId && data.recipientId === recipientId) ||
            (data.senderId === recipientId && data.recipientId === userId);

          if (isRelevant) {
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
        } else if (data.type === 'processing') {
          console.log('[ChatInterface] 🔄 Processing indicator shown');
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
    <div className="h-screen flex bg-black overflow-hidden">
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 backdrop-blur-xl border-r transform transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:relative lg:translate-x-0 flex flex-col ${
          isDarkMode
            ? 'bg-black/95 border-purple-500/30'
            : 'bg-gray-50/98 border-purple-400/40'
        }`}
      >
        {/* Sidebar Header */}
        <div className={`p-3 border-b ${isDarkMode ? 'border-purple-500/30' : 'border-purple-400/30'}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className={`text-sm font-semibold flex items-center gap-2 ${
              isDarkMode ? 'text-purple-200' : 'text-purple-900'
            }`}>
              <MessageSquare className={`w-4 h-4 ${
                isDarkMode ? 'text-purple-400' : 'text-purple-700'
              }`} />
              Conversations
            </h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className={`lg:hidden p-1 rounded transition-colors ${
                isDarkMode ? 'hover:bg-purple-500/20' : 'hover:bg-purple-300/60'
              }`}
            >
              <X className={`w-4 h-4 ${
                isDarkMode ? 'text-purple-300' : 'text-purple-800'
              }`} />
            </button>
          </div>

          {/* New Chat Button - Disabled/Under Construction */}
          <button
            disabled
            className={`w-full rounded-lg py-2 px-3 flex items-center justify-center gap-2 text-sm border cursor-not-allowed relative ${
              isDarkMode
                ? 'bg-purple-600/20 text-purple-200/60 border-purple-500/30'
                : 'bg-purple-200/60 text-purple-700/60 border-purple-400/40'
            }`}
            title="Under construction"
          >
            <Plus className="w-4 h-4" />
            New Chat
            <span className={`absolute -top-1 -right-1 text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
              isDarkMode
                ? 'bg-yellow-500/30 text-yellow-300 border-yellow-500/50'
                : 'bg-yellow-300 text-yellow-900 border-yellow-500'
            }`}>
              Soon
            </span>
          </button>
        </div>

        {/* Search Bar - Disabled/Under Construction */}
        <div className={`p-3 border-b ${isDarkMode ? 'border-purple-500/30' : 'border-purple-400/30'}`}>
          <div className="relative">
            <Search className={`absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 ${
              isDarkMode ? 'text-purple-400/60' : 'text-purple-700/60'
            }`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search (coming soon)..."
              disabled
              className={`w-full border rounded-lg py-1.5 pl-8 pr-3 text-sm cursor-not-allowed ${
                isDarkMode
                  ? 'bg-gray-900/30 border-purple-500/30 text-purple-100/60 placeholder-purple-400/60'
                  : 'bg-white border-purple-400/40 text-purple-800/60 placeholder-purple-700/60'
              }`}
            />
          </div>
        </div>

        {/* Conversation History Placeholder */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <p className={`text-xs ${
              isDarkMode ? 'text-purple-300/70' : 'text-purple-700/70'
            }`}>
              No conversation history
            </p>
            <p className={`text-[10px] mt-1 ${
              isDarkMode ? 'text-purple-400/50' : 'text-purple-600/60'
            }`}>
              coming soon
            </p>
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* Main Content */}
      <div className={`flex-1 flex flex-col relative ${
        isDarkMode
          ? 'bg-gradient-to-b from-black via-gray-950 to-black'
          : 'bg-gradient-to-b from-gray-50 via-white to-gray-50'
      }`}>
        {/* Header */}
        <header className={`backdrop-blur-lg px-4 py-3 flex items-center justify-between sticky z-11 w-full`}>
          {/* Left side - Menu button */}
          <div className="flex items-center gap-3 w-24">
            <button
              onClick={() => setSidebarOpen(true)}
              className={`lg:hidden p-2 rounded-lg transition-colors ${
                isDarkMode ? 'hover:bg-purple-500/10' : 'hover:bg-purple-100'
              }`}
            >
              <Menu className={`w-5 h-5 ${isDarkMode ? 'text-purple-300' : 'text-purple-600'}`} />
            </button>
          </div>

          {/* Center - Logo */}


          {/* Right side - Theme toggle */}
          <div className="flex items-center gap-3 w-24 justify-end">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-2 rounded-lg transition-colors ${
                isDarkMode ? 'hover:bg-purple-500/10' : 'hover:bg-purple-100'
              }`}
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? (
                <Sun className="w-5 h-5 text-purple-300" />
              ) : (
                <Moon className="w-5 h-5 text-purple-600" />
              )}
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto relative ">
          {/* Stars in background - Always visible, dims when conversation starts */}
          <motion.div
            animate={{
              opacity: messages.length === 0 ? 1 : 0.2
            }} 
            transition={{ duration: 0.8, ease: 'easeInOut' }}
            className="absolute inset-0 pointer-events-none"
          >
            {[...Array(50)].map((_, i) => {
              const randomLeft = Math.random() * 100;
              const randomTop = Math.random() * 100;
              const randomDelay = Math.random() * 3;
              const randomDuration = 2 + Math.random() * 2;
              return (
                <div
                  key={i}
                  className={`absolute w-0.5 h-0.5 rounded-full ${
                    isDarkMode ? 'bg-purple-300/30' : 'bg-purple-400/20'
                  }`}
                  style={{
                    left: `${randomLeft}%`,
                    top: `${randomTop}%`,
                    animation: `twinkle ${randomDuration}s ease-in-out ${randomDelay}s infinite`,
                  }}
                />
              );
            })}
          </motion.div>

          {/* Background glow effects - Fades out when messages appear */}
          <AnimatePresence>
            {messages.length === 0 && (
              <>
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8, ease: 'easeInOut' }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <div className={`w-96 h-96 rounded-full blur-3xl animate-pulse ${
                    isDarkMode ? 'bg-purple-600/10' : 'bg-purple-400/15'
                  }`}></div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8, ease: 'easeInOut' }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <div className={`w-64 h-64 rounded-full blur-2xl ${
                    isDarkMode ? 'bg-purple-500/20' : 'bg-purple-300/25'
                  }`} style={{ animation: 'pulse 3s ease-in-out infinite' }}></div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Animated Logo - Shows centered when no messages, fades away when conversation starts */}


          {/* Animated Logo and Text - Moves to top after loading, then fades out when messages appear */}
          <AnimatePresence mode="wait">
            {messages.length === 0 && (
              <motion.div
                key="welcome-screen"
                initial={{ opacity: 0, y: 0 }}
                animate={{
                  opacity: 1,
                  y: [0, 0, -30],
                  transition: {
                    opacity: { duration: 0.5 },
                    y: { duration: 1.2, times: [0, 0.75, 1], ease: [0.4, 0, 0.2, 1] }
                  }
                }}
                exit={{ opacity: 0, y: -20, transition: { duration: 0.4, ease: 'easeInOut' } }}
                className="absolute inset-0 flex flex-col items-center justify-center px-6 z-10"
              >
                {/* Animated Logo */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="mb-0"
                >
                  <AnimatedLogo key={`logo-${messages.length}`} size="medium" animate={true} color={isDarkMode ? '#9333ea' : '#7c3aed'} />
                </motion.div>

                {/* Text Content */}
                <div className="flex flex-col items-center px-4">
                  <motion.h2
                    className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold mb-4 text-center ${
                      isDarkMode ? 'text-purple-100' : 'text-purple-900'
                    }`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: 'easeOut', delay: 0.9 }}
                  >
                    How can I help you?
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 1.1, ease: 'easeOut' }}
                    className={`text-[12px] sm:text-base md:text-lg text-center max-w-md ${
                      isDarkMode ? 'text-purple-300/70' : 'text-purple-700/70'
                    }`}
                  >
                    Speak to your glasses
                  </motion.p>
                </div>
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
                        <div className="flex-shrink-0">
                          {isOwnMessage ? (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-semibold">
                              U
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center">
                              <Sparkles size={14} className="text-white" />
                            </div>
                          )}
                        </div>
                        <div className={`text-xs font-semibold ${
                          isDarkMode ? 'text-purple-300/90' : 'text-purple-700'
                        }`}>
                          {isOwnMessage ? 'You' : 'Mira'}
                        </div>
                      </div>

                      {/* Message Content */}
                      <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
                        {message.image && (
                          <div className="mb-2">
                            <img
                              src={message.image}
                              alt="Message context"
                              className="rounded-lg max-w-xs h-auto cursor-zoom-in hover:opacity-90 transition-opacity border border-purple-500/20"
                              style={{ maxWidth: '200px' }}
                              onClick={() => setZoomedImage(message.image!)}
                            />
                          </div>
                        )}
                        <div className={`text-sm leading-relaxed whitespace-pre-line p-3 rounded-lg inline-block max-w-lg ${
                          isDarkMode
                            ? isOwnMessage
                              ? 'text-purple-100/80 bg-purple-600/10 border border-purple-500/30'
                              : 'text-purple-100/80 bg-transparent'
                            : isOwnMessage
                              ? 'text-purple-900 bg-purple-100/50 border border-purple-300'
                              : 'text-gray-800 bg-transparent'
                        }`}>
                          {message.content}
                        </div>
                        <div className={`text-[10px] mt-1.5 ${isOwnMessage ? 'text-right' : 'text-left'} w-full ${
                          isDarkMode ? 'text-purple-400/40' : 'text-purple-600/50'
                        }`}>
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
                    className="flex flex-col gap-2"
                  >
                    {/* Avatar and Name */}
                    <div className="flex items-center gap-2">
                      <div className="flex-shrink-0">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center">
                          <Sparkles size={14} className="text-white" />
                        </div>
                      </div>
                      <div className={`text-xs font-semibold ${
                        isDarkMode ? 'text-purple-300/90' : 'text-purple-700'
                      }`}>Mira</div>
                    </div>
                    {/* Typing indicator */}
                    <div className="ml-9 flex space-x-2">
                      <div className={`w-2 h-2 rounded-full animate-bounce ${
                        isDarkMode ? 'bg-purple-400/60' : 'bg-purple-600/60'
                      }`}></div>
                      <div className={`w-2 h-2 rounded-full animate-bounce ${
                        isDarkMode ? 'bg-purple-400/60' : 'bg-purple-600/60'
                      }`} style={{ animationDelay: '0.1s' }}></div>
                      <div className={`w-2 h-2 rounded-full animate-bounce ${
                        isDarkMode ? 'bg-purple-400/60' : 'bg-purple-600/60'
                      }`} style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </motion.div>
          )}
        </div>
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
              className="absolute top-4 right-4 text-white bg-purple-600/80 hover:bg-purple-600 backdrop-blur-sm rounded-full p-3 transition-all shadow-lg z-10"
              onClick={() => {
                setZoomedImage(null);
                setImageScale(1);
                setImagePosition({ x: 0, y: 0 });
                setIsDragging(false);
              }}
            >
              <X size={20} />
            </button>
            {/* Zoom controls */}
            <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 flex gap-2">
              <button
                className="text-white bg-purple-600/80 hover:bg-purple-600 backdrop-blur-sm rounded-full p-2 transition-all shadow-lg"
                onClick={() => setImageScale(prev => Math.max(0.5, prev - 0.2))}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </button>
              <button
                className="text-white bg-purple-600/80 hover:bg-purple-600 backdrop-blur-sm rounded-full p-2 transition-all shadow-lg"
                onClick={() => {
                  setImageScale(1);
                  setImagePosition({ x: 0, y: 0 });
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </button>
              <button
                className="text-white bg-purple-600/80 hover:bg-purple-600 backdrop-blur-sm rounded-full p-2 transition-all shadow-lg"
                onClick={() => setImageScale(prev => Math.min(5, prev + 0.2))}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>z
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
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

      <style>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }

        @keyframes sparkle {
          0%, 100% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
          50% {
            transform: scale(1.1) rotate(5deg);
            opacity: 0.8;
          }
        }

        @keyframes twinkle {
          0%, 100% {
            opacity: 0.2;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.5);
          }
        }
      `}</style>
      
    </div>
  );
}

export default ChatInterface;
