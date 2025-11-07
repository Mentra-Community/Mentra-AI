import React from 'react';
import { X, Search, Plus, MessageSquare } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

function Sidebar({ isOpen, onClose, isDarkMode, searchQuery, onSearchChange }: SidebarProps): React.JSX.Element {
  return (
    <div
      className={`fixed inset-y-0 left-0 z-50 w-72 backdrop-blur-xl border-r transform transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
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
            onClick={onClose}
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
            onChange={(e) => onSearchChange(e.target.value)}
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
  );
}

export default Sidebar;
