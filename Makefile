# Shortcuts for the everyday commands. Everything runs through pnpm; the
# targets only save typing and document what exists.

.DEFAULT_GOAL := help
.PHONY: help install dev build start check test lint typecheck clean assets hall-clear docker-build docker-run

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed 's/:.*## /|/' | column -t -s '|'

install: ## Install all workspace packages (also copies samples and anthems)
	pnpm install

dev: ## Game server on :3000 plus the Vite dev server on :5173
	pnpm dev

build: ## Build the server bundle and the client
	pnpm build

start: build ## Build, then serve the built client from the game server on :3000
	pnpm start

check: ## Typecheck, lint and tests for every package
	pnpm check

test: ## Vitest across the workspace
	pnpm test

lint: ## ESLint
	pnpm lint

typecheck: ## tsc for every package
	pnpm typecheck

assets: ## Copy samples and anthems from the npm packages into apps/web/public
	pnpm --filter @geo-battler/web assets

hall-clear: ## Delete the Hall of Fame (data/hall.json)
	pnpm --filter @geo-battler/server hall:clear

clean: ## Remove build output and the copied assets
	rm -rf apps/server/dist apps/web/dist apps/web/public/audio

docker-build: ## Build the Docker image geo-battler
	docker build -t geo-battler .

docker-run: ## Run the image on :3000 with .env and a volume for the Hall of Fame
	docker run --rm -p 3000:3000 --env-file .env -v geo-battler-data:/app/data geo-battler
