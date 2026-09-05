# Informe de auditoría de dependencias

## Resumen ejecutivo

La alerta inicial de GitHub indicó 143 vulnerabilidades en el repositorio. Una auditoría local fresca con `pnpm audit` encontró un inventario ligeramente distinto —3 críticas, 58 altas, 80 moderadas y 13 bajas, distribuidas en 149 avisos— porque los datos de GitHub y del registro de paquetes no son necesariamente el mismo snapshot. El árbol corregido queda con **cero vulnerabilidades conocidas** tanto en dependencias de producción como de desarrollo.

> Resultado final: `pnpm audit --prod` y `pnpm audit --dev` terminan con `No known vulnerabilities found` y código de salida 0.

## Cambios aplicados

| Área | Corrección |
| --- | --- |
| Dependencias directas | Actualización de tRPC a `11.18.0`, Axios a `1.20.0`, Drizzle ORM a `0.45.2`, MySQL2 a `3.24.3` y Nanoid a `5.1.16`. |
| Toolchain | Actualización de Drizzle Kit a `0.31.10`, esbuild a `0.28.2`, PostCSS a `8.5.28`, Vite a la rama segura `7.3.x`, Vitest a `3.2.x` y pnpm a `10.34.5`. |
| Dependencias transitivas | Overrides mínimos en `pnpm-workspace.yaml` para `tar`, `fast-xml-parser`, `browserslist`, `form-data`, `lodash`, `path-to-regexp`, `picomatch`, `qs`, `rollup`, `dompurify`, `mermaid`, `uuid`, `@babel/core`, `@smithy/config-resolver`, `body-parser` y la cadena antigua de esbuild. |
| Plugin incompatible | Eliminación de `@builder.io/vite-plugin-jsx-loc`, cuya única versión publicada exige Vite 4/5 y generaba un peer mismatch con la toolchain segura de Vite 7. |
| Instalación reproducible | `Makefile` usa `pnpm install --frozen-lockfile`; GitHub Actions fija pnpm `10.34.5` antes de ejecutar el build. |
| Configuración de pnpm | Los overrides se movieron de `package.json` a `pnpm-workspace.yaml`, ubicación reconocida por pnpm 10, evitando advertencias de configuración ignorada. |

## Validaciones realizadas

| Validación | Resultado |
| --- | ---: |
| `pnpm audit --prod` | Correcto; 0 vulnerabilidades conocidas |
| `pnpm audit --dev` | Correcto; 0 vulnerabilidades conocidas |
| `make install` con lockfile congelado | Correcto |
| `make check` / TypeScript | Correcto |
| `make test` | Correcto; 3 archivos y 5 pruebas |
| `GITHUB_ACTIONS=true make build` | Correcto; Vite 7.3.6 y bundle generado |
| `git diff --check` | Correcto; sin errores de whitespace |
| Búsqueda de secretos en el diff | Correcto; no se encontraron API Keys ni claves privadas |

La alerta de esbuild que permanecía después de la primera reparación provenía de `drizzle-kit` y su cadena antigua `@esbuild-kit`. Se resolvió con el override `esbuild@<0.25.0: 0.25.4` y la actualización de Drizzle Kit.

## Nota operativa

Durante la instalación pnpm informa que bloquea scripts de compilación de `esbuild@0.25.4`. Es una protección de instalación, no una vulnerabilidad ni un fallo de build: las pruebas y la compilación pasan. Si en el futuro se ejecuta localmente una herramienta que dependa específicamente de ese script, debe aprobarse de forma explícita y revisada mediante la política de scripts de pnpm.

## Referencias

[1]: https://pnpm.io/cli/audit "pnpm audit — documentación oficial"
[2]: https://github.com/advisories/GHSA-67mh-4wv8-2f99 "Aviso de seguridad de esbuild GHSA-67mh-4wv8-2f99"
[3]: https://github.com/pnpm/pnpm/releases "Versiones y parches de pnpm"
