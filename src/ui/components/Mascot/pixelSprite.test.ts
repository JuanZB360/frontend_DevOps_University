import { describe, expect, it } from 'vitest';
import { BASE_SPRITE, EYES, paintSprite, SPRITE_HEIGHT, SPRITE_WIDTH, toRuns } from './pixelSprite';

const MOODS = ['idle', 'talking', 'happy', 'excited', 'thinking', 'worried'] as const;

describe('sprite arcade de N0X', () => {
  it('tiene dimensiones regulares en todos los fotogramas', () => {
    expect(BASE_SPRITE).toHaveLength(SPRITE_HEIGHT);
    for (const mood of MOODS) {
      for (let frame = 0; frame < 10; frame++) {
        const painted = paintSprite(mood, frame, 0);
        expect(painted).toHaveLength(SPRITE_HEIGHT);
        painted.forEach((row, y) => expect(row.length, `${mood} f${frame} fila ${y}`).toBe(SPRITE_WIDTH));
      }
    }
  });

  it('pinta los ojos solo sobre el rostro en sombra', () => {
    for (const mood of MOODS) {
      for (const look of [-1, 0, 1] as const) {
        paintSprite(mood, 1, look).forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            if ('EWY'.includes(row[x])) expect(BASE_SPRITE[y][x], `${mood} (${x},${y})`).toBe('F');
          }
        });
      }
    }
  });

  it('parpadea periódicamente en reposo', () => {
    expect(paintSprite('idle', 0, 0)[EYES.y]).toContain('W');
    expect(paintSprite('idle', 9, 0)[EYES.y]).not.toContain('W');
  });

  it('marcha en el sitio al hablar (alterna la pose de las piernas)', () => {
    const legs = (frame: number): string => paintSprite('talking', frame, 0).slice(16).join('\n');
    expect(legs(0)).not.toBe(legs(1));
  });

  it('alterna las piernas al caminar, aunque esté en reposo', () => {
    const legs = (frame: number): string => paintSprite('idle', frame, 0, true).slice(16).join('\n');
    expect(legs(0)).not.toBe(legs(1));
    expect(paintSprite('idle', 0, 0, false).slice(16)).toEqual(paintSprite('idle', 1, 0, false).slice(16));
  });

  it('agrupa píxeles contiguos en tramos', () => {
    expect(toRuns(['.KKL.'])).toEqual([
      { x: 1, y: 0, width: 2, code: 'K' },
      { x: 3, y: 0, width: 1, code: 'L' },
    ]);
  });
});
