/**
 * Lluvia de código binario (0 y 1) estilo Matrix sobre un <canvas> de fondo.
 *
 * Rendimiento: ~20 fps, se pausa cuando la pestaña no está visible y respeta
 * `prefers-reduced-motion` (en ese caso dibuja un único fotograma estático).
 */
import { useEffect, useRef } from 'react';
import styles from './MatrixRain.module.css';

/** Solo binario: el idioma nativo de la máquina. */
const GLYPHS = '01';
const FONT_SIZE = 16;
const FRAME_MS = 50;

interface Props {
  /** Opacidad del efecto (0-1). */
  intensity?: number;
}

export function MatrixRain({ intensity = 0.35 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let drops: number[] = [];
    let timer: ReturnType<typeof setInterval> | null = null;

    const resize = (): void => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const columns = Math.ceil(canvas.width / FONT_SIZE);
      drops = Array.from({ length: columns }, () => Math.floor((Math.random() * canvas.height) / FONT_SIZE));
    };

    const draw = (): void => {
      // Un rectángulo negro semitransparente crea la estela.
      ctx.fillStyle = 'rgba(0, 4, 0, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${FONT_SIZE}px monospace`;

      drops.forEach((y, i) => {
        const char = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        // La "cabeza" de cada columna brilla más.
        ctx.fillStyle = Math.random() > 0.975 ? '#d8ffe6' : '#00ff66';
        ctx.fillText(char, i * FONT_SIZE, y * FONT_SIZE);
        drops[i] = y * FONT_SIZE > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
      });
    };

    const start = (): void => {
      if (!timer && !reducedMotion) timer = setInterval(draw, FRAME_MS);
    };
    const stop = (): void => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = (): void => (document.hidden ? stop() : start());

    resize();
    if (reducedMotion) for (let i = 0; i < 60; i++) draw();
    start();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} style={{ opacity: intensity }} aria-hidden="true" />;
}
