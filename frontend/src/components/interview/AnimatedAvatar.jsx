import React, { useState, useRef, useEffect } from 'react';
import {
  Volume2,
  Mic,
  Sparkles,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle2,
  Video,
  VideoOff
} from 'lucide-react';

/**
 * Animated Interviewer Avatar Component
 * 
 * A polished, animated interviewer avatar with breathing, nodding, and speaking animations.
 * No external dependencies - pure React/CSS animations.
 * 
 * Features:
 * - Breathing animation (subtle vertical movement)
 * - Attentive nodding when listening
 * - Speaking animation with waveform bars
 * - Processing state indicator
 * - Connection status badge (always shows "Animated Avatar")
 * - Audio mute toggle
 */
export const AnimatedAvatar = ({
  isSpeaking,
  agentState,
  isAudioMuted = false,
  onToggleMute,
  className = ''
}) => {
  const [tick, setTick] = useState(0);
  const [nodOffset, setNodOffset] = useState(0);
  const [pulsePhase, setPulsePhase] = useState(0);

  const isListening = agentState === 'LISTENING';
  const isProcessing = agentState === 'PROCESSING';
  const isSpeakingState = isSpeaking || agentState === 'SPEAKING';

  // Animation loop for breathing
  useEffect(() => {
    let animId;
    const loop = () => {
      setTick((t) => t + 1);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Nodding animation when listening
  useEffect(() => {
    let nodTimer;
    if (isListening) {
      const scheduleNod = () => {
        nodTimer = setTimeout(() => {
          setNodOffset(3.5);
          setTimeout(() => setNodOffset(0), 450);
          scheduleNod();
        }, 3000 + Math.random() * 2500);
      };
      scheduleNod();
    } else {
      setNodOffset(0);
    }
    return () => clearTimeout(nodTimer);
  }, [isListening]);

  // Speaking pulse animation
  useEffect(() => {
    let pulseTimer;
    if (isSpeakingState) {
      const schedulePulse = () => {
        pulseTimer = setTimeout(() => {
          setPulsePhase((p) => (p + 1) % 3);
          schedulePulse();
        }, 400);
      };
      schedulePulse();
    } else {
      setPulsePhase(0);
    }
    return () => clearTimeout(pulseTimer);
  }, [isSpeakingState]);

  const breatheY = Math.sin(tick * 0.035) * 1.2;
  const breatheScale = 1 + Math.sin(tick * 0.035) * 0.003;
  const listeningScale = isListening ? 1.02 : 1.0;
  const listeningTilt = isListening ? 1.0 : 0;
  const listeningNodY = isListening ? Math.sin(tick * 0.06) * 1.2 : 0;
  const speakingPulse = isSpeakingState ? Math.sin(tick * 0.15) * 0.008 : 0;

  // Dynamic waveform bars for speaking state
  const waveformBars = isSpeakingState
    ? [3, 7, 5, 8, 4, 6, 7, 3, 5, 8, 4, 6].map((h, i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-brand-400 transition-all duration-100"
          style={{
            height: `${Math.max(4, (h * 2.5 + pulsePhase * 2) % 24)}px`,
            animationDelay: `${i * 50}ms`,
          }}
        />
      ))
    : [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map((_, i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-slate-600"
          style={{ height: '4px', animationDelay: `${i * 50}ms` }}
        />
      ));

  return (
    <div
      className={`relative w-full h-full min-h-0 bg-slate-950 flex items-center justify-center overflow-hidden rounded-xl sm:rounded-2xl select-none ${className}`}
    >
      {/* Subtle ambient background gradients based on state */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/40 pointer-events-none z-10" />
      
      {isListening && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-500/15 via-transparent to-transparent pointer-events-none z-10 animate-pulse" />
      )}
      {isSpeakingState && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-500/15 via-transparent to-transparent pointer-events-none z-10" />
      )}
      {isProcessing && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-amber-500/15 via-transparent to-transparent pointer-events-none z-10 animate-pulse" />
      )}

      {/* Neutral AI avatar (no photo) with breathing / nod animations */}
      <div
        className="relative z-10 flex items-center justify-center transition-transform duration-200 ease-out"
        style={{
          transform: `translateY(${breatheY + listeningNodY + nodOffset}px) scale(${breatheScale * listeningScale * (1 + speakingPulse)}) rotate(${listeningTilt}deg)`,
        }}
      >
        <div
          className={`relative w-28 h-28 sm:w-36 sm:h-36 rounded-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 ring-4 transition-all duration-300 select-none ${
            isSpeakingState
              ? 'ring-cyan-400/80'
              : isListening
                ? 'ring-emerald-400/70'
                : isProcessing
                  ? 'ring-amber-400/70'
                  : 'ring-white/10'
          }`}
        >
          <span className="text-slate-100 font-bold text-3xl sm:text-4xl tracking-wide font-sans">AI</span>
          {isSpeakingState && (
            <span className="absolute inset-0 rounded-full ring-4 ring-cyan-400/40 animate-ping pointer-events-none" />
          )}
        </div>
      </div>

      {/* Scanline overlay for CRT/monitor feel */}
      <div
        className="absolute inset-0 pointer-events-none z-15 opacity-[0.02]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px)',
          backgroundSize: '100% 3px',
        }}
      />

      {/* Speaking waveform indicator (bottom center) */}
      {isSpeakingState && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-cyan-400/30 animate-pulse">
          <div className="flex items-end gap-[2px] h-5">{waveformBars}</div>
          <span className="text-xs font-bold text-cyan-300 font-mono whitespace-nowrap">Speaking</span>
        </div>
      )}

      {/* Listening indicator (bottom center) */}
      {isListening && !isSpeakingState && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-emerald-400/30">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold text-emerald-300 font-mono whitespace-nowrap">Listening</span>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-amber-400/30">
          <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs font-bold text-amber-300 font-mono whitespace-nowrap">Evaluating</span>
        </div>
      )}

      {/* Top Status Badges */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2">
        {/* Avatar Mode Badge - Always Animated */}
        {isSpeakingState && (
          <span className="flex items-center gap-1 rounded-full bg-cyan-950/80 border border-cyan-400/60 text-cyan-300 px-2 py-0.5 text-[9px] font-bold animate-pulse backdrop-blur-md">
            <Volume2 className="w-3 h-3" />
            Speaking
          </span>
        )}

        {isListening && !isSpeakingState && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-950/80 border border-emerald-400/60 text-emerald-300 px-2 py-0.5 text-[9px] font-bold backdrop-blur-md">
            <Mic className="w-3 h-3" />
            Listening
          </span>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5">
        {/* Mute Toggle */}
        <button
          type="button"
          onClick={onToggleMute}
          className={`p-2 rounded-lg transition-all backdrop-blur-md ${
            isAudioMuted
              ? 'bg-rose-950/80 border border-rose-500/40 text-rose-300'
              : 'bg-slate-900/80 border border-slate-700/60 text-slate-300 hover:bg-slate-800/80 hover:border-slate-600/60'
          }`}
          title={isAudioMuted ? 'Unmute Interviewer' : 'Mute Interviewer'}
          aria-label={isAudioMuted ? 'Unmute Interviewer' : 'Mute Interviewer'}
        >
          {isAudioMuted ? (
            <Volume2 className="w-4 h-4" style={{ strokeLinecap: 'round' }} />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>

        {/* Connection Status (always "Animated" - no WebRTC) */}
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 px-2.5 py-1 text-[10px] font-mono font-bold shadow-lg backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Local Animation Active
        </span>
      </div>

      {/* Ambient Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none z-15" />
    </div>
  );
};

export default AnimatedAvatar;