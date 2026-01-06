Implementation Outline

See also: 01-Design.md

Goals
- Separate cardtable app for real-time card-game simulation.
- Phoenix backend is authoritative; SPA client renders and animates.
- All services run in Docker; no host installs required.

Architecture
- Phoenix app provides a websocket (Channels) topic per game: game:<code>.
- SPA client connects over websocket and renders state JSON.
- Game state is in memory (no database) using a GenServer per game.
- Player rejoin uses a player token stored in localStorage.

SPA Client
- Single-page web app that renders the table, deck, discard, and hands from server state.
- Receives public and private state updates over websocket and applies animations locally.
- Sends player intents (draw, move, flip, etc.) to the server; server remains authoritative.
- Frontend uses Phoenix asset pipeline with esbuild (no extra bundler).
- Plain TypeScript + three.js for rendering; minimal third-party dependencies.

State Model
- Zones own cards: deck, table, discard, hands.<player_id>.
- Cards are defined by JSON decks (cards + optional quirks).
- Quirk pairing is created at game start and persists for the game.
- Table cards track face state (down/up/quirk) and position (x,y).

Websocket Events
- Client intents: join, draw, move_card, steal_random, set_table_position, flip_table_card, toggle_discard_quirk, shuffle_discard_into_deck, restart.
- Server emits: full state snapshots plus public/private deltas.

Local Dev via Make + Docker
- make start: build and run the cardtable stack in docker-compose.
- make stop: stop the cardtable stack.
- make test: run all tests.
- make test-quick: run fast checks in docker.
- make test-integration: run integration tests in an isolated docker-compose project.

Notes
- Deck sets are chosen by deck directory name (including standard-52).
- Quirks are optional; games can run without quirks.
- Card schema supports title, body, and image; at least one field required.
- Deck files live under static/decks/cards/<deck>/deck.json and static/decks/quirks/<deck>/deck.json.
