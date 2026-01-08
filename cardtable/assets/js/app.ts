import { Socket } from "phoenix";

type DeckOption = { name: string };

type CardFace = {
  title?: string | null;
  body?: string | null;
  image?: string | null;
};

type TableCard = {
  card_id: string;
  face_state: "down" | "up" | "quirk";
  position: { x: number; y: number } | null;
  face: CardFace | null;
  quirk: CardFace | null;
};

type PublicState = {
  code: string;
  deck_set: string | null;
  quirk_set: string | null;
  deck_back_image: string | null;
  deck_count: number;
  discard_top: {
    card_id: string;
    face: CardFace | null;
    quirk: CardFace | null;
    quirk_revealed: boolean;
  } | null;
  table: TableCard[];
  players: { id: string; name: string; hand_count: number; connected: boolean }[];
  available_decks: { cards: DeckOption[]; quirks: DeckOption[] };
};

type PrivateState = {
  player_id: string;
  hand: { card_id: string; face: CardFace | null; quirk: CardFace | null }[];
};

type GameState = { public_state: PublicState; private_state: PrivateState | null };

type JoinResponse = {
  ok: boolean;
  player_id?: string;
  player_token?: string;
  error?: string;
};

const root = document.getElementById("cardtable-app");
if (!root) {
  throw new Error("Missing #cardtable-app root element");
}

const state = {
  socket: null as Socket | null,
  channel: null as any,
  gameCode: "",
  playerToken: sessionStorage.getItem("cardtable_player_token") || "",
  playerId: "",
  publicState: null as PublicState | null,
  privateState: null as PrivateState | null,
  pendingName: "",
};

const ui = {
  lobby: document.getElementById("lobby") as HTMLDivElement,
  game: document.getElementById("game") as HTMLDivElement,
  nameInput: document.getElementById("player-name") as HTMLInputElement,
  codeInput: document.getElementById("game-code") as HTMLInputElement,
  createButton: document.getElementById("create-game") as HTMLButtonElement,
  joinButton: document.getElementById("join-game") as HTMLButtonElement,
  status: document.getElementById("status") as HTMLDivElement,
  deckCount: document.getElementById("deck-count") as HTMLSpanElement,
  discardCard: document.getElementById("discard-card") as HTMLDivElement,
  discardToHand: document.getElementById("discard-to-hand") as HTMLButtonElement,
  discardToTable: document.getElementById("discard-to-table") as HTMLButtonElement,
  table: document.getElementById("table") as HTMLDivElement,
  hand: document.getElementById("hand") as HTMLDivElement,
  players: document.getElementById("players") as HTMLDivElement,
  playersCompact: document.getElementById("players-compact") as HTMLDivElement,
  drawButton: document.getElementById("draw-card") as HTMLButtonElement,
  drawToTableButton: document.getElementById("draw-to-table") as HTMLButtonElement,
  shuffleDiscardButton: document.getElementById("shuffle-discard") as HTMLButtonElement,
  restartButton: document.getElementById("restart-game") as HTMLButtonElement,
  toggleSidebar: document.getElementById("toggle-sidebar") as HTMLButtonElement,
  closeSidebar: document.getElementById("close-sidebar") as HTMLButtonElement,
  sidebar: document.getElementById("game-sidebar") as HTMLDivElement,
  sidebarOverlay: document.getElementById("sidebar-overlay") as HTMLDivElement,
  deckSelect: document.getElementById("deck-select") as HTMLSelectElement,
  quirkSelect: document.getElementById("quirk-select") as HTMLSelectElement,
  gameLink: document.getElementById("game-link") as HTMLAnchorElement,
  copyGameLink: document.getElementById("copy-game-link") as HTMLButtonElement,
};

const showStatus = (message: string, isError = false) => {
  ui.status.textContent = message;
  ui.status.className = isError
    ? "text-sm text-red-400"
    : "text-sm text-slate-400";
};

const setGameLink = (code: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set("game", code);
  ui.gameLink.href = url.toString();
  ui.gameLink.textContent = url.toString();
  window.history.replaceState({}, "", url.toString());
};

