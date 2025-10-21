import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Menu, X, Search, Plus, MessageSquare, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
  const [displayedText, setDisplayedText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  const fullText = 'How can I help you?';

  console.log('[ChatInterface] Component rendered. State:', {
    userId,
    recipientId,
    messageCount: messages.length,
    isProcessing,
  });

  // Animated text effect
  useEffect(() => {
    if (messages.length === 0) {
      let index = 0;
      const timer = setInterval(() => {
        if (index <= fullText.length) {
          setDisplayedText(fullText.slice(0, index));
          index++;
        } else {
          clearInterval(timer);
        }
      }, 100);

      return () => clearInterval(timer);
    }
  }, [messages.length]);

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

  // Create conversation history from messages
  const conversationHistory = messages
    .reduce((acc: { id: string; title: string; date: string }[], msg) => {
      // Group messages by date
      const dateStr = msg.timestamp.toLocaleDateString();
      const existing = acc.find(conv => conv.date === dateStr);
      if (!existing && msg.content) {
        const title = msg.content.slice(0, 30) + (msg.content.length > 30 ? '...' : '');
        const now = new Date();
        const msgDate = new Date(msg.timestamp);
        const diffHours = Math.floor((now.getTime() - msgDate.getTime()) / (1000 * 60 * 60));

        let dateLabel;
        if (diffHours < 1) dateLabel = 'Just now';
        else if (diffHours < 24) dateLabel = `${diffHours} hours ago`;
        else if (diffHours < 48) dateLabel = 'Yesterday';
        else dateLabel = dateStr;

        acc.push({
          id: msg.id,
          title,
          date: dateLabel
        });
      }
      return acc;
    }, [])
    .slice(-5); // Keep last 5 conversations

  const filteredConversations = conversationHistory.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-screen flex bg-black overflow-hidden">
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-black/95 backdrop-blur-xl border-r border-purple-500/10 transform transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:relative lg:translate-x-0 flex flex-col`}
      >
        {/* Sidebar Header */}
        <div className="p-3 border-b border-purple-500/10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-purple-200/70 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-400/60" />
              Conversations
            </h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 hover:bg-purple-500/10 rounded transition-colors"
            >
              <X className="w-4 h-4 text-purple-300/70" />
            </button>
          </div>

          {/* New Chat Button - Disabled/Under Construction */}
          <button
            disabled
            className="w-full bg-purple-600/10 text-purple-200/40 rounded-lg py-2 px-3 flex items-center justify-center gap-2 text-sm border border-purple-500/10 cursor-not-allowed relative"
            title="Under construction"
          >
            <Plus className="w-4 h-4" />
            New Chat
            <span className="absolute -top-1 -right-1 text-[10px] bg-yellow-500/20 text-yellow-300/70 px-1.5 py-0.5 rounded-full border border-yellow-500/30">
              Soon
            </span>
          </button>
        </div>

        {/* Search Bar - Disabled/Under Construction */}
        <div className="p-3 border-b border-purple-500/10">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-purple-400/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search (coming soon)..."
              disabled
              className="w-full bg-gray-900/20 border border-purple-500/10 rounded-lg py-1.5 pl-8 pr-3 text-sm text-purple-100/40 placeholder-purple-400/30 cursor-not-allowed"
            />
          </div>
        </div>

        {/* Conversation History */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredConversations.length > 0 ? (
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                className="w-full text-left p-2.5 rounded-lg hover:bg-purple-500/10 transition-all group"
              >
                <div className="flex items-start gap-2">
                  <Clock className="w-3.5 h-3.5 text-purple-400/50 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-purple-100/70 text-sm truncate group-hover:text-purple-200/90 transition-colors">
                      {conv.title}
                    </p>
                    <p className="text-purple-400/40 text-xs mt-0.5">
                      {conv.date}
                    </p>
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="text-center py-8 text-purple-400/40 text-xs">
              No conversations found
            </div>
          )}
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
      <div className="flex-1 flex flex-col bg-gradient-to-b from-black via-gray-950 to-black">
        {/* Header */}
        <header className="bg-gray-950/50 border-b border-purple-500/20 backdrop-blur-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 hover:bg-purple-500/10 rounded-lg transition-colors"
            >
              <Menu className="w-5 h-5 text-purple-300" />
            </button>
            <div className="relative">
              <Sparkles className="w-6 h-6 text-purple-400" />
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
            </div>
            <h1 className="text-xl font-semibold text-purple-100">
              Mira
            </h1>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto relative">
          {/* Stars in background - Always visible, subtle */}
          <div className="absolute inset-0 pointer-events-none">
            {[...Array(50)].map((_, i) => {
              const randomLeft = Math.random() * 100;
              const randomTop = Math.random() * 100;
              const randomDelay = Math.random() * 3;
              const randomDuration = 2 + Math.random() * 2;
              return (
                <div
                  key={i}
                  className="absolute w-0.5 h-0.5 bg-purple-300/10 rounded-full"
                  style={{
                    left: `${randomLeft}%`,
                    top: `${randomTop}%`,
                    animation: `twinkle ${randomDuration}s ease-in-out ${randomDelay}s infinite`,
                  }}
                />
              );
            })}
          </div>

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
                  <div className="w-96 h-96 bg-purple-600/10 rounded-full blur-3xl animate-pulse"></div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8, ease: 'easeInOut' }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <div className="w-64 h-64 bg-purple-500/20 rounded-full blur-2xl" style={{ animation: 'pulse 3s ease-in-out infinite' }}></div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Center Text - Fades out when messages appear */}
          <AnimatePresence>
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.5, ease: 'easeInOut' }}
                className="absolute inset-0 flex items-center justify-center px-6 z-10"
              >
                <div className="flex flex-col items-center px-4">
                  <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold mb-4 text-purple-100 text-center">
                    {displayedText}
                    <span className="animate-pulse">|</span>
                  </h2>
                  <p className="text-base sm:text-lg md:text-xl text-purple-300/70 text-center max-w-md">
                    Speak into your microphone...
                  </p>
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
                      className="flex gap-3"
                    >
                      {/* Avatar */}
                      <div className="flex-shrink-0">
                        {isOwnMessage ? (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm font-semibold">
                            U
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center">
                            <MessageSquare size={18} />
                          </div>
                        )}
                      </div>

                      {/* Message Content */}
                      <div className="flex-1 pt-1">
                        <div className="text-sm font-semibold mb-2 text-purple-300/90">
                          {isOwnMessage ? 'You' : 'Mira'}
                        </div>
                        {message.image && (
                          <img
                            src={message.image}
                            alt="Message context"
                            className="rounded-lg mb-3 max-w-xs h-auto cursor-pointer hover:opacity-90 transition-opacity border border-purple-500/20"
                            onClick={() => setZoomedImage(message.image!)}
                          />
                        )}
                        <div className="text-purple-100/80 leading-relaxed whitespace-pre-line">
                          {message.content}
                        </div>
                        <div className="text-xs text-purple-400/40 mt-2">
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
                    className="flex gap-3"
                  >
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center">
                        <MessageSquare size={18} />
                      </div>
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="text-sm font-semibold mb-2 text-purple-300/90">Mira</div>
                      <div className="flex space-x-2">
                        <div className="w-2 h-2 bg-purple-400/60 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-purple-400/60 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-purple-400/60 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
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
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-7xl max-h-full">
            <img
              src={zoomedImage}
              alt="Zoomed view"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <button
              className="absolute top-4 right-4 text-white bg-gray-800 bg-opacity-75 hover:bg-opacity-100 rounded-full p-2 transition-all"
              onClick={() => setZoomedImage(null)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
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
            opacity: 0.1;
            transform: scale(1);
          }
          50% {
            opacity: 0.3;
            transform: scale(1.2);
          }
        }
      `}</style>
    </div>
  );
}

export default ChatInterface;
