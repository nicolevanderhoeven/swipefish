DOCKER_IMAGE=swipefish-frontend

build:
	docker build --platform=linux/amd64 --build-arg VITE_SOCKET_URL=wss://swipe.fish -t $(DOCKER_IMAGE) .