const setSidebarOpen = (open: boolean) => {
  if (open) {
    root.classList.add("sidebar-open");
  } else {
    root.classList.remove("sidebar-open");
  }
};

const generateCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};

const connectToGame = (code: string, playerName: string) => {
  state.gameCode = code;
  state.socket = new Socket("/socket", {});
  state.socket.connect();

  const channel = state.socket.channel(`game:${code}`, {
    player_name: playerName,
    player_token: state.playerToken || null,
  });

  channel.on("game:public_update", (payload: { public_state: PublicState }) => {
    state.publicState = payload.public_state;
    render();
    channel.push("game:sync", {});
  });

  channel.on("game:private_update", (payload: { private_state: PrivateState }) => {
    state.privateState = payload.private_state;
    render();
  });

  channel.on("game:error", (payload: { message: string }) => {
    showStatus(payload.message, true);
  });

  channel.join()
    .receive("ok", (resp: JoinResponse) => {
      if (!resp.ok) {
        showStatus(resp.error || "Failed to join game", true);
        return;
      }
      state.playerId = resp.player_id || "";
      if (resp.player_token) {
        state.playerToken = resp.player_token;
        sessionStorage.setItem("cardtable_player_token", resp.player_token);
      }
      setGameLink(code);
      ui.lobby.classList.add("hidden");
      ui.game.classList.remove("hidden");
      channel.push("game:sync", {});
    })
    .receive("error", () => {
      showStatus("Unable to connect to game", true);
    });

  state.channel = channel;
};

const cardLabel = (face: CardFace | null) => {
  if (!face) return "";
  return face.title || face.body || "";
};

