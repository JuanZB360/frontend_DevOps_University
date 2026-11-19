/**
 * Componente raíz: decide entre la pantalla de acceso y la de juego, y
 * gestiona la sesión (entrar, crear cuenta, salir) y las acciones de partida
 * (exportar, importar, reiniciar).
 *
 * La partida vive en la base de datos del backend; en el navegador solo se
 * guarda el token de sesión (ver auth/tokenStore.ts).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../auth/apiClient';
import { authApi, type AuthResponse } from '../auth/authApi';
import { tokenStore } from '../auth/tokenStore';
import { parseSave } from '../game/storage/LocalStorageSaveRepository';
import { MatrixRain } from '../ui/components/MatrixRain/MatrixRain';
import { LoginScreen, type AuthMode } from '../ui/screens/LoginScreen';
import { useTheme } from '../ui/theme/themeStore';
import { describeError, freshSave, openGame, replaceGame, type ActiveGame } from './accountSession';

// La pantalla de juego (con xterm.js) se descarga solo cuando hace falta.
const GameScreen = lazy(() => import('../ui/screens/GameScreen').then((m) => ({ default: m.GameScreen })));

const SESSION_LOST_NOTICE = 'Tu sesión se cerró. Vuelve a entrar: tu progreso está guardado en el servidor.';

function downloadJson(filename: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [game, setGame] = useState<ActiveGame | null>(null);
  // Si hay un token guardado, primero se comprueba con el servidor.
  const [restoring, setRestoring] = useState(() => tokenStore.load() !== null);
  const [notice, setNotice] = useState<string | null>(null);
  // Cambia con cada partida nueva para montar de cero la pantalla de juego.
  const [gameKey, setGameKey] = useState(0);
  const theme = useTheme();
  // Copia de `game` para los callbacks estables (que no deben recrearse en cada partida).
  const gameRef = useRef<ActiveGame | null>(null);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  /** La sesión dejó de ser válida (token borrado, caducado o cerrado en otra pestaña). */
  const sessionLost = useCallback(() => {
    gameRef.current?.repository.close();
    setGame(null);
    setNotice(SESSION_LOST_NOTICE);
  }, []);

  const start = useCallback((token: string, auth: Pick<AuthResponse, 'player'>) => {
    setGame(openGame(token, auth.player, sessionLost));
    setGameKey((k) => k + 1);
    setNotice(null);
  }, [sessionLost]);

  // Al abrir la app: ¿sigue viva la sesión guardada? Si sí, se carga la partida del servidor.
  useEffect(() => {
    const stored = tokenStore.load();
    if (!stored) return;
    let cancelled = false;
    authApi.me(stored.token)
      .then((player) => {
        if (!cancelled) start(stored.token, { player });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          tokenStore.clear();
          setNotice('Tu sesión caducó. Inicia sesión de nuevo.');
        } else {
          setNotice(describeError(error));
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start]);

  // Vigila la sesión mientras se juega: borrada en DevTools, logout en otra pestaña…
  // y al cerrar la pestaña manda lo último que quede por guardar.
  useEffect(() => {
    if (!game) return;
    const check = (): void => {
      if (tokenStore.currentToken() !== game.token) sessionLost();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') check();
    };
    const onPageHide = (): void => game.repository.flushOnUnload();
    window.addEventListener('storage', check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('storage', check);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [game, sessionLost]);

  const authenticate = useCallback(async (mode: AuthMode, username: string, password: string): Promise<string | null> => {
    try {
      const auth = mode === 'login'
        ? await authApi.login(username, password)
        : await authApi.register(username, password);
      tokenStore.save({ token: auth.token, username: auth.player.username });
      start(auth.token, auth);
      return null;
    } catch (error) {
      return describeError(error);
    }
  }, [start]);

  const logout = useCallback(async () => {
    const current = gameRef.current;
    if (!current) return;
    current.session.persist();
    const saved = await current.repository.flush();
    if (!saved && !window.confirm('No se pudo guardar tu último progreso en el servidor. ¿Cerrar sesión de todos modos?')) return;
    current.repository.close();
    await authApi.logout(current.token).catch(() => undefined); // si falla, la sesión caduca sola
    tokenStore.clear();
    setGame(null);
    setNotice('Sesión cerrada. ¡Hasta pronto!');
  }, []);

  const importSave = useCallback(async (file: File) => {
    const current = gameRef.current;
    if (!current) return;
    try {
      const save = parseSave(await file.text());
      if (save.player.username !== current.username) {
        window.alert(`Esa partida es del usuario "${save.player.username}" y tu sesión es de "${current.username}". Inicia sesión con esa cuenta para importarla.`);
        return;
      }
      if (!window.confirm('¿Reemplazar tu partida actual por la del archivo? Se guardará en el servidor.')) return;
      setGame(replaceGame(current, save, false));
      setGameKey((k) => k + 1);
    } catch {
      window.alert('No se pudo importar: el archivo no es una partida válida.');
    }
  }, []);

  const exportSave = useCallback(() => {
    const current = gameRef.current;
    if (!current) return;
    downloadJson(
      `devops-university-${current.username}-${new Date().toISOString().slice(0, 10)}.json`,
      current.session.exportSave(),
    );
  }, []);

  /** Reiniciar partida: empieza de cero con la MISMA cuenta (no cierra la sesión). */
  const reset = useCallback(() => {
    const current = gameRef.current;
    if (!current) return;
    const ok = window.confirm('⚠ Esto borrará TODO tu progreso (nivel, puntos y servidor) y empezarás desde cero con tu misma cuenta. Te recomendamos exportarlo antes. ¿Continuar?');
    if (!ok) return;
    setGame(replaceGame(current, freshSave(current.username), true));
    setGameKey((k) => k + 1);
  }, []);

  return (
    <>
      {theme === 'matrix' && <MatrixRain intensity={game ? 0.18 : 0.4} />}
      {game ? (
        <Suspense fallback={null}>
          <GameScreen
            key={gameKey}
            game={game.session}
            syncStatus={game.repository}
            isNewPlayer={game.isNewPlayer}
            onExport={exportSave}
            onImport={(file) => void importSave(file)}
            onReset={reset}
            onLogout={() => void logout()}
          />
        </Suspense>
      ) : (
        <LoginScreen onSubmit={authenticate} notice={notice} restoring={restoring} />
      )}
    </>
  );
}
