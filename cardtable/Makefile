COMPOSE=docker compose
COMPOSE_TEST=$(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml

build:
	$(COMPOSE) build

start: build
	$(COMPOSE) up -d

stop:
	$(COMPOSE) down

test: test-quick test-integration

test-build:
	SKIP_ASSETS=1 $(COMPOSE_TEST) build

test-quick: test-build
	SKIP_ASSETS=1 $(COMPOSE_TEST) run --rm -e SKIP_ASSETS=1 app mix test test/cardtable/game_test.exs

test-integration: test-build
	SKIP_ASSETS=1 $(COMPOSE_TEST) run --rm -e SKIP_ASSETS=1 app mix test


.PHONY: build start stop test test-build test-quick test-integration
