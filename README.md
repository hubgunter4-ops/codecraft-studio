# CodeCraft Studio

Editor estático para GitHub Pages con Monaco Editor. Permite escribir código con resaltado, elegir entre 16 lenguajes, generar código desde instrucciones en texto y solicitar revisión o corrección usando la API Key de OpenAI del propio usuario.

La interfaz se organiza en dos vistas: revisión y generación. En GitHub Pages usa hash routing para evitar 404 en rutas profundas: `/#/review` para revisar y corregir código, y `/#/generate` para crear código desde una descripción. En desarrollo local se mantienen las rutas de historial `/review` y `/generate`.

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

Pulsa **Configurar API Key** dentro de la web e introduce tu clave. Se almacena solo en `sessionStorage` durante la sesión de esa pestaña y se envía directamente al endpoint elegido desde el cliente. No se incorpora al bundle, no se sube a GitHub y no se guarda en la base de datos. Usa el botón **Eliminar** para borrarla antes de cerrar la pestaña.

La aplicación usa `https://api.openai.com/v1` y el modelo `gpt-4o-mini`. El campo de URL base permite apuntar a otro endpoint compatible con OpenAI; por seguridad, las URL remotas deben usar HTTPS y HTTP solo se acepta para `localhost` o `127.0.0.1`.

> La clave introducida en el navegador puede ser visible para ese navegador y sus extensiones. Usa una clave con límites de gasto, evita introducirla en equipos compartidos y revócala cuando ya no la necesites.

## Privacidad

El código, las peticiones y las respuestas se mantienen en el estado de la sesión del navegador. GitHub Pages sirve archivos estáticos y no ejecuta el backend de CodeCraft.


## Constructor de herramientas Linux

La ruta [`#/tools`](https://hubgunter4-ops.github.io/codecraft-studio/#/tools) permite generar herramientas para Ubuntu/Debian, Fedora/RHEL, Arch Linux, Alpine y openSUSE. El usuario puede elegir entre un script Bash completo o un repositorio portable con `README.md`, `Makefile`, smoke test, `.gitignore` y licencia.

El generador adapta la instalación de paquetes al gestor de la distribución (`apt-get`, `dnf`, `pacman`, `apk` o `zypper`), incluye la opción `--dry-run`, muestra los archivos antes de descargar y no ejecuta comandos en el navegador. Los repositorios se descargan como archivos TAR y los scripts como `.sh` ejecutable.

Antes de usar una salida generada con privilegios, revisa el contenido, las dependencias y las órdenes de instalación. La aplicación genera archivos localmente; no sube ni ejecuta el script.
