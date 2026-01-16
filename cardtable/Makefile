COMPOSE=docker compose
COMPOSE_TEST=$(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml
LOCAL_IMAGE=cardtable:latest
DOCKER_IMAGE=noelbk/cardtable:latest
K8S_NAMESPACE=cardtable

build:
	$(COMPOSE) build

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

deploy: build
	docker tag $(LOCAL_IMAGE) $(DOCKER_IMAGE)
	docker push $(DOCKER_IMAGE)
	./deploy.sh
	kubectl rollout status deployment/cardtable -n $(K8S_NAMESPACE)

deploy-status:
	kubectl get pods -n $(K8S_NAMESPACE)
	kubectl get svc -n $(K8S_NAMESPACE)
	kubectl get ingress -n $(K8S_NAMESPACE)


.PHONY: build start stop test test-build test-quick test-integration deploy deploy-status
