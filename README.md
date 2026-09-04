# CodeCraft Studio

Editor y revisor de código en español con OpenAI. Permite escribir o pegar código, elegir entre 16 lenguajes, pedir una revisión técnica, generar una versión corregida y crear código desde una instrucción en lenguaje natural. El editor usa Monaco Editor con resaltado de sintaxis, autocompletado y atajos familiares.

## Ejecutar en localhost

```bash
make install
make dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Comandos disponibles

| Comando | Acción |
| --- | --- |
| `make install` | Instala las dependencias |
| `make dev` | Inicia el servidor de desarrollo en localhost:3000 |
| `make check` | Verifica TypeScript |
| `make test` | Ejecuta las pruebas unitarias |
| `make build` | Genera la compilación de producción |
| `make format` | Formatea el código |

## Configuración de OpenAI

La clave se usa exclusivamente en el backend. Define estas variables en el entorno local, en un archivo `.env` que no se versiona:

```bash
OPENAI_API_KEY=tu_clave
OPENAI_BASE_URL=https://api.openai.com/v1
```

`OPENAI_BASE_URL` es opcional. El servidor usa `https://api.openai.com/v1` por defecto. La aplicación llama a `chat/completions` y utiliza `gpt-4o-mini` por defecto; puedes cambiarlo con `OPENAI_MODEL`.

## Privacidad

CodeCraft Studio no guarda el código, las solicitudes ni las respuestas en la base de datos. El fragmento se envía al proveedor configurado para producir la revisión y solo se mantiene en el estado de la sesión del navegador. La clave no se expone al frontend ni se incluye en GitHub.

## Repositorio

El código fuente está en el repositorio privado de GitHub del proyecto.