const renderTableCard = (card: TableCard, backImage: string | null) => {
  const wrap = document.createElement("div");
  wrap.className = "card";

  const faceButton = document.createElement("button");
  faceButton.className = "card-face";
  faceButton.dataset.cardId = card.card_id;
  faceButton.addEventListener("click", () => {
    state.channel?.push("game:flip_table_card", { card_id: card.card_id });
  });

  if (card.face_state === "down") {
    if (backImage) {
      const img = document.createElement("img");
      img.className = "card-image";
      img.alt = "Card back";
      img.src = backImage;
      faceButton.appendChild(img);
    } else {
      faceButton.textContent = "Face down";
    }
  } else {
    const faceText = cardLabel(card.face);
    const quirkText = cardLabel(card.quirk);
    const hasImage = Boolean(card.face?.image);
    if (card.face?.image) {
      const img = document.createElement("img");
      img.className = "card-image";
      img.alt = faceText || "Card";
      img.src = card.face.image;
      faceButton.appendChild(img);
    }

    if (card.face_state === "up") {
      if (faceText || !hasImage) {
        const title = document.createElement("div");
        title.className = "card-title";
        title.textContent = faceText || "Card";
        faceButton.appendChild(title);
      }
    } else {
      const label = [faceText, quirkText].filter(Boolean).join(" / ");
      if (label || !hasImage) {
        const title = document.createElement("div");
        title.className = "card-title";
        title.textContent = label || "Card";
        faceButton.appendChild(title);
      }
    }
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const toHand = document.createElement("button");
  toHand.textContent = "To hand";
  toHand.addEventListener("click", () => {
    state.channel?.push("game:move_card", {
      card_id: card.card_id,
      from_zone: "table",
      to_zone: "hand",
    });
  });

  const toDiscard = document.createElement("button");
  toDiscard.textContent = "To discard";
  toDiscard.addEventListener("click", () => {
    state.channel?.push("game:move_card", {
      card_id: card.card_id,
      from_zone: "table",
      to_zone: "discard",
    });
  });

  actions.appendChild(toHand);
  actions.appendChild(toDiscard);

  wrap.appendChild(faceButton);
  wrap.appendChild(actions);
  return wrap;
};

const renderHandCard = (card: { card_id: string; face: CardFace | null; quirk: CardFace | null }) => {
  const wrap = document.createElement("div");
  wrap.className = "card";

  const face = document.createElement("div");
  face.className = "card-face";
  const label = cardLabel(card.face);
  const hasImage = Boolean(card.face?.image);
  if (label || !hasImage) {
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = label || "Card";
    face.appendChild(title);
  }

  if (card.face?.image) {
    const img = document.createElement("img");
    img.className = "card-image";
    img.alt = label || "Card";
    img.src = card.face.image;
    face.prepend(img);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const toTable = document.createElement("button");
  toTable.textContent = "To table";
  toTable.addEventListener("click", () => {
    state.channel?.push("game:move_card", {
      card_id: card.card_id,
      from_zone: "hand",
      to_zone: "table",
    });
  });

  const toDiscard = document.createElement("button");
  toDiscard.textContent = "To discard";
  toDiscard.addEventListener("click", () => {
    state.channel?.push("game:move_card", {
      card_id: card.card_id,
      from_zone: "hand",
      to_zone: "discard",
    });
  });

  actions.appendChild(toTable);
  actions.appendChild(toDiscard);

  if (card.quirk) {
    const quirk = document.createElement("div");
    quirk.className = "card-quirk";
    quirk.textContent = cardLabel(card.quirk);
    face.appendChild(quirk);
  }
  wrap.appendChild(face);
  wrap.appendChild(actions);
  return wrap;
};

const render = () => {
  if (!state.publicState) return;

  ui.deckCount.textContent = String(state.publicState.deck_count);
  const players = [...state.publicState.players].sort((a, b) => {
    if (a.id === state.playerId) return -1;
    if (b.id === state.playerId) return 1;
    return a.name.localeCompare(b.name);
  });

  const renderPlayers = (container: HTMLDivElement, includeActions: boolean, withHeading: boolean) => {
    container.innerHTML = "";

    if (withHeading) {
      const heading = document.createElement("div");
      heading.className = "text-xs uppercase tracking-wide text-slate-400";
      heading.textContent = "Players";
      container.appendChild(heading);
    }

    const list = document.createElement("div");
    list.className = "mt-3 space-y-2 text-sm";

    players.forEach((player) => {
      if (player.id === state.playerId) {
        const row = document.createElement("div");
        row.className = "player-item player-edit";

        const input = document.createElement("input");
        input.className = "player-name-input";
        input.value = state.pendingName || player.name;
        input.addEventListener("input", () => {
          state.pendingName = input.value;
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            updateName(input.value);
          }
        });

        const button = document.createElement("button");
        button.textContent = "Update";
        button.addEventListener("click", () => updateName(input.value));

        row.appendChild(input);
        row.appendChild(button);
        list.appendChild(row);
        return;
      }

      const el = document.createElement("div");
      el.className = "player-item";
      el.textContent = `${player.name} (${player.hand_count})${player.connected ? "" : " (offline)"}`;

      if (includeActions) {
        const steal = document.createElement("button");
        steal.textContent = "Steal";
        steal.addEventListener("click", () => {
          state.channel?.push("game:steal_random", {
            from_player_id: player.id,
            to_zone: "hand",
          });
        });
        el.appendChild(steal);
      }
      list.appendChild(el);
    });

    container.appendChild(list);
  };

  const updateName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      showStatus("Enter a name to update", true);
      return;
    }
    state.channel?.push("game:update_name", { name: trimmed });
    state.pendingName = "";
  };

  renderPlayers(ui.players, true, false);
  renderPlayers(ui.playersCompact, false, true);

  ui.table.innerHTML = "";
  state.publicState.table.forEach((card) => {
    ui.table.appendChild(renderTableCard(card, state.publicState?.deck_back_image || null));
  });

  ui.discardCard.textContent = "Empty";
  ui.discardToHand.disabled = true;
  ui.discardToTable.disabled = true;
  if (state.publicState.discard_top) {
    const discard = state.publicState.discard_top;
    ui.discardCard.innerHTML = "";
    if (discard.face?.image) {
      const img = document.createElement("img");
      img.alt = cardLabel(discard.face) || "Card";
      img.src = discard.face.image;
      ui.discardCard.appendChild(img);
    }
    const label = discard.quirk_revealed
      ? [cardLabel(discard.face), cardLabel(discard.quirk)].filter(Boolean).join(" / ")
      : cardLabel(discard.face);
    if (label) {
      const text = document.createElement("div");
      text.className = "text-sm";
      text.textContent = label;
      ui.discardCard.appendChild(text);
    } else if (!discard.face?.image) {
      ui.discardCard.textContent = "Card";
    }
    ui.discardToHand.disabled = false;
    ui.discardToTable.disabled = false;
  }

  ui.hand.innerHTML = "";
  if (state.privateState) {
    state.privateState.hand.forEach((card) => {
      ui.hand.appendChild(renderHandCard(card));
    });
  }


  ui.deckSelect.innerHTML = "";
  state.publicState.available_decks.cards.forEach((deck) => {
    const option = document.createElement("option");
    option.value = deck.name;
    option.textContent = deck.name;
    if (deck.name === state.publicState.deck_set) {
      option.selected = true;
    }
    ui.deckSelect.appendChild(option);
  });

  ui.quirkSelect.innerHTML = "";
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "No quirks";
  ui.quirkSelect.appendChild(noneOption);

  state.publicState.available_decks.quirks.forEach((deck) => {
    const option = document.createElement("option");
    option.value = deck.name;
    option.textContent = deck.name;
    if (deck.name === state.publicState.quirk_set) {
      option.selected = true;
    }
    ui.quirkSelect.appendChild(option);
  });

  const quirkSelected = Boolean(ui.quirkSelect.value);
  if (!quirkSelected) {
    ui.quirkSelect.value = "";
  }
};

