COMPOSE=docker compose
COMPOSE_TEST=$(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml
LOCAL_DEV_IMAGE=cardtable:dev
LOCAL_PROD_IMAGE=cardtable:latest
DOCKER_IMAGE=noelbk/cardtable:latest
K8S_NAMESPACE=cardtable

build: ## Build the dev image (docker-compose)
	$(COMPOSE) build

build-prod: ## Build the production runtime image
	docker build --target runtime -t $(LOCAL_PROD_IMAGE) .

start: build
	$(COMPOSE) up -d

stop:
	$(COMPOSE) down

test: test-quick test-integration

test-build:
	$(COMPOSE_TEST) build

test-quick: test-build
	$(COMPOSE_TEST) run --rm app mix test test/cardtable/game_test.exs

test-integration: test-build
	$(COMPOSE_TEST) run --rm app mix test

test-unit: ## Run unit tests in the Docker `test` target (not shipped)
	docker build --target test -t cardtable:test .
	docker run --rm cardtable:test

test-smoke: ## Run smoke tests against the runtime image (no source shipped)
	docker build --target runtime -t $(LOCAL_PROD_IMAGE) .
	docker build --target smoke -t cardtable:smoke .
	@docker run --rm \
		-e PHX_SERVER=true \
		-e SECRET_KEY_BASE=$${SECRET_KEY_BASE:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa} \
		-e PORT=4000 \
		cardtable:smoke

deploy: build-prod
	# Build + push the correct platform for the cluster (DigitalOcean nodes are amd64).
	# This avoids ImagePullBackOff: "no match for platform in manifest".
	docker buildx build --platform $(DOCKER_PLATFORM) --target runtime -t $(DOCKER_IMAGE) --push .
	./deploy.sh
	kubectl rollout status deployment/cardtable -n $(K8S_NAMESPACE) --timeout=10m

deploy-status:
	kubectl get pods -n $(K8S_NAMESPACE)
	kubectl get svc -n $(K8S_NAMESPACE)
	kubectl get ingress -n $(K8S_NAMESPACE)


.PHONY: build build-prod start stop test test-build test-quick test-integration test-unit test-smoke deploy deploy-status
