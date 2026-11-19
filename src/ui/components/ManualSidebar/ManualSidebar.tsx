/**
 * Manual lateral desplegable.
 * Solo se pueden leer los comandos desbloqueados; el resto aparece cifrado
 * para despertar la curiosidad.
 */
import { useMemo, useState } from 'react';
import type { CommandDoc } from '../../../game/manual/CommandDoc';
import styles from './ManualSidebar.module.css';

interface Props {
  docs: readonly CommandDoc[];
  unlocked: readonly string[];
  /** Comandos desbloqueados recientemente (se marcan como NUEVO). */
  recentlyUnlocked: readonly string[];
  open: boolean;
  onClose: () => void;
}

/** Resalta `código` dentro de los textos del manual. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/** Texto ilegible del mismo largo que el nombre real. */
function scramble(length: number): string {
  const glyphs = '▓▒░█▚▞';
  return Array.from({ length: Math.max(3, length) }, (_, i) => glyphs[(i * 7 + length) % glyphs.length]).join('');
}

export function ManualSidebar({ docs, unlocked, recentlyUnlocked, open, onClose }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const unlockedSet = useMemo(() => new Set(unlocked), [unlocked]);

  // Desbloqueados primero (en orden de desbloqueo), luego los cifrados.
  const ordered = useMemo(() => {
    const available = unlocked.map((name) => docs.find((d) => d.name === name)).filter((d): d is CommandDoc => !!d);
    const locked = docs.filter((d) => !unlockedSet.has(d.name));
    return { available, locked };
  }, [docs, unlocked, unlockedSet]);

  const filtered = ordered.available.filter((d) => {
    const q = query.trim().toLowerCase();
    return !q || d.name.includes(q) || d.summary.toLowerCase().includes(q);
  });

  return (
    <aside className={`${styles.sidebar} ${open ? styles.open : ''}`} aria-label="Manual de comandos" aria-hidden={!open}>
      <header className={styles.header}>
        <h2 className={styles.title}>MANUAL</h2>
        <span className={styles.counter}>{ordered.available.length}/{docs.length}</span>
        <button type="button" className={`btn btn--ghost ${styles.close}`} onClick={onClose} aria-label="Cerrar manual">✕</button>
      </header>

      <input
        className={styles.search}
        type="search"
        placeholder="grep comando..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar en el manual"
      />

      <ul className={styles.list}>
        {filtered.map((doc) => {
          const isOpen = expanded === doc.name;
          return (
            <li key={doc.name} className={styles.item}>
              <button
                type="button"
                className={`${styles.entry} ${isOpen ? styles.entryOpen : ''}`}
                onClick={() => setExpanded(isOpen ? null : doc.name)}
                aria-expanded={isOpen}
              >
                <span className={styles.arrow}>{isOpen ? '▾' : '▸'}</span>
                <span className={styles.cmd}>{doc.name}</span>
                {recentlyUnlocked.includes(doc.name) && <span className={styles.badge}>NUEVO</span>}
                <span className={styles.summary}>{doc.summary}</span>
              </button>

              {isOpen && (
                <div className={styles.details}>
                  <pre className={styles.synopsis}>{doc.synopsis}</pre>
                  {doc.description.map((p, i) => (
                    <p key={i}><RichText text={p} /></p>
                  ))}
                  {doc.options && doc.options.length > 0 && (
                    <>
                      <h3>Opciones</h3>
                      <dl className={styles.options}>
                        {doc.options.map((o) => (
                          <div key={o.flag}>
                            <dt>{o.flag}</dt>
                            <dd>{o.description}</dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  )}
                  <h3>Ejemplos</h3>
                  <ul className={styles.examples}>
                    {doc.examples.map((e) => (
                      <li key={e.command}>
                        <code>$ {e.command}</code>
                        <span>{e.explanation}</span>
                      </li>
                    ))}
                  </ul>
                  {doc.tip && (
                    <p className={styles.tip}>
                      <strong>N0X:</strong> <RichText text={doc.tip} />
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}

        {!query && ordered.locked.map((doc) => (
          <li key={doc.name} className={`${styles.item} ${styles.locked}`} title="Desbloquéalo avanzando en las misiones">
            <span className={styles.entry}>
              <span className={styles.arrow}>🔒</span>
              <span className={styles.cmd}>{scramble(doc.name.length)}</span>
              <span className={styles.summary}>[ENCRIPTADO]</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
