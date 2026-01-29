# syntax=docker/dockerfile:1.6

FROM --platform=linux/amd64 elixir:1.17-alpine AS base

# Workaround QEMU JIT issue building AMD64 on ARM64
ENV ERL_FLAGS="+JPperf true"

WORKDIR /app

# Build dependencies (git is needed for the heroicons git dependency)
RUN apk add --no-cache build-base git

# Install Hex/Rebar once in base to maximize caching
RUN mix local.hex --force && mix local.rebar --force

FROM base AS deps

ENV MIX_ENV=prod

# Only copy dependency manifests + config so this layer stays cacheable
COPY mix.exs mix.lock ./
COPY config ./config

RUN mix deps.get --only prod
RUN mix deps.compile

# Cache Tailwind/esbuild downloads (driven by config/config.exs versions)
RUN mix assets.setup

FROM base AS test_deps

ENV MIX_ENV=test

# Only copy dependency manifests + config so this layer stays cacheable
COPY mix.exs mix.lock ./
COPY config ./config

RUN mix deps.get
RUN mix deps.compile

FROM base AS dev

ENV MIX_ENV=dev

# inotify-tools for file watching/code reloading ergonomics
RUN apk add --no-cache inotify-tools

COPY mix.exs mix.lock ./
COPY config ./config

# Dev deps in the image (even if you bind-mount /app, this keeps Docker build caching effective)
RUN mix deps.get
RUN mix deps.compile
RUN mix assets.setup

COPY lib ./lib
COPY priv ./priv
COPY assets ./assets

EXPOSE 4000
CMD ["mix", "phx.server"]

FROM base AS test

ENV MIX_ENV=test

COPY --from=test_deps /app/deps ./deps
COPY --from=test_deps /app/_build ./_build
COPY mix.exs mix.lock ./
COPY config ./config
COPY lib ./lib
COPY priv ./priv
COPY test ./test

CMD ["mix", "test"]

FROM base AS build

ENV MIX_ENV=prod

COPY --from=deps /app/deps ./deps
COPY --from=deps /app/_build ./_build
COPY mix.exs mix.lock ./
COPY config ./config
COPY lib ./lib
COPY priv ./priv
COPY assets ./assets

RUN mix assets.deploy
RUN mix compile
RUN mix release

FROM --platform=linux/amd64 alpine:3.22 AS runtime

WORKDIR /app

# Runtime libs commonly needed by Erlang/SSL releases
RUN apk add --no-cache libstdc++ openssl ncurses-libs

COPY --from=build /app/_build/prod/rel/cardtable ./

EXPOSE 4000

ENV MIX_ENV=prod
CMD ["bin/cardtable", "start"]

FROM runtime AS smoke

RUN apk add --no-cache curl

COPY bin/smoke_test ./bin/smoke_test

CMD ["sh", "bin/smoke_test"]
