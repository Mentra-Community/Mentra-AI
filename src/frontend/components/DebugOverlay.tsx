import { useState, useEffect, useRef, useCallback } from 'react';
import { useMentraAuth } from '@mentra/react';
import { withAuthSseUrl } from '../lib/authFetch';

interface TranscriptionEntry {
  id: number;
  text: string;
  isFinal: boolean;
  timestamp: string;
}

interface DebugOverlayProps {
  onClose: () => void;
}

export function DebugOverlay({ onClose }: DebugOverlayProps) {
  const { frontendToken } = useMentraAuth();
  const [entries, setEntries] = useState<TranscriptionEntry[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idCounterRef = useRef(0);
  const listEndRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [position, setPosition] = useState({ x: 16, y: window.innerHeight - 320 });
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  // SSE connection
  useEffect(() => {
    const connect = () => {
      const es = new EventSource(
        withAuthSseUrl('/api/transcription-stream', frontendToken),
      );
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') return;

          const entry: TranscriptionEntry = {
            id: idCounterRef.current++,
            text: data.text,
            isFinal: data.isFinal ?? false,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          };

          setEntries(prev => {
            // If partial (not final), replace the last partial entry
            if (!entry.isFinal) {
              if (prev.length > 0 && !prev[prev.length - 1].isFinal) {
                const updated = [...prev];
                updated[updated.length - 1] = entry;
                return updated;
              }
              return [...prev, entry];
            }
            // If final, replace the last partial or append
            if (prev.length > 0 && !prev[prev.length - 1].isFinal) {
              const updated = [...prev];
              updated[updated.length - 1] = entry;
              return updated;
            }
            return [...prev, entry];
          });
        } catch {}
      };

      es.onerror = () => {
        es.close();
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      eventSourceRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [frontendToken]);

  // Touch drag handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    dragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
  }, [position]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const dx = touch.clientX - dragRef.current.startX;
    const dy = touch.clientY - dragRef.current.startY;

    // Clamp to viewport
    const maxX = window.innerWidth - (panelRef.current?.offsetWidth ?? 200);
    const maxY = window.innerHeight - (panelRef.current?.offsetHeight ?? 200);
    setPosition({
      x: Math.max(0, Math.min(dragRef.current.startPosX + dx, maxX)),
      y: Math.max(0, Math.min(dragRef.current.startPosY + dy, maxY)),
    });
  }, []);

  const handleTouchEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div
      ref={panelRef}
      style={{ left: position.x, top: position.y }}
      className="fixed z-[60] w-[280px] max-h-[240px] flex flex-col rounded-xl bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl overflow-hidden"
    >
      {/* Drag handle + close */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[10px]">🎤</span>
          <span className="text-[10px] text-white/50 font-medium uppercase tracking-wider">Debug</span>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 active:text-white/80 text-[14px] px-1"
        >
          ✕
        </button>
      </div>

      {/* Transcription list */}
      <div
        className="flex-1 overflow-y-auto px-2 py-1.5"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {entries.length === 0 && (
          <p className="text-[11px] text-white/30 text-center py-2">Listening...</p>
        )}
        {entries.map(entry => (
          <div key={entry.id} className="flex gap-1.5 py-0.5">
            <span className="text-[9px] text-white/25 font-mono flex-shrink-0 mt-[2px]">
              {entry.timestamp}
            </span>
            <span
              className={`text-[11px] font-mono break-all ${
                entry.isFinal ? 'text-green-400' : 'text-white/60'
              }`}
            >
              {entry.text}
            </span>
          </div>
        ))}
        <div ref={listEndRef} />
      </div>
    </div>
  );
}
