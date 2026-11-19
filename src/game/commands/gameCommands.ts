/**
 * Comandos propios del juego (no existen en Linux real):
 *   mision   → muestra la misión actual   (mision --reiniciar la vuelve a preparar)
 *   pista    → compra la siguiente pista con puntos
 *   estado   → muestra nivel, rango, XP y puntos
 *
 * Dependen de la interfaz mínima `GameActions` (Segregación de Interfaces),
 * no de la clase GameSession completa.
 */
import type { Command } from '../../engine/commands/Command';
import { C, highlightCode } from '../presentation/ansiText';
import type { PlayerView } from '../session/PlayerView';

export type HintResult =
  | { ok: true; index: number; text: string; cost: number; remainingPoints: number }
  | { ok: false; reason: 'no-points' | 'no-more' | 'no-mission'; cost?: number; points: number };

export interface GameActions {
  view(): PlayerView;
  revealHint(source: 'terminal' | 'ui'): HintResult;
  restartMission(source: 'terminal' | 'ui'): boolean;
}

/** Texto de una pista para la terminal (lo reutiliza el controlador para las pistas pedidas desde la UI). */
export function formatHint(index: number, text: string, cost: number): string {
  const labels = ['PISTA 1 · concepto', 'PISTA 2 · comando', 'PISTA 3 · solución'];
  return `${C.amber}💡 ${labels[index]}${C.reset} ${C.dim}(-${cost} pts)${C.reset}\n   ${highlightCode(text)}\n`;
}

export function formatHintRejection(result: Extract<HintResult, { ok: false }>): string {
  if (result.reason === 'no-mission') return 'No hay ninguna misión activa.\n';
  if (result.reason === 'no-more') return 'Ya tienes todas las pistas de esta misión. ¡Tú puedes!\n';
  return `Puntos insuficientes: la pista cuesta ${result.cost} y tienes ${result.points}. Completa misiones para ganar más.\n`;
}

export function createGameCommands(actions: GameActions): Command[] {
  const mission: Command = {
    name: 'mision',
    aliases: ['mission', 'objetivo'],
    category: 'juego',
    summary: 'Muestra tu misión actual (--reiniciar para volver a prepararla)',
    builtin: true,
    execute(ctx) {
      if (ctx.args[0] === '--reiniciar' || ctx.args[0] === '--reset') {
        if (!actions.restartMission('terminal')) return 1;
        ctx.stdout.write(`${C.green}Escenario de la misión restaurado.${C.reset}\n`);
        return 0;
      }
      const current = actions.view().currentMission;
      if (!current) {
        ctx.stdout.write('No hay misión activa. Has completado todo el contenido disponible.\n');
        return 0;
      }
      ctx.stdout.write(
        `${C.brightGreen}▶ ${current.title}${C.reset} ${C.dim}(Cap. ${current.chapterNumber} · ${current.missionNumber}/${current.chapterMissionCount})${C.reset}\n` +
        `  ${C.bold}Objetivo:${C.reset} ${highlightCode(current.objective)}\n`,
      );
      current.revealedHints.forEach((hint, i) => ctx.stdout.write(`  ${C.amber}Pista ${i + 1}:${C.reset} ${highlightCode(hint)}\n`));
      if (current.nextHintCost !== null) {
        ctx.stdout.write(`  ${C.dim}¿Atascado? Escribe 'pista' (cuesta ${current.nextHintCost} pts).${C.reset}\n`);
      }
      return 0;
    },
  };

  const hint: Command = {
    name: 'pista',
    aliases: ['hint'],
    category: 'juego',
    summary: 'Compra una pista para la misión actual',
    builtin: true,
    execute(ctx) {
      const result = actions.revealHint('terminal');
      if (result.ok) {
        ctx.stdout.write(formatHint(result.index, result.text, result.cost));
        return 0;
      }
      ctx.stderr.write(formatHintRejection(result));
      return 1;
    },
  };

  const status: Command = {
    name: 'estado',
    aliases: ['status'],
    category: 'juego',
    summary: 'Muestra tu nivel, rango, experiencia y puntos',
    builtin: true,
    execute(ctx) {
      const v = actions.view();
      const filled = Math.round(v.levelRatio * 20);
      ctx.stdout.write(
        `${C.brightGreen}${v.displayName}${C.reset} (${v.username}) — ${C.cyan}${v.rank}${C.reset}\n` +
        `  Nivel ${v.level}  [${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${v.xpInLevel}/${v.xpRequired} XP\n` +
        `  Puntos: ${C.amber}${v.points}${C.reset}   Misiones: ${v.completedCount}/${v.totalMissions}\n`,
      );
      return 0;
    },
  };

  return [mission, hint, status];
}
