'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';

const COLOR_PALETTE = [
  '#ff70a6', '#ff9770', '#ffd670',
  '#e9ff70', '#70d6ff', '#8338ec',
  '#3a86ff', '#00f5d4',
];

const SPLAT_COUNT = 12;

const THEME = {
  light: { bg: '#f8fafc', blendMode: 'multiply' as GlobalCompositeOperation, gradientEnd: 'rgba(255,255,255,0)' },
  dark:  { bg: '#050810', blendMode: 'screen'   as GlobalCompositeOperation, gradientEnd: 'rgba(0,0,0,0)' },
};

const VISIBLE_ROUTES = new Set(['/']);

interface SplatState {
  x: number;
  y: number;
  radius: number;
  color: string;
  vx: number;
  vy: number;
  pulseSpeed: number;
  pulseAmount: number;
}

function createSplat(width: number, height: number): SplatState {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    radius: Math.random() * 450 + 450,
    color: COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)],
    vx: (Math.random() - 0.5) * 2.2,
    vy: (Math.random() - 0.5) * 2.2,
    pulseSpeed: Math.random() * 0.016,
    pulseAmount: Math.random() * Math.PI * 2,
  };
}

function updateSplat(s: SplatState, width: number, height: number) {
  s.x += s.vx;
  s.y += s.vy;
  if (s.x < -s.radius / 2 || s.x > width + s.radius / 2) s.vx *= -1;
  if (s.y < -s.radius / 2 || s.y > height + s.radius / 2) s.vy *= -1;
  s.pulseAmount += s.pulseSpeed;
}

function drawSplat(ctx: CanvasRenderingContext2D, s: SplatState, gradientEnd: string) {
  const currentRadius = s.radius + Math.sin(s.pulseAmount) * 80;
  const gradient = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, currentRadius);
  gradient.addColorStop(0, s.color);
  gradient.addColorStop(1, gradientEnd);
  ctx.beginPath();
  ctx.fillStyle = gradient;
  ctx.arc(s.x, s.y, currentRadius, 0, Math.PI * 2);
  ctx.fill();
}

function isDarkActive() {
  return document.documentElement.classList.contains('dark');
}

export default function SplatBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pathname = usePathname();
  const visible = VISIBLE_ROUTES.has(pathname);

  const darkRef = useRef(false);
  const splatsRef = useRef<SplatState[]>([]);
  const animIdRef = useRef<number>(0);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (splatsRef.current.length === 0) {
      for (let i = 0; i < SPLAT_COUNT; i++) {
        splatsRef.current.push(createSplat(canvas.width, canvas.height));
      }
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    darkRef.current = isDarkActive();

    const observer = new MutationObserver(() => {
      darkRef.current = isDarkActive();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    function animate() {
      const w = canvas!.width;
      const h = canvas!.height;
      const t = darkRef.current ? THEME.dark : THEME.light;

      ctx!.globalCompositeOperation = 'source-over';
      ctx!.fillStyle = t.bg;
      ctx!.fillRect(0, 0, w, h);

      ctx!.globalCompositeOperation = t.blendMode;
      for (const splat of splatsRef.current) {
        updateSplat(splat, w, h);
        drawSplat(ctx!, splat, t.gradientEnd);
      }

      animIdRef.current = requestAnimationFrame(animate);
    }

    resize();
    animate();
    window.addEventListener('resize', resize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animIdRef.current);
    };
  }, [resize]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        filter: 'blur(140px)',
        transform: 'scale(1.1)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 600ms ease-in-out',
      }}
    />
  );
}
