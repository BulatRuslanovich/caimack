.DEFAULT_GOAL := help

.PHONY: help \
	backend frontend db migrate mert model sqlx \
	check fmt lint test test-db \
	apk desktop desktop-windows desktop-linux desktop-arch desktop-deps

define HELP_TEXT
Caimack development commands

Usage: make <target>

Local development
  backend          Start PostgreSQL, apply migrations, and run the Rust API
  frontend         Start the Next.js development server
  db               Start the local PostgreSQL container
  migrate          Apply database migrations
  mert             Start the MERT development service
  model            Download the MERT model weights
  sqlx             Refresh the SQLx query metadata

Code quality
  check            Lint, test, and check formatting for Rust and web
  fmt              Format Rust and web code
  lint             Lint Rust and web code
  test             Run Rust and web tests
  test-db          Run Rust tests with all features and local PostgreSQL

Client packages
  apk              Build the Android release APK
  desktop          Build desktop packages for the current OS
  desktop-windows  Build Windows installer and portable packages
  desktop-linux    Build Linux desktop packages
  desktop-arch     Build the Arch Linux package
  desktop-deps     Install web and desktop npm dependencies
endef

help:
	$(info $(HELP_TEXT))
	@:

# Local development

backend: migrate
	cd backend && cargo run

frontend:
	cd frontend && (test -d node_modules || npm install) && npm run dev

db:
	@docker start caimack-rust-dev-db >/dev/null 2>&1 || MSYS_NO_PATHCONV=1 docker run -d --name caimack-rust-dev-db \
		--restart unless-stopped -p 127.0.0.1:55433:5432 \
		-e POSTGRES_USER=music -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=music \
		-v caimack-rust-dev-db:/var/lib/postgresql/data \
		postgres:17-alpine

migrate: db
	cd backend && cargo sqlx migrate run --source ../db/migrations

mert:
	docker compose -f docker-compose.dev.yml up -d mert

model:
	docker compose run --rm mert --download-only

sqlx:
	cd backend && cargo sqlx prepare --workspace

# Code quality

check: lint test
	cd backend && cargo fmt --all --check
	cd frontend && npm run format:check

fmt:
	cd backend && cargo fmt --all
	cd frontend && npm run format

lint:
	cd backend && cargo clippy --workspace --all-targets -- -D warnings
	cd frontend && npm run lint

test:
	cd backend && cargo test --workspace
	cd frontend && npm test

test-db: migrate
	cd backend && cargo test --workspace --all-features --locked

# Client packages

apk:
	cd android && ./gradlew :app:assembleRelease

ifeq ($(OS),Windows_NT)
desktop: desktop-windows
else
desktop: desktop-linux
endif

desktop-windows: desktop-deps
	npm run dist:windows --prefix desktop

desktop-linux: desktop-deps
	npm run dist:linux --prefix desktop

desktop-arch: desktop-linux
	cd desktop/release/arch && makepkg --force --clean

desktop-deps:
	npm ci --prefix frontend
	npm ci --prefix desktop
