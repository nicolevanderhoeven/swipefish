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
  discard_count: number;
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
};

const modalState = {
  open: false,
  zone: null as "hand" | "table" | "discard" | null,
  cardId: "",
  lastIndex: 0,
};

type LayoutConfig = {
  cardHeightR: number;
  handCenterR: number;
  handDistanceR: number;
  handAngle: number;
  quirkOffsetR: number;
  pileUpR: number;
  pileGapR: number;
  pileScale: number;
  tableRowR: number;
  tableCircle: number;
};

const DEFAULT_LAYOUT: LayoutConfig = {
  cardHeightR: 0.28,
  handCenterR: 0,
  handDistanceR: 1,
  handAngle: 8,
  quirkOffsetR: 0.18,
  pileUpR: 0.7,
  pileGapR: 0.9,
  pileScale: 0.75,
  tableRowR: 0,
  tableCircle: 1,
};

const layoutConfig = () => {
  return {
    cardHeightR: Number(ui.cardHeightR.value || DEFAULT_LAYOUT.cardHeightR),
    handCenterR: Number(ui.handCenterR.value || DEFAULT_LAYOUT.handCenterR),
    handDistanceR: Number(ui.handDistanceR.value || DEFAULT_LAYOUT.handDistanceR),
    handAngle: Number(ui.handAngle.value || DEFAULT_LAYOUT.handAngle),
    quirkOffsetR: Number(ui.quirkOffsetR.value || DEFAULT_LAYOUT.quirkOffsetR),
    pileUpR: Number(ui.pileUpR.value || DEFAULT_LAYOUT.pileUpR),
    pileGapR: Number(ui.pileGapR.value || DEFAULT_LAYOUT.pileGapR),
    pileScale: Number(ui.pileScale.value || DEFAULT_LAYOUT.pileScale),
    tableRowR: Number(ui.tableRowR.value || DEFAULT_LAYOUT.tableRowR),
    tableCircle: ui.tableCircle.checked ? 1 : 0,
  };
};

const updateLayoutLabels = () => {
  const cfg = layoutConfig();
  ui.cardHeightRValue.textContent = cfg.cardHeightR.toFixed(2);
  ui.handCenterRValue.textContent = cfg.handCenterR.toFixed(2);
  ui.handDistanceRValue.textContent = cfg.handDistanceR.toFixed(2);
  ui.handAngleValue.textContent = String(cfg.handAngle);
  ui.quirkOffsetRValue.textContent = cfg.quirkOffsetR.toFixed(2);
  ui.pileUpRValue.textContent = cfg.pileUpR.toFixed(2);
  ui.pileGapRValue.textContent = cfg.pileGapR.toFixed(2);
  ui.pileScaleValue.textContent = cfg.pileScale.toFixed(2);
  ui.tableRowRValue.textContent = cfg.tableRowR.toFixed(2);
};

const readVar = (name: string, fallback: number) => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

const applyLayoutVar = (name: string, value: number) => {
  document.documentElement.style.setProperty(name, String(value));
};

const layoutCss = (cfg: LayoutConfig) => {
  return [
    ":root {",
    `  --card-height-r: ${cfg.cardHeightR};`,
    `  --hand-center-r: ${cfg.handCenterR};`,
    `  --hand-distance-r: ${cfg.handDistanceR};`,
    `  --hand-angle: ${cfg.handAngle};`,
    `  --quirk-offset-r: ${cfg.quirkOffsetR};`,
    `  --pile-up-r: ${cfg.pileUpR};`,
    `  --pile-gap-r: ${cfg.pileGapR};`,
    `  --pile-scale: ${cfg.pileScale};`,
    `  --table-row-r: ${cfg.tableRowR};`,
    `  --table-circle: ${cfg.tableCircle};`,
    "}",
    "",
  ].join("\\n");
};

