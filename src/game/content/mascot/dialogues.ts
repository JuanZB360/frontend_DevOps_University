/**
 * Frases de N0X, la mascota. Separadas de la lógica para poder ampliarlas,
 * traducirlas o darles otra personalidad sin tocar código.
 * {name}, {rank}, {level}, {title} y {commands} se sustituyen en tiempo de ejecución.
 */
export const DIALOGUES = {
  welcomeNew: [
    'Bienvenido, {name}. Soy N0X. Yo seré tu sombra en este sistema.',
    'Así que tú eres {name}. Veamos si tienes lo que hace falta para ser root.',
  ],
  welcomeBack: [
    'Has vuelto, {name}. El servidor te echaba de menos.',
    'Sesión restaurada. Sigamos donde lo dejamos, {name}.',
    'Pensé que te habías rendido. Me alegra equivocarme.',
  ],
  missionStarted: [
    'Nueva misión: «{title}». Lee el briefing con calma.',
    '«{title}». Tú puedes con esto.',
    'Siguiente objetivo: «{title}». La terminal es toda tuya.',
  ],
  bossStarted: [
    '⚠ JEFE: «{title}». Aquí se demuestra lo aprendido.',
    'Esto es un examen de verdad. Respira y piensa antes de escribir.',
  ],
  missionCompleted: [
    '¡Bien hecho! Así se hace.',
    'Limpio y preciso. Me gusta tu estilo.',
    'Misión cumplida. Cada comando te acerca a root.',
    'Ni un solo error de más. Impresionante.',
  ],
  perfectMission: [
    '¡Tres estrellas sin pistas! Naciste para esto.',
    'Sin ayuda. Eso es talento puro.',
  ],
  chapterCompleted: [
    '¡Capítulo superado! El sistema empieza a obedecerte.',
  ],
  levelUp: [
    '¡NIVEL {level}! Siento cómo crece tu poder.',
    'Subiste al nivel {level}. La Matrix empieza a doblarse ante ti.',
  ],
  rankUp: [
    'Nuevo rango: {rank}. Te lo has ganado.',
  ],
  commandsUnlocked: [
    'Comando desbloqueado: {commands}. Su manual ya está en el panel izquierdo.',
  ],
  commandSuccess: [
    'Bien.',
    'Correcto.',
    'Eso es.',
    'Vas por buen camino.',
  ],
  commandError: [
    'Error. Lee el mensaje: casi siempre te dice qué falló.',
    'No pasa nada. Los errores son parte del aprendizaje.',
    'Revisa la ortografía y las rutas. Linux no perdona una letra.',
  ],
  errorStreak: [
    'Varios errores seguidos... ¿Pruebas con `mision` para repasar el objetivo?',
    'Atascado es normal. Si lo necesitas, una pista te costará unos puntos.',
  ],
  locked: [
    'Ese comando aún está encriptado. Llegará su momento.',
  ],
  missionRestarted: [
    'Escenario restaurado. Respira y vuelve a intentarlo.',
    'Todo como al principio. Esta vez lo conseguirás.',
  ],
  hintRevealed: [
    'Aquí tienes una pista. Úsala bien.',
    'Te echo una mano. Pero la próxima inténtalo un poco más.',
  ],
  noPoints: [
    'No tienes puntos suficientes. Completa misiones o prueba con `man`.',
  ],
  idle: [
    '¿Sigues ahí? Escribe `mision` si no recuerdas el objetivo.',
    'La terminal no muerde... bueno, a veces sí. Prueba algo.',
    'Consejo: pulsa Tab para autocompletar comandos y rutas.',
    'Consejo: las flechas ↑ ↓ recuperan comandos anteriores.',
  ],
  allCompleted: [
    'Has completado todo el contenido disponible. Pronto habrá más. Sigue practicando en libertad.',
  ],
} as const;

export type DialogueKey = keyof typeof DIALOGUES;
