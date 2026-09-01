import React, { useEffect, useRef } from 'react';
import { AssistantStatus } from '../store';
import { useAudioAnalyser } from '../hooks/useAudioAnalyser';

interface VoiceOrbProps {
  status: AssistantStatus;
  size?: number; // width/height in px
}

export default function VoiceOrb({ status, size = 180 }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isListening = status === 'LISTENING';
  const audioLevel = useAudioAnalyser(isListening);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrameId: number;
    let tick = 0;

    const render = () => {
      tick += 0.04;
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = size * 0.28;

      // Color scheme derived from CSS theme variables or fallback
      const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#06b6d4';
      const secondaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-secondary').trim() || '#3b82f6';
      const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#22d3ee';

      // ── Outer Ring ──
      let ringScale = 1;
      let ringAlpha = 0.4;
      if (status === 'LISTENING') {
        ringScale = 1 + audioLevel * 0.6; // Scale with real mic amplitude!
        ringAlpha = 0.5 + audioLevel * 0.5;
      } else if (status === 'THINKING') {
        ringScale = 1 + Math.sin(tick * 3) * 0.15;
      } else if (status === 'SPEAKING') {
        ringScale = 1 + Math.sin(tick * 4) * 0.2;
      } else if (status === 'ERROR') {
        ringScale = 1 + (Math.random() - 0.5) * 0.1;
      } else {
        ringScale = 1 + Math.sin(tick) * 0.05; // IDLE
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.35 * ringScale, 0, Math.PI * 2);
      ctx.strokeStyle = status === 'ERROR' ? '#f43f5e' : status === 'LISTENING' ? '#10b981' : primaryColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = ringAlpha;
      ctx.setLineDash(status === 'THINKING' ? [6, 6] : []);
      ctx.stroke();
      ctx.restore();

      // ── Orbiting Particles ──
      const particleCount = status === 'THINKING' ? 12 : 6;
      for (let i = 0; i < particleCount; i++) {
        const angle = tick * (status === 'THINKING' ? 2 : 1) + (i * Math.PI * 2) / particleCount;
        const dist = baseRadius * (1.1 + (status === 'LISTENING' ? audioLevel * 0.4 : 0.1));
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;

        ctx.beginPath();
        ctx.arc(px, py, status === 'LISTENING' ? 3 + audioLevel * 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = status === 'ERROR' ? '#f43f5e' : status === 'LISTENING' ? '#34d399' : accentColor;
        ctx.fill();
      }

      // ── Core Glowing Sphere ──
      const coreGradient = ctx.createRadialGradient(cx, cy, 2, cx, cy, baseRadius * ringScale);
      if (status === 'ERROR') {
        coreGradient.addColorStop(0, '#fda4af');
        coreGradient.addColorStop(0.5, '#f43f5e');
        coreGradient.addColorStop(1, 'rgba(225, 29, 72, 0)');
      } else if (status === 'LISTENING') {
        coreGradient.addColorStop(0, '#a7f3d0');
        coreGradient.addColorStop(0.5, '#10b981');
        coreGradient.addColorStop(1, 'rgba(5, 150, 105, 0)');
      } else if (status === 'SPEAKING') {
        coreGradient.addColorStop(0, '#c084fc');
        coreGradient.addColorStop(0.5, primaryColor);
        coreGradient.addColorStop(1, 'rgba(6, 182, 212, 0)');
      } else {
        coreGradient.addColorStop(0, accentColor);
        coreGradient.addColorStop(0.5, primaryColor);
        coreGradient.addColorStop(1, 'rgba(3, 7, 18, 0)');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * ringScale, 0, Math.PI * 2);
      ctx.fillStyle = coreGradient;
      ctx.fill();

      // Inner Core Highlight
      ctx.beginPath();
      ctx.arc(cx - baseRadius * 0.2, cy - baseRadius * 0.2, baseRadius * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fill();

      animFrameId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animFrameId);
  }, [status, audioLevel, size]);

  return (
    <div className="relative flex flex-col items-center justify-center select-none">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="drop-shadow-[0_0_20px_var(--color-primary-glow)] transition-all duration-300"
      />
      <div className="mt-1 font-mono text-[11px] font-bold tracking-widest uppercase flex items-center space-x-1.5">
        <span className={`w-2 h-2 rounded-full ${
          status === 'LISTENING' ? 'bg-emerald-400 animate-ping' :
          status === 'TRANSCRIBING' ? 'bg-amber-400 animate-pulse' :
          status === 'THINKING' ? 'bg-cyan-400 animate-spin' :
          status === 'EXECUTING' ? 'bg-blue-400 animate-bounce' :
          status === 'SPEAKING' ? 'bg-purple-400 animate-bounce' :
          status === 'ERROR' ? 'bg-rose-500 animate-ping' : 'bg-theme-muted'
        }`} />
        <span className={
          status === 'LISTENING' ? 'text-emerald-400' :
          status === 'TRANSCRIBING' ? 'text-amber-300' :
          status === 'THINKING' ? 'text-theme-accent' :
          status === 'EXECUTING' ? 'text-blue-300' :
          status === 'SPEAKING' ? 'text-purple-300' :
          status === 'ERROR' ? 'text-rose-400' : 'text-theme-muted'
        }>
          {status}
          {status === 'LISTENING' && ` (${Math.round(audioLevel * 100)}% VOL)`}
        </span>
      </div>
    </div>
  );
}
