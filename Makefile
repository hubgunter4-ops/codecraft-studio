SHELL := /bin/bash

PNPM ?= pnpm

.PHONY: help install setup dev start check test test-watch audit audit-prod audit-dev validate build build-pages clean format format-check ci

help:
	@printf '%s\n' \
		'CodeCraft Studio — comandos disponibles:' \
		'  make install       Instala dependencias con pnpm y lockfile congelado' \
		'  make setup         Alias de install para preparar el proyecto' \
		'  make dev           Inicia el servidor de desarrollo local' \
		'  make start         Inicia el bundle de producción ya construido' \
		'  make check         Ejecuta TypeScript sin emitir archivos' \
		'  make test          Ejecuta las pruebas unitarias una vez' \
		'  make test-watch    Ejecuta Vitest en modo interactivo' \
		'  make audit         Audita todas las dependencias' \
		'  make audit-prod    Audita únicamente dependencias de producción' \
		'  make audit-dev     Audita únicamente dependencias de desarrollo' \
		'  make validate      Ejecuta check, test y build-pages' \
		'  make build         Genera el bundle de producción' \
		'  make build-pages   Genera el bundle con GITHUB_ACTIONS=true' \
		'  make format        Formatea el proyecto con Prettier' \
		'  make format-check  Comprueba el formato sin modificar archivos' \
		'  make clean         Elimina los artefactos de build' \
		'  make ci            Ejecuta el flujo completo de CI local'

install:
	$(PNPM) install --frozen-lockfile

setup: install

# Servidor de desarrollo: http://localhost:3000
dev:
	$(PNPM) dev

# Requiere haber ejecutado make build previamente.
start:
	NODE_ENV=production $(PNPM) start

check:
	$(PNPM) check

test:
	$(PNPM) test

test-watch:
	$(PNPM) exec vitest

audit:
	$(PNPM) audit

audit-prod:
	$(PNPM) audit --prod

audit-dev:
	$(PNPM) audit --dev

validate: check test build-pages

build:
	$(PNPM) build

build-pages:
	GITHUB_ACTIONS=true $(PNPM) build

format:
	$(PNPM) format

format-check:
	$(PNPM) exec prettier --check .

clean:
	rm -rf dist

ci: install audit-prod audit-dev check test build-pages
