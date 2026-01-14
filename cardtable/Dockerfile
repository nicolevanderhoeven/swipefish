FROM --platform=linux/amd64 elixir:1.17-alpine

# Workaround QEMU JIT issue building AMD64 on ARM64
ENV ERL_FLAGS="+JPperf true"

RUN apk add --no-cache build-base git inotify-tools

WORKDIR /app

ENV MIX_ENV=dev

COPY mix.exs mix.lock ./
COPY config ./config
RUN mix local.hex --force && mix local.rebar --force
RUN mix deps.get

COPY lib ./lib
COPY priv ./priv
COPY assets ./assets

EXPOSE 4000

CMD ["mix", "phx.server"]
