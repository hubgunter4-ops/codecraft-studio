.PHONY: install dev check test build format

install:
	pnpm install --frozen-lockfile

dev:
	pnpm dev

check:
	pnpm check

test:
	pnpm test

build:
	pnpm build

format:
	pnpm format
