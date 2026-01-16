FROM --platform=linux/amd64 elixir:1.17-alpine

# Workaround QEMU JIT issue building AMD64 on ARM64
ENV ERL_FLAGS="+JPperf true"

RUN apk add --no-cache build-base git inotify-tools

WORKDIR /app

COPY mix.exs mix.lock ./
COPY config ./config
RUN mix local.hex --force && mix local.rebar --force
RUN MIX_ENV=dev mix deps.get
RUN MIX_ENV=test mix deps.get
RUN MIX_ENV=prod mix deps.get
RUN MIX_ENV=prod mix deps.compile

COPY lib ./lib
COPY priv ./priv
COPY assets ./assets

RUN MIX_ENV=prod mix assets.setup
RUN MIX_ENV=prod mix assets.deploy
RUN MIX_ENV=prod mix compile
RUN MIX_ENV=prod mix release

EXPOSE 4000

ENV MIX_ENV=prod
CMD ["_build/prod/rel/cardtable/bin/cardtable", "start"]
