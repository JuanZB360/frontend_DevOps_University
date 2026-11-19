/**
 * Pantalla de acceso: iniciar sesión o crear una cuenta (usuario + contraseña).
 *
 * Solo se ocupa del formulario y de validar antes de enviar. Quién llama al
 * servidor y qué pasa después lo decide App (a través de `onSubmit`).
 */
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN, USERNAME_MAX, normalizeUsername, validatePassword, validateUsername } from '../../auth/credentials';
import { sounds } from '../audio/SoundEngine';
import { MascotFigure } from '../components/Mascot/MascotFigure';
import { THEME_LABELS, toggleTheme, useTheme } from '../theme/themeStore';
import styles from './LoginScreen.module.css';

export type AuthMode = 'login' | 'register';

interface Props {
  /** Envía las credenciales. Devuelve el mensaje de error, o null si todo fue bien. */
  onSubmit: (mode: AuthMode, username: string, password: string) => Promise<string | null>;
  /** Aviso a mostrar al llegar (sesión cerrada, servidor caído…). */
  notice: string | null;
  /** Comprobando una sesión guardada: el formulario espera. */
  restoring: boolean;
}

const COPY: Record<AuthMode, { prompt: string; button: string; intro: string }> = {
  login: {
    prompt: 'root@devops-u:~# login',
    button: 'Iniciar sesión',
    intro: 'Has vuelto. Tu servidor te está esperando tal como lo dejaste. Identifícate.',
  },
  register: {
    prompt: 'root@devops-u:~# useradd -m',
    button: 'Crear cuenta',
    intro: 'Aquí no hay vídeos ni diapositivas: solo una terminal y misiones. Elige tu usuario.',
  },
};

export function LoginScreen({ onSubmit, notice, restoring }: Props) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const theme = useTheme();
  const copy = COPY[mode];
  const disabled = busy || restoring;

  const switchMode = (next: AuthMode): void => {
    setMode(next);
    setError(null);
    setConfirm('');
  };

  /** Validación local (en el registro) antes de molestar al servidor. */
  const validate = (): string | null => {
    if (!username.trim() || !password) return 'Escribe tu usuario y tu contraseña.';
    if (mode === 'login') return null;
    return validateUsername(username) ?? validatePassword(password)
      ?? (password !== confirm ? 'Las contraseñas no coinciden.' : null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (disabled) return;
    sounds.unlock();
    const problem = validate();
    if (problem) {
      sounds.play('denied');
      setError(problem);
      return;
    }
    setBusy(true);
    const failure = await onSubmit(mode, normalizeUsername(username), password);
    setBusy(false);
    if (failure) {
      sounds.play('denied');
      setError(failure);
      return;
    }
    sounds.play('boot');
  };

  const usernameHelp = mode === 'register'
    ? username.trim() && !validateUsername(username)
      ? `Tu usuario en el servidor será: ${normalizeUsername(username)}`
      : `Entre 3 y ${USERNAME_MAX} caracteres: minúsculas, números, - y _`
    : null;
  const message = error ?? (restoring ? 'Restaurando tu sesión…' : notice);
  const mascotSize = typeof window !== 'undefined' && window.innerWidth < 480 ? 76 : typeof window !== 'undefined' && window.innerWidth < 768 ? 96 : 120;

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.avatar}>
          <MascotFigure mood={error ? 'worried' : busy || restoring ? 'thinking' : username ? 'talking' : 'idle'} size={mascotSize} />
        </div>

        <h1 className={styles.title} data-text="DEVOPS UNIVERSITY">DEVOPS UNIVERSITY</h1>
        <p className={styles.subtitle}>Linux · Nginx · Docker · Git · CI/CD</p>

        <p className={styles.intro}>
          <span className={styles.n0x}>N0X:</span> {copy.intro}
        </p>

        <div className={styles.tabs} role="tablist" aria-label="Acceso">
          {(['login', 'register'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={mode === tab}
              className={mode === tab ? styles.tabActive : styles.tab}
              onClick={() => switchMode(tab)}
              disabled={disabled}
            >
              {tab === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
            </button>
          ))}
        </div>

        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
          <span className={styles.prompt}>{copy.prompt}</span>

          <label className={styles.field} htmlFor="auth-username">Usuario</label>
          <div className={styles.inputRow}>
            <span className={styles.chevron} aria-hidden="true">&gt;</span>
            <input
              id="auth-username"
              className={styles.input}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              placeholder="usuario"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={USERNAME_MAX + 4}
              autoFocus
              disabled={disabled}
              aria-describedby={usernameHelp ? 'username-help' : undefined}
            />
          </div>
          {usernameHelp && <p id="username-help" className={styles.help}>{usernameHelp}</p>}

          <label className={styles.field} htmlFor="auth-password">Contraseña</label>
          <div className={styles.inputRow}>
            <span className={styles.chevron} aria-hidden="true">&gt;</span>
            <input
              id="auth-password"
              className={styles.input}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              disabled={disabled}
            />
            <button
              type="button"
              className={styles.reveal}
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={showPassword}
            >
              {showPassword ? 'ocultar' : 'ver'}
            </button>
          </div>

          {mode === 'register' && (
            <>
              <label className={styles.field} htmlFor="auth-confirm">Repite la contraseña</label>
              <div className={styles.inputRow}>
                <span className={styles.chevron} aria-hidden="true">&gt;</span>
                <input
                  id="auth-confirm"
                  className={styles.input}
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setError(null);
                  }}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={disabled}
                />
              </div>
              <p className={styles.help}>Mínimo {PASSWORD_MIN} caracteres, con letras y números.</p>
            </>
          )}

          <p className={error ? styles.error : styles.help} role={error ? 'alert' : 'status'}>
            {message ?? ' '}
          </p>

          <button type="submit" className={`btn ${styles.connect}`} disabled={disabled}>
            {busy ? 'Conectando…' : theme === 'matrix' ? `[ ${copy.button} ]` : copy.button}
          </button>
        </form>

        <button type="button" className={styles.themeToggle} onClick={toggleTheme}>
          ◐ Tema: {THEME_LABELS[theme]}
        </button>
      </div>
    </main>
  );
}
