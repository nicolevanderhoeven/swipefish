FROM elixir:1.17-alpine

RUN apk add --no-cache build-base git inotify-tools

WORKDIR /app

ARG SKIP_ASSETS=0

ENV MIX_ENV=dev
ENV SKIP_ASSETS=${SKIP_ASSETS}

COPY mix.exs mix.lock ./
COPY config ./config
RUN mix local.hex --force && mix local.rebar --force
RUN mix deps.get

COPY lib ./lib
COPY priv ./priv
COPY assets ./assets

RUN if [ "$SKIP_ASSETS" != "1" ]; then mix assets.setup; fi

EXPOSE 4000

CMD ["mix", "phx.server"]