ui.createButton.addEventListener("click", () => {
  const name = ui.nameInput.value.trim();
  const code = generateCode();
  ui.codeInput.value = code;
  connectToGame(code, name);
});

ui.joinButton.addEventListener("click", () => {
  const name = ui.nameInput.value.trim();
  const code = ui.codeInput.value.trim().toUpperCase();
  if (!code) {
    showStatus("Enter a game code", true);
    return;
  }
  connectToGame(code, name);
});

ui.toggleSidebar.addEventListener("click", () => {
  setSidebarOpen(true);
});

ui.closeSidebar.addEventListener("click", () => {
  setSidebarOpen(false);
});

ui.sidebarOverlay.addEventListener("click", () => {
  setSidebarOpen(false);
});


ui.drawButton.addEventListener("click", () => {
  state.channel?.push("game:draw", { to_zone: "hand" });
});

ui.drawToTableButton.addEventListener("click", () => {
  state.channel?.push("game:draw", { to_zone: "table" });
});

ui.shuffleDiscardButton.addEventListener("click", () => {
  state.channel?.push("game:shuffle_discard_into_deck", {});
});

ui.restartButton.addEventListener("click", () => {
  state.channel?.push("game:restart", {
    deck_set: ui.deckSelect.value,
    quirk_set: ui.quirkSelect.value || null,
  });
});

ui.copyGameLink.addEventListener("click", async () => {
  const url = ui.gameLink.textContent || "";
  if (!url) return;
  await navigator.clipboard.writeText(url);
  ui.copyGameLink.textContent = "Copied!";
  setTimeout(() => {
    ui.copyGameLink.textContent = "Copy";
  }, 1200);
});

ui.discardCard.addEventListener("click", () => {
  state.channel?.push("game:toggle_discard_quirk", {});
});

ui.discardToHand.addEventListener("click", () => {
  const cardId = state.publicState?.discard_top?.card_id;
  if (!cardId) return;
  state.channel?.push("game:move_card", {
    card_id: cardId,
    from_zone: "discard",
    to_zone: "hand",
  });
});

ui.discardToTable.addEventListener("click", () => {
  const cardId = state.publicState?.discard_top?.card_id;
  if (!cardId) return;
  state.channel?.push("game:move_card", {
    card_id: cardId,
    from_zone: "discard",
    to_zone: "table",
  });
});


const initialGame = new URLSearchParams(window.location.search).get("game");
if (initialGame) {
  ui.codeInput.value = initialGame.toUpperCase();
  setGameLink(initialGame.toUpperCase());
}
