DOCKER_IMAGE=swipefish-frontend
SUBDIRS=frontend backend
COMPOSE=docker compose

clean build:
	for d in $(SUBDIRS); do $(MAKE) -C "$$d" $@; done

start:
	$(COMPOSE) up --build

test:
	$(MAKE) test-quick
	$(MAKE) test-integration

test-quick:
	$(COMPOSE) -p swipefish-test -f docker-compose.yml -f docker-compose.test.yml run --rm backend-test
	$(COMPOSE) -p swipefish-test -f docker-compose.yml -f docker-compose.test.yml run --rm frontend-test

test-integration:
	sh -c 'set -e; \
	trap "$(COMPOSE) -p swipefish-test -f docker-compose.yml -f docker-compose.test.yml down -v" EXIT; \
	BACKEND_PORT=0 FRONTEND_PORT=0 $(COMPOSE) -p swipefish-test -f docker-compose.yml -f docker-compose.test.yml up -d --build postgres backend; \
	BACKEND_PORT=0 FRONTEND_PORT=0 $(COMPOSE) -p swipefish-test -f docker-compose.yml -f docker-compose.test.yml run --rm backend sh -c "npm install --no-save socket.io-client@^4.7.2 >/dev/null 2>&1 && node test/integration/game-test.js"'

prereqs:
	@docker --version
	@$(COMPOSE) version