const loadLayout = () => {
  const cfg = {
    cardHeightR: readVar("--card-height-r", DEFAULT_LAYOUT.cardHeightR),
    handCenterR: readVar("--hand-center-r", DEFAULT_LAYOUT.handCenterR),
    handDistanceR: readVar("--hand-distance-r", DEFAULT_LAYOUT.handDistanceR),
    handAngle: readVar("--hand-angle", DEFAULT_LAYOUT.handAngle),
    quirkOffsetR: readVar("--quirk-offset-r", DEFAULT_LAYOUT.quirkOffsetR),
    pileUpR: readVar("--pile-up-r", DEFAULT_LAYOUT.pileUpR),
    pileGapR: readVar("--pile-gap-r", DEFAULT_LAYOUT.pileGapR),
    pileScale: readVar("--pile-scale", DEFAULT_LAYOUT.pileScale),
    tableRowR: readVar("--table-row-r", DEFAULT_LAYOUT.tableRowR),
    tableCircle: readVar("--table-circle", DEFAULT_LAYOUT.tableCircle),
  };
  ui.cardHeightR.value = String(cfg.cardHeightR);
  ui.handCenterR.value = String(cfg.handCenterR);
  ui.handDistanceR.value = String(cfg.handDistanceR);
  ui.handAngle.value = String(cfg.handAngle);
  ui.quirkOffsetR.value = String(cfg.quirkOffsetR);
  ui.pileUpR.value = String(cfg.pileUpR);
  ui.pileGapR.value = String(cfg.pileGapR);
  ui.pileScale.value = String(cfg.pileScale);
  ui.tableRowR.value = String(cfg.tableRowR);
  ui.tableCircle.checked = cfg.tableCircle >= 0.5;
  updateLayoutLabels();
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
  discardCount: document.getElementById("discard-count") as HTMLSpanElement,
  discardCard: document.getElementById("discard-card") as HTMLButtonElement,
  discardToHand: document.getElementById("discard-to-hand") as HTMLButtonElement,
  discardToTable: document.getElementById("discard-to-table") as HTMLButtonElement,
  table: document.getElementById("table") as HTMLDivElement,
  tableOverflow: document.getElementById("table-overflow") as HTMLButtonElement,
  tableModal: document.getElementById("table-modal") as HTMLDivElement,
  tableModalOverlay: document.getElementById("table-modal-overlay") as HTMLDivElement,
  tableModalClose: document.getElementById("table-modal-close") as HTMLButtonElement,
  tableModalCards: document.getElementById("table-modal-cards") as HTMLDivElement,
  hand: document.getElementById("hand") as HTMLDivElement,
  board: document.getElementById("board") as HTMLDivElement,
  cardModal: document.getElementById("card-modal") as HTMLDivElement,
  cardModalOverlay: document.getElementById("card-modal-overlay") as HTMLDivElement,
  cardModalClose: document.getElementById("card-modal-close") as HTMLButtonElement,
  cardModalContent: document.getElementById("card-modal-content") as HTMLDivElement,
  cardModalActions: document.getElementById("card-modal-actions") as HTMLDivElement,
  cardModalPrev: document.getElementById("card-modal-prev") as HTMLButtonElement,
  cardModalNext: document.getElementById("card-modal-next") as HTMLButtonElement,
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
  handCenterR: document.getElementById("hand-center-r") as HTMLInputElement,
  handDistanceR: document.getElementById("hand-distance-r") as HTMLInputElement,
  handAngle: document.getElementById("hand-angle") as HTMLInputElement,
  cardHeightR: document.getElementById("card-height-r") as HTMLInputElement,
  quirkOffsetR: document.getElementById("quirk-offset-r") as HTMLInputElement,
  tableRowR: document.getElementById("table-row-r") as HTMLInputElement,
  handCenterRValue: document.getElementById("hand-center-r-value") as HTMLSpanElement,
  handDistanceRValue: document.getElementById("hand-distance-r-value") as HTMLSpanElement,
  handAngleValue: document.getElementById("hand-angle-value") as HTMLSpanElement,
  cardHeightRValue: document.getElementById("card-height-r-value") as HTMLSpanElement,
  quirkOffsetRValue: document.getElementById("quirk-offset-r-value") as HTMLSpanElement,
  tableRowRValue: document.getElementById("table-row-r-value") as HTMLSpanElement,
  pileUpR: document.getElementById("pile-up-r") as HTMLInputElement,
  pileGapR: document.getElementById("pile-gap-r") as HTMLInputElement,
  pileScale: document.getElementById("pile-scale") as HTMLInputElement,
  pileUpRValue: document.getElementById("pile-up-r-value") as HTMLSpanElement,
  pileGapRValue: document.getElementById("pile-gap-r-value") as HTMLSpanElement,
  pileScaleValue: document.getElementById("pile-scale-value") as HTMLSpanElement,
  deckPile: document.getElementById("deck-pile") as HTMLDivElement,
  discardPile: document.getElementById("discard-pile") as HTMLDivElement,
  tableCircle: document.getElementById("table-circle") as HTMLInputElement,
  layoutCopy: document.getElementById("layout-copy") as HTMLButtonElement,
  layoutDownload: document.getElementById("layout-download") as HTMLButtonElement,
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

const cardTitle = (face: CardFace | null) => face?.title || "";
const cardBody = (face: CardFace | null) => face?.body || "";

const addQuirkBubble = (parent: HTMLElement, quirk: CardFace | null) => {
  if (!quirk) return;
  const text = cardLabel(quirk);
  if (!text) return;
  const bubble = document.createElement("div");
  bubble.className = "quirk-bubble";
  bubble.textContent = text;
  parent.appendChild(bubble);
};

const getZoneCards = (zone: "hand" | "table" | "discard") => {
  if (zone === "hand") {
    return state.privateState?.hand || [];
  }
  if (zone === "table") {
    return state.publicState?.table || [];
  }
  if (zone === "discard") {
    return state.publicState?.discard_top ? [state.publicState.discard_top] : [];
  }
  return [];
};

const renderModalCard = (
  zone: "hand" | "table" | "discard",
  card: any,
  backImage: string | null
) => {
  const wrap = document.createElement("div");
  wrap.className = "card modal-card";

  const face = document.createElement("div");
  face.className = "card-face";

  const faceState = zone === "table" ? card.face_state : "up";
  if (zone === "table" && faceState === "down") {
    if (backImage) {
      const img = document.createElement("img");
      img.className = "card-image";
      img.alt = "Card back";
      img.src = backImage;
      face.appendChild(img);
    } else {
      face.textContent = "Face down";
    }
  } else {
    const faceTitle = cardTitle(card.face);
    const faceBody = cardBody(card.face);
    const hasImage = Boolean(card.face?.image);
    if (card.face?.image) {
      const img = document.createElement("img");
      img.className = "card-image";
      img.alt = faceTitle || "Card";
      img.src = card.face.image;
      face.appendChild(img);
    }
    if (faceTitle || !hasImage) {
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = faceTitle || "Card";
      face.prepend(title);
    }
    if (faceBody) {
      const body = document.createElement("div");
      body.className = "card-body";
      body.textContent = faceBody;
      face.appendChild(body);
    }

    if (zone === "hand") {
      addQuirkBubble(face, card.quirk);
    } else if (zone === "table" && faceState === "quirk") {
      addQuirkBubble(face, card.quirk);
    } else if (zone === "discard" && card.quirk_revealed) {
      addQuirkBubble(face, card.quirk);
    }
  }

  wrap.appendChild(face);
  return wrap;
};

const setCardModalOpen = (open: boolean) => {
  modalState.open = open;
  if (open) {
    ui.cardModal.classList.remove("hidden");
  } else {
    ui.cardModal.classList.add("hidden");
  }
};

const renderCardModal = () => {
  if (!modalState.open || !modalState.zone) return;
  const cards = getZoneCards(modalState.zone);
  if (cards.length === 0) {
    setCardModalOpen(false);
    return;
  }
  const index = cards.findIndex((card: any) => card.card_id === modalState.cardId);
  const resolvedIndex = index >= 0 ? index : Math.min(modalState.lastIndex, cards.length - 1);
  modalState.lastIndex = resolvedIndex;
  if (index < 0) {
    modalState.cardId = cards[resolvedIndex].card_id;
  }

  ui.cardModalContent.innerHTML = "";
  ui.cardModalActions.innerHTML = "";
  ui.cardModalContent.appendChild(
    renderModalCard(modalState.zone, cards[resolvedIndex], state.publicState?.deck_back_image || null)
  );
  const modalCard = ui.cardModalContent.querySelector(".modal-card") as HTMLElement | null;
  if (modalCard) {
    ui.cardModal.style.setProperty("--modal-card-width", `${modalCard.offsetWidth}px`);
  }

  const prevVisible = modalState.zone !== "discard";
  ui.cardModalPrev.classList.toggle("hidden", !prevVisible);
  ui.cardModalNext.classList.toggle("hidden", !prevVisible);
  ui.cardModalPrev.disabled = !prevVisible || resolvedIndex === 0;
  ui.cardModalNext.disabled = !prevVisible || resolvedIndex === cards.length - 1;

  const addAction = (label: string, onClick: () => void) => {
    const button = document.createElement("button");
    button.className = "card-modal-action";
    button.textContent = label;
    button.addEventListener("click", onClick);
    ui.cardModalActions.appendChild(button);
  };

  if (modalState.zone === "hand") {
    addAction("To table", () => {
      state.channel?.push("game:move_card", {
        card_id: cards[resolvedIndex].card_id,
        from_zone: "hand",
        to_zone: "table",
      });
    });
    addAction("To discard", () => {
      state.channel?.push("game:move_card", {
        card_id: cards[resolvedIndex].card_id,
        from_zone: "hand",
        to_zone: "discard",
      });
    });
  } else if (modalState.zone === "table") {
    addAction("Flip", () => {
      state.channel?.push("game:flip_table_card", { card_id: cards[resolvedIndex].card_id });
    });
    addAction("To hand", () => {
      state.channel?.push("game:move_card", {
        card_id: cards[resolvedIndex].card_id,
        from_zone: "table",
        to_zone: "hand",
      });
    });
    addAction("To discard", () => {
      state.channel?.push("game:move_card", {
        card_id: cards[resolvedIndex].card_id,
        from_zone: "table",
        to_zone: "discard",
      });
    });
  } else if (modalState.zone === "discard") {
    addAction("Reveal quirk", () => {
      state.channel?.push("game:toggle_discard_quirk", {});
    });
    addAction("To hand", () => {
      state.channel?.push("game:move_card", {
        card_id: cards[resolvedIndex].card_id,
        from_zone: "discard",
        to_zone: "hand",
      });
    });
    addAction("To table", () => {
      state.channel?.push("game:move_card", {
        card_id: cards[resolvedIndex].card_id,
        from_zone: "discard",
        to_zone: "table",
      });
    });
  }
};

const openCardModal = (zone: "hand" | "table" | "discard", cardId: string) => {
  modalState.zone = zone;
  modalState.cardId = cardId;
  const cards = getZoneCards(zone);
  const index = cards.findIndex((card: any) => card.card_id === cardId);
  modalState.lastIndex = index >= 0 ? index : 0;
  setCardModalOpen(true);
  renderCardModal();
};

const renderTableCard = (card: TableCard, backImage: string | null) => {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.addEventListener("click", () => openCardModal("table", card.card_id));

  const faceButton = document.createElement("button");
  faceButton.className = "card-face";
  faceButton.dataset.cardId = card.card_id;
  faceButton.addEventListener("click", (event) => {
    event.stopPropagation();
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
    const faceTitle = cardTitle(card.face);
    const faceBody = cardBody(card.face);
    const hasImage = Boolean(card.face?.image);
    if (card.face?.image) {
      const img = document.createElement("img");
      img.className = "card-image";
      img.alt = faceTitle || "Card";
      img.src = card.face.image;
      faceButton.appendChild(img);
    }

    if (card.face_state === "up") {
      if (faceTitle || !hasImage) {
        const title = document.createElement("div");
        title.className = "card-title";
        title.textContent = faceTitle || "Card";
        faceButton.prepend(title);
      }
      if (faceBody) {
        const body = document.createElement("div");
        body.className = "card-body";
        body.textContent = faceBody;
        faceButton.appendChild(body);
      }
    } else if (card.face_state === "quirk") {
      if (faceTitle || !hasImage) {
        const title = document.createElement("div");
        title.className = "card-title";
        title.textContent = faceTitle || "Card";
        faceButton.prepend(title);
      }
      if (faceBody) {
        const body = document.createElement("div");
        body.className = "card-body";
        body.textContent = faceBody;
        faceButton.appendChild(body);
      }
      addQuirkBubble(faceButton, card.quirk);
    }
  }

  const actions = document.createElement("div");
  actions.className = "card-actions card-actions-top";

  const toHand = document.createElement("button");
  toHand.textContent = "To hand";
  toHand.addEventListener("click", (event) => {
    event.stopPropagation();
    state.channel?.push("game:move_card", {
      card_id: card.card_id,
      from_zone: "table",
      to_zone: "hand",
    });
  });

  const toDiscard = document.createElement("button");
  toDiscard.textContent = "To discard";
  toDiscard.addEventListener("click", (event) => {
    event.stopPropagation();
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
  wrap.addEventListener("click", () => openCardModal("hand", card.card_id));

  const face = document.createElement("div");
  face.className = "card-face";
  const titleText = cardTitle(card.face);
  const bodyText = cardBody(card.face);
  const hasImage = Boolean(card.face?.image);
  if (titleText || !hasImage) {
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = titleText || "Card";
    face.appendChild(title);
  }

  if (card.face?.image) {
    const img = document.createElement("img");
    img.className = "card-image";
    img.alt = titleText || "Card";
    img.src = card.face.image;
    face.appendChild(img);
  }
  if (bodyText) {
    const body = document.createElement("div");
    body.className = "card-body";
    body.textContent = bodyText;
    face.appendChild(body);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const toTable = document.createElement("button");
  toTable.textContent = "To table";
  toTable.addEventListener("click", (event) => {
    event.stopPropagation();
    state.channel?.push("game:move_card", {
      card_id: card.card_id,
      from_zone: "hand",
      to_zone: "table",
    });
  });

  const toDiscard = document.createElement("button");
  toDiscard.textContent = "To discard";
  toDiscard.addEventListener("click", (event) => {
    event.stopPropagation();
    state.channel?.push("game:move_card", {
      card_id: card.card_id,
      from_zone: "hand",
      to_zone: "discard",
    });
  });

  actions.appendChild(toTable);
  actions.appendChild(toDiscard);

  if (card.quirk) {
    addQuirkBubble(face, card.quirk);
  }
  wrap.appendChild(face);
  wrap.appendChild(actions);
  return wrap;
};

const render = () => {
  if (!state.publicState) return;

  ui.deckCount.textContent = String(state.publicState.deck_count);
  ui.discardCount.textContent = String(state.publicState.discard_count);
  const drawLabel = ui.drawButton.querySelector(".pile-card-label");
  if (state.publicState.deck_back_image) {
    ui.drawButton.style.backgroundImage = `url(${state.publicState.deck_back_image})`;
    ui.drawButton.classList.add("has-image");
    if (drawLabel) {
      drawLabel.textContent = "";
    }
  } else {
    ui.drawButton.style.backgroundImage = "";
    ui.drawButton.classList.remove("has-image");
    if (drawLabel) {
      drawLabel.textContent = "Draw";
    }
  }
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
      const el = document.createElement("div");
      el.className = "player-item";
      if (player.id === state.playerId) {
        el.textContent = `You: ${player.name} (${player.hand_count})${player.connected ? "" : " (offline)"}`;
      } else {
        el.textContent = `${player.name} (${player.hand_count})${player.connected ? "" : " (offline)"}`;
      }

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

  renderPlayers(ui.players, true, false);
  renderPlayers(ui.playersCompact, false, true);

  const tableCards = state.publicState.table;
  const shownCards = tableCards.slice(0, 16);
  ui.table.innerHTML = "";
  shownCards.forEach((card) => {
    const el = renderTableCard(card, state.publicState?.deck_back_image || null);
    ui.table.appendChild(el);
  });
  if (tableCards.length > 16) {
    ui.tableOverflow.classList.add("show");
    ui.tableOverflow.textContent = `View all (${tableCards.length})`;
  } else {
    ui.tableOverflow.classList.remove("show");
    ui.tableOverflow.textContent = "";
  }

  ui.discardCard.dataset.cardId = "";
  ui.discardCard.innerHTML = `<span class="pile-card-label">Empty</span>`;
  ui.discardToHand.disabled = true;
  ui.discardToTable.disabled = true;
  if (state.publicState.discard_top) {
    const discard = state.publicState.discard_top;
    ui.discardCard.dataset.cardId = discard.card_id;
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
      ui.discardCard.innerHTML = `<span class="pile-card-label">Card</span>`;
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

  const handCards = Array.from(ui.hand.children) as HTMLElement[];
  const count = handCards.length;
  if (count > 0) {
    const boardRect = ui.board.getBoundingClientRect();
    const cfg = layoutConfig();
    const centerR = cfg.handCenterR;
    const distanceR = cfg.handDistanceR;
    const spacing = (cfg.handAngle * Math.PI) / 180;
    const start = -Math.PI / 2 - spacing * ((count - 1) / 2);
    const r = boardRect.width * 0.48;
    const cx = boardRect.width / 2;
    const cy = boardRect.height / 2 - centerR * r;
    const radius = distanceR * r;

    handCards.forEach((card, index) => {
      const angle = start + spacing * index;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      const rotate = (angle * 180) / Math.PI + 90;
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      card.style.transform = `translate(-50%, -50%) rotate(${rotate}deg)`;
      card.style.zIndex = String(20 + index);
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

  if (modalState.open) {
    renderCardModal();
  }

  const cfg = layoutConfig();
  updateLayoutLabels();
  const boardRect = ui.board.getBoundingClientRect();
  const r = boardRect.width * 0.48;
  const cardHeight = cfg.cardHeightR * r;
  const cardWidth = cardHeight * (5 / 7);
  const pileHeight = cardHeight * cfg.pileScale;
  const pileWidth = cardWidth * cfg.pileScale;
  document.documentElement.style.setProperty("--card-height", `${cardHeight}px`);
  document.documentElement.style.setProperty("--card-width", `${cardWidth}px`);
  document.documentElement.style.setProperty("--pile-height", `${pileHeight}px`);
  document.documentElement.style.setProperty("--pile-width", `${pileWidth}px`);
  const centerX = boardRect.width / 2;
  const centerY = boardRect.height / 2 - cfg.pileUpR * r;
  const edgeGap = cfg.pileGapR * r;
  const halfGap = (edgeGap + pileWidth) / 2;
  ui.deckPile.style.left = `${centerX - halfGap}px`;
  ui.deckPile.style.top = `${centerY}px`;
  ui.discardPile.style.left = `${centerX + halfGap}px`;
  ui.discardPile.style.top = `${centerY}px`;

  ui.table.style.marginTop = `${-cardHeight / 2 + cfg.tableRowR * r}px`;
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

const rerenderHand = () => {
  const cfg = layoutConfig();
  applyLayoutVar("--card-height-r", cfg.cardHeightR);
  applyLayoutVar("--hand-center-r", cfg.handCenterR);
  applyLayoutVar("--hand-distance-r", cfg.handDistanceR);
  applyLayoutVar("--hand-angle", cfg.handAngle);
  applyLayoutVar("--quirk-offset-r", cfg.quirkOffsetR);
  applyLayoutVar("--pile-up-r", cfg.pileUpR);
  applyLayoutVar("--pile-gap-r", cfg.pileGapR);
  applyLayoutVar("--pile-scale", cfg.pileScale);
  applyLayoutVar("--table-row-r", cfg.tableRowR);
  applyLayoutVar("--table-circle", cfg.tableCircle);
  render();
};

ui.handCenterR.addEventListener("input", rerenderHand);
ui.handDistanceR.addEventListener("input", rerenderHand);
ui.handAngle.addEventListener("input", rerenderHand);
ui.cardHeightR.addEventListener("input", rerenderHand);
ui.quirkOffsetR.addEventListener("input", rerenderHand);
ui.pileUpR.addEventListener("input", rerenderHand);
ui.pileGapR.addEventListener("input", rerenderHand);
ui.pileScale.addEventListener("input", rerenderHand);
ui.tableRowR.addEventListener("input", rerenderHand);
ui.tableCircle.addEventListener("input", rerenderHand);


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

const setTableModalOpen = (open: boolean) => {
  if (open) {
    ui.tableModal.classList.remove("hidden");
  } else {
    ui.tableModal.classList.add("hidden");
  }
};

ui.tableOverflow.addEventListener("click", () => {
  if (!state.publicState) return;
  ui.tableModalCards.innerHTML = "";
  state.publicState.table.forEach((card) => {
    ui.tableModalCards.appendChild(renderTableCard(card, state.publicState?.deck_back_image || null));
  });
  setTableModalOpen(true);
});

ui.tableModalOverlay.addEventListener("click", () => {
  setTableModalOpen(false);
});

ui.tableModalClose.addEventListener("click", () => {
  setTableModalOpen(false);
});

ui.cardModalOverlay.addEventListener("click", () => {
  setCardModalOpen(false);
});

ui.cardModalClose.addEventListener("click", () => {
  setCardModalOpen(false);
});

ui.cardModal.addEventListener("click", (event) => {
  const target = event.target as Element | null;
  if (!target) return;
  if (
    target.closest(".modal-card") ||
    target.closest(".card-modal-actions") ||
    target.closest(".card-modal-nav") ||
    target.closest("#card-modal-close")
  ) {
    return;
  }
  setCardModalOpen(false);
});

ui.cardModalPrev.addEventListener("click", () => {
  if (!modalState.zone) return;
  const cards = getZoneCards(modalState.zone);
  const index = cards.findIndex((card: any) => card.card_id === modalState.cardId);
  if (index > 0) {
    modalState.cardId = cards[index - 1].card_id;
    modalState.lastIndex = index - 1;
    renderCardModal();
  }
});

ui.cardModalNext.addEventListener("click", () => {
  if (!modalState.zone) return;
  const cards = getZoneCards(modalState.zone);
  const index = cards.findIndex((card: any) => card.card_id === modalState.cardId);
  if (index >= 0 && index < cards.length - 1) {
    modalState.cardId = cards[index + 1].card_id;
    modalState.lastIndex = index + 1;
    renderCardModal();
  }
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

ui.layoutCopy.addEventListener("click", async () => {
  const cfg = layoutConfig();
  await navigator.clipboard.writeText(layoutCss(cfg));
  ui.layoutCopy.textContent = "Copied!";
  setTimeout(() => {
    ui.layoutCopy.textContent = "Copy layout CSS";
  }, 1200);
});

ui.layoutDownload.addEventListener("click", async () => {
  const cfg = layoutConfig();
  const response = await fetch("/api/layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!response.ok) {
    showStatus("Failed to save layout CSS", true);
    return;
  }
  showStatus("Layout CSS saved", false);
});

ui.discardCard.addEventListener("click", () => {
  const cardId = ui.discardCard.dataset.cardId;
  if (!cardId) return;
  openCardModal("discard", cardId);
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

loadLayout();
