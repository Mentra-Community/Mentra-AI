import React, { useState, useEffect } from 'react';
import { Search, ChevronRight, MessageSquare, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ColorMiraLogo from '../../public/figma-parth-assets/icons/color-mira-logo.svg';

// Conversation from API
interface Conversation {
  _id: string;
  userId: string;
  date: string; // YYYY-MM-DD format - acts as the "folder"
  title: string; // e.g., "January 18, 2026"
  messages: Array<{
    id: string;
    messageNumber: number;
    role: 'user' | 'assistant';
    content: string;
    photoTimestamp?: number;
    timestamp: string;
  }>;
  hasUnread: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FolderNavProps {
  isDarkMode: boolean;
  userId: string;
  onChatSelect?: (date: string) => void;
  onNewChat?: () => void;
  onBack?: () => void;
  currentChatDate?: string;
}

export default function FolderNav({ isDarkMode, userId, onChatSelect, onBack, currentChatDate }: FolderNavProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch conversations from API
  useEffect(() => {
    const fetchConversations = async () => {
      if (!userId) return;

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/db/conversations?userId=${encodeURIComponent(userId)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch conversations');
        }
        const data = await response.json();
        setConversations(data);
      } catch (err) {
        console.error('Error fetching conversations:', err);
        setError('Failed to load conversations');
      } finally {
        setIsLoading(false);
      }
    };

    fetchConversations();
  }, [userId]);

  // Filter conversations by title or message content
  const filteredChats = conversations.filter(conversation =>
    conversation.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conversation.messages.some(msg =>
      msg.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  // Format relative time
  const getRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      className={`h-screen flex flex-col ${
        isDarkMode ? 'bg-black text-white' : 'bg-white text-gray-900'
      }`}
    >
      {/* Header with Logo */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <img src={ColorMiraLogo} alt="Mentra" className="w-8 h-8" />
          <span className="text-lg font-semibold">MentraAI</span>
        </div>
        {/* Back button - slides back to chat */}
        <button
          onClick={onBack}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
            isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
          }`}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Search Bar */}
      <div className="px-4 pb-3">
        <div
          className={`relative flex items-center rounded-xl transition-all ${
            isSearchFocused
              ? isDarkMode
                ? 'bg-white/10 ring-1 ring-white/20'
                : 'bg-black/5 ring-1 ring-black/10'
              : isDarkMode
                ? 'bg-white/5'
                : 'bg-black/5'
          }`}
        >
          <Search className={`absolute left-3 w-4 h-4 ${
            isDarkMode ? 'text-gray-500' : 'text-gray-400'
          }`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder="Search chats..."
            className={`w-full py-2.5 pl-10 pr-10 bg-transparent text-sm outline-none ${
              isDarkMode
                ? 'text-white placeholder-gray-500'
                : 'text-gray-900 placeholder-gray-400'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className={`absolute right-3 p-0.5 rounded-full transition-colors ${
                isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Your Chats Section */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-4 py-2">
          <h3 className={`text-xs font-medium uppercase tracking-wider ${
            isDarkMode ? 'text-gray-500' : 'text-gray-400'
          }`}>
            {searchQuery ? `Results (${filteredChats.length})` : 'Your chats'}
          </h3>
        </div>

        {/* Chat History List */}
        <div
          className="flex-1 overflow-y-auto px-2"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          <AnimatePresence mode="popLayout">
            {isLoading ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`text-center py-8 ${
                  isDarkMode ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                <p className="text-sm">Loading chats...</p>
              </motion.div>
            ) : error ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`text-center py-8 ${
                  isDarkMode ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{error}</p>
              </motion.div>
            ) : filteredChats.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`text-center py-8 ${
                  isDarkMode ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{searchQuery ? 'No chats found' : 'No conversations yet'}</p>
              </motion.div>
            ) : (
              filteredChats.map((conversation, index) => (
                <motion.button
                  key={conversation.date}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.02 }}
                  onClick={() => onChatSelect?.(conversation.date)}
                  className={`w-full text-left px-3 py-3 rounded-xl mb-1 transition-colors flex items-start gap-3 group ${
                    currentChatDate === conversation.date
                      ? isDarkMode
                        ? 'bg-white/10'
                        : 'bg-black/10'
                      : isDarkMode
                        ? 'hover:bg-white/5'
                        : 'hover:bg-black/5'
                  }`}
                >
                  {/* Chat Icon */}
                  <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                    isDarkMode ? 'bg-white/10' : 'bg-black/5'
                  }`}>
                    <MessageSquare className={`w-4 h-4 ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`} />
                  </div>

                  {/* Chat Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[15px] font-medium truncate ${
                        isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                        {conversation.title}
                      </span>
                      {conversation.hasUnread && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                      )}
                    </div>
                    <span className={`text-xs ${
                      isDarkMode ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      {getRelativeTime(new Date(conversation.updatedAt))}
                    </span>
                  </div>
                </motion.button>
              ))
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
