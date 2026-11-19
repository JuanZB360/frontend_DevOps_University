# DevOps University: frontend

React 19 + TypeScript + Vite. Consulta el [README principal](../README.md) y la
[arquitectura](../docs/ARCHITECTURE.md).

```
src/
├── engine/    Sistema Linux simulado (VFS, shell, comandos, edición de línea). Sin React.
├── game/      Reglas del juego, contenido (misiones, manuales, diálogos) y persistencia. Sin React.
├── ui/        Componentes React, estilos y el controlador de xterm.js.
├── shared/    Utilidades transversales (EventBus).
└── app/       Componente raíz.
```

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests
npm run typecheck  # tipos
npm run build      # producción
```
