# CodeCraft Studio

Editor estático para GitHub Pages con Monaco Editor. Permite escribir código con resaltado, elegir entre 16 lenguajes, generar código desde instrucciones en texto y solicitar revisión o corrección usando la API Key de OpenAI del propio usuario.

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` construye y publica automáticamente la carpeta `dist/public` cada vez que se actualiza `main`. La ruta publicada es:

`https://hubgunter4-ops.github.io/codecraft-studio/`

## Ejecutar en localhost

```bash
make install
make dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Comandos disponibles

| Comando | Acción |
| --- | --- |
| `make install` | Instala dependencias |
| `make dev` | Inicia el servidor local |
| `make check` | Verifica TypeScript |
| `make test` | Ejecuta pruebas unitarias |
| `make build` | Genera la compilación |

## API Key local

Pulsa **Configurar API Key** dentro de la web e introduce tu clave. Se almacena solo en `localStorage` del navegador actual y se envía directamente a OpenAI desde el cliente. No se incorpora al bundle, no se sube a GitHub y no se guarda en la base de datos. Usa el botón **Eliminar** para borrarla.

La aplicación usa `https://api.openai.com/v1` y el modelo `gpt-4o-mini`. El campo de URL base permite apuntar a otro endpoint compatible con OpenAI.

> La clave introducida en el navegador puede ser visible para ese navegador y sus extensiones. Usa una clave con límites de gasto y revócala cuando ya no la necesites.

## Privacidad

El código, las peticiones y las respuestas se mantienen en el estado de la sesión del navegador. GitHub Pages sirve archivos estáticos y no ejecuta el backend de CodeCraft.
