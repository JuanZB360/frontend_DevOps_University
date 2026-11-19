import { describe, expect, it } from 'vitest';
import { normalizeUsername, validatePassword, validateUsername } from './credentials';

// Mismas reglas que Username.java y RawPassword.java en el backend.
describe('reglas de credenciales', () => {
  it('normaliza y valida usuarios como useradd', () => {
    expect(normalizeUsername('  Juan_Dev ')).toBe('juan_dev');
    expect(validateUsername('Juan_Dev')).toBeNull();
    expect(validateUsername('ab')).toMatch(/entre 3 y 16/);
    expect(validateUsername('9lives')).toMatch(/empezando por una letra/);
    expect(validateUsername('josé')).toMatch(/Solo minúsculas/);
    expect(validateUsername('root')).toMatch(/reservado/);
  });

  it('exige contraseñas de 8+ caracteres con letras y números', () => {
    expect(validatePassword('matrix1999')).toBeNull();
    expect(validatePassword('abc1')).toMatch(/al menos 8/);
    expect(validatePassword('soloLetras')).toMatch(/letras y números/);
    expect(validatePassword('a1' + 'x'.repeat(80))).toMatch(/demasiado larga/);
  });
});
