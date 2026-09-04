# CodeCraft Studio

Editor y revisor de código en español con OpenAI. La aplicación permite escribir o pegar un fragmento, elegir el lenguaje, pedir una revisión técnica o generar una versión corregida y copiar el resultado.

## Ejecutar en localhost

```bash
pnpm install
pnpm dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Configuración de OpenAI

La clave se usa exclusivamente en el backend. Define estas variables en el entorno local, en un archivo `.env` que no se versiona:

```bash
OPENAI_API_KEY=tu_clave
OPENAI_BASE_URL=https://api.openai.com/v1
```

`OPENAI_BASE_URL` es opcional. El servidor usa `https://api.openai.com/v1` por defecto. La aplicación llama a `chat/completions` y utiliza `gpt-4o-mini` por defecto; puedes cambiarlo con `OPENAI_MODEL`.

## Privacidad

CodeCraft Studio no guarda el código, las solicitudes ni las respuestas en la base de datos. El fragmento se envía al proveedor configurado para producir la revisión y solo se mantiene en el estado de la sesión del navegador. La clave no se expone al frontend ni se incluye en GitHub.

## Comandos útiles

```bash
pnpm check       # Verificación TypeScript
pnpm test        # Pruebas unitarias
pnpm build       # Compilación de producción
```

## Repositorio

El código fuente está en el repositorio privado de GitHub del proyecto.
