import { Socket } from "phoenix";

type DeckOption = { name: string };

type CardFace = {
  title?: string | null;
  body?: string | null;
  image?: string | null;
};

type CardType = "fish" | "quirk";

type CardView = {
  card_id: string;
  type: CardType;
  face: CardFace | null;
  face_state?: "up" | "down";
  played_by?: string;
};

type TableRow = {
  player_id: string;
  cards: CardView[];
};

type DiscardTop = {
  card_id: string;
  type: CardType;
  face: CardFace | null;
};

type PublicState = {
  code: string;
  deck_set: string | null;
  quirk_set: string | null;
  deck_back_image: string | null;
  fish_deck_count: number;
  quirk_deck_count: number;
  fish_discard_count: number;
  quirk_discard_count: number;
  fish_discard_top: DiscardTop | null;
  quirk_discard_top: DiscardTop | null;
  table: TableRow[];
  players: { id: string; name: string; fish_hand_count: number; quirk_hand_count: number; connected: boolean }[];
  available_decks: { cards: DeckOption[]; quirks: DeckOption[] };
};

type PrivateState = {
  player_id: string;
  fish_hand: CardView[];
  quirk_hand: CardView[];
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
  zone: null as "hand" | "table" | "fish_discard" | "quirk_discard" | null,
  cardId: "",
  lastIndex: 0,
};

const dragState = {
  active: false,
  cardId: "",
  fromZone: null as "hand" | "table" | "discard" | "deck" | null,
  fromDeck: null as "fish" | "quirk" | null,
  pendingDiscardDraw: null as "fish" | "quirk" | null, // Track if we need to move drawn card to discard
};

type LayoutConfig = {
  cardHeightR: number;
  cardTextScale: number;
  handCenterR: number;
  handDistanceR: number;
  handAngle: number;
  quirkOffsetR: number;
  pileUpR: number;
  pileGapR: number;
  pileScale: number;
  tableRowR: number;
  tableCardGap: number;
  tableCircle: number;
};

const DEFAULT_LAYOUT: LayoutConfig = {
  cardHeightR: 0.28,
  cardTextScale: 1,
  handCenterR: 0,
  handDistanceR: 1,
  handAngle: 8,
  quirkOffsetR: 0.18,
  pileUpR: 0.7,
  pileGapR: 0.9,
  pileScale: 0.75,
  tableRowR: 0,
  tableCardGap: 0.6,
  tableCircle: 1,
};

const layoutConfig = () => {
  return {
    cardHeightR: Number(ui.cardHeightR.value || DEFAULT_LAYOUT.cardHeightR),
    cardTextScale: Number(ui.cardTextScale.value || DEFAULT_LAYOUT.cardTextScale),
    handCenterR: Number(ui.handCenterR.value || DEFAULT_LAYOUT.handCenterR),
    handDistanceR: Number(ui.handDistanceR.value || DEFAULT_LAYOUT.handDistanceR),
    handAngle: Number(ui.handAngle.value || DEFAULT_LAYOUT.handAngle),
    quirkOffsetR: Number(ui.quirkOffsetR.value || DEFAULT_LAYOUT.quirkOffsetR),
    pileUpR: Number(ui.pileUpR.value || DEFAULT_LAYOUT.pileUpR),
    pileGapR: Number(ui.pileGapR.value || DEFAULT_LAYOUT.pileGapR),
    pileScale: Number(ui.pileScale.value || DEFAULT_LAYOUT.pileScale),
    tableRowR: Number(ui.tableRowR.value || DEFAULT_LAYOUT.tableRowR),
    tableCardGap: Number(ui.tableCardGap.value || DEFAULT_LAYOUT.tableCardGap),
    tableCircle: ui.tableCircle.checked ? 1 : 0,
  };
};

const updateLayoutLabels = () => {
  const cfg = layoutConfig();
  ui.cardHeightRValue.textContent = cfg.cardHeightR.toFixed(2);
  ui.cardTextScaleValue.textContent = cfg.cardTextScale.toFixed(2);
  ui.handCenterRValue.textContent = cfg.handCenterR.toFixed(2);
  ui.handDistanceRValue.textContent = cfg.handDistanceR.toFixed(2);
  ui.handAngleValue.textContent = String(cfg.handAngle);
  ui.quirkOffsetRValue.textContent = cfg.quirkOffsetR.toFixed(2);
  ui.pileUpRValue.textContent = cfg.pileUpR.toFixed(2);
  ui.pileGapRValue.textContent = cfg.pileGapR.toFixed(2);
  ui.pileScaleValue.textContent = cfg.pileScale.toFixed(2);
  ui.tableRowRValue.textContent = cfg.tableRowR.toFixed(2);
  ui.tableCardGapValue.textContent = cfg.tableCardGap.toFixed(2);
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
    `  --card-text-scale: ${cfg.cardTextScale};`,
    `  --hand-center-r: ${cfg.handCenterR};`,
    `  --hand-distance-r: ${cfg.handDistanceR};`,
    `  --hand-angle: ${cfg.handAngle};`,
    `  --quirk-offset-r: ${cfg.quirkOffsetR};`,
    `  --pile-up-r: ${cfg.pileUpR};`,
    `  --pile-gap-r: ${cfg.pileGapR};`,
    `  --pile-scale: ${cfg.pileScale};`,
    `  --table-row-r: ${cfg.tableRowR};`,
    `  --table-card-gap: ${cfg.tableCardGap};`,
    `  --table-circle: ${cfg.tableCircle};`,
    "}",
    "",
  ].join("\\n");
};

const loadLayout = () => {
  const cfg = {
    cardHeightR: readVar("--card-height-r", DEFAULT_LAYOUT.cardHeightR),
    cardTextScale: readVar("--card-text-scale", DEFAULT_LAYOUT.cardTextScale),
    handCenterR: readVar("--hand-center-r", DEFAULT_LAYOUT.handCenterR),
    handDistanceR: readVar("--hand-distance-r", DEFAULT_LAYOUT.handDistanceR),
    handAngle: readVar("--hand-angle", DEFAULT_LAYOUT.handAngle),
    quirkOffsetR: readVar("--quirk-offset-r", DEFAULT_LAYOUT.quirkOffsetR),
    pileUpR: readVar("--pile-up-r", DEFAULT_LAYOUT.pileUpR),
    pileGapR: readVar("--pile-gap-r", DEFAULT_LAYOUT.pileGapR),
    pileScale: readVar("--pile-scale", DEFAULT_LAYOUT.pileScale),
    tableRowR: readVar("--table-row-r", DEFAULT_LAYOUT.tableRowR),
    tableCardGap: readVar("--table-card-gap", DEFAULT_LAYOUT.tableCardGap),
    tableCircle: readVar("--table-circle", DEFAULT_LAYOUT.tableCircle),
  };
  ui.cardHeightR.value = String(cfg.cardHeightR);
  ui.cardTextScale.value = String(cfg.cardTextScale);
  ui.handCenterR.value = String(cfg.handCenterR);
  ui.handDistanceR.value = String(cfg.handDistanceR);
  ui.handAngle.value = String(cfg.handAngle);
  ui.quirkOffsetR.value = String(cfg.quirkOffsetR);
  ui.pileUpR.value = String(cfg.pileUpR);
  ui.pileGapR.value = String(cfg.pileGapR);
  ui.pileScale.value = String(cfg.pileScale);
  ui.tableRowR.value = String(cfg.tableRowR);
  ui.tableCardGap.value = String(cfg.tableCardGap);
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
  fishDeckCount: document.getElementById("deck-count") as HTMLSpanElement,
  fishDiscardCount: document.getElementById("discard-count") as HTMLSpanElement,
  fishDiscardCard: document.getElementById("discard-card") as HTMLButtonElement,
  quirkDeckCount: document.getElementById("quirk-deck-count") as HTMLSpanElement,
  quirkDiscardCount: document.getElementById("quirk-discard-count") as HTMLSpanElement,
  quirkDiscardCard: document.getElementById("quirk-discard-card") as HTMLButtonElement,
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
  drawFishButton: document.getElementById("draw-card") as HTMLButtonElement,
  drawQuirkButton: document.getElementById("draw-quirk-card") as HTMLButtonElement,
  shuffleDiscardButton: document.getElementById("shuffle-discard") as HTMLButtonElement,
  shuffleQuirkDiscardButton: document.getElementById("shuffle-quirk-discard") as HTMLButtonElement,
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
  cardTextScale: document.getElementById("card-text-scale") as HTMLInputElement,
  quirkOffsetR: document.getElementById("quirk-offset-r") as HTMLInputElement,
  tableRowR: document.getElementById("table-row-r") as HTMLInputElement,
  tableCardGap: document.getElementById("table-card-gap") as HTMLInputElement,
  handCenterRValue: document.getElementById("hand-center-r-value") as HTMLSpanElement,
  handDistanceRValue: document.getElementById("hand-distance-r-value") as HTMLSpanElement,
  handAngleValue: document.getElementById("hand-angle-value") as HTMLSpanElement,
  cardHeightRValue: document.getElementById("card-height-r-value") as HTMLSpanElement,
  cardTextScaleValue: document.getElementById("card-text-scale-value") as HTMLSpanElement,
  quirkOffsetRValue: document.getElementById("quirk-offset-r-value") as HTMLSpanElement,
  tableRowRValue: document.getElementById("table-row-r-value") as HTMLSpanElement,
  tableCardGapValue: document.getElementById("table-card-gap-value") as HTMLSpanElement,
  pileUpR: document.getElementById("pile-up-r") as HTMLInputElement,
  pileGapR: document.getElementById("pile-gap-r") as HTMLInputElement,
  pileScale: document.getElementById("pile-scale") as HTMLInputElement,
  pileUpRValue: document.getElementById("pile-up-r-value") as HTMLSpanElement,
  pileGapRValue: document.getElementById("pile-gap-r-value") as HTMLSpanElement,
  pileScaleValue: document.getElementById("pile-scale-value") as HTMLSpanElement,
  deckPile: document.getElementById("deck-pile") as HTMLDivElement,
  discardPile: document.getElementById("discard-pile") as HTMLDivElement,
  quirkDeckPile: document.getElementById("quirk-deck-pile") as HTMLDivElement,
  quirkDiscardPile: document.getElementById("quirk-discard-pile") as HTMLDivElement,
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
    const oldFishHand = state.privateState?.fish_hand || [];
    const oldQuirkHand = state.privateState?.quirk_hand || [];
    const oldFishIds = new Set(oldFishHand.map((c: any) => c.card_id));
    const oldQuirkIds = new Set(oldQuirkHand.map((c: any) => c.card_id));
    state.privateState = payload.private_state;
    const newFishHand = state.privateState?.fish_hand || [];
    const newQuirkHand = state.privateState?.quirk_hand || [];
    
    // If we have a pending discard draw, find the newly added card and move it to discard
    if (dragState.pendingDiscardDraw) {
      const deck = dragState.pendingDiscardDraw;
      const newHand = deck === "fish" ? newFishHand : newQuirkHand;
      const oldIds = deck === "fish" ? oldFishIds : oldQuirkIds;
      const newCard = newHand.find((c: any) => !oldIds.has(c.card_id));
      if (newCard) {
        dragState.pendingDiscardDraw = null;
        // Move the newly drawn card to discard
        state.channel?.push("game:move_card", {
          card_id: newCard.card_id,
          from_zone: "hand",
          to_zone: "discard",
        });
      } else {
        // If we can't find the new card, reset the flag to prevent infinite waiting
        dragState.pendingDiscardDraw = null;
      }
    }
    
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

const getZoneCards = (zone: typeof modalState.zone) => {
  if (zone === "hand") return [...(state.privateState?.fish_hand || []), ...(state.privateState?.quirk_hand || [])];
  if (zone === "table") {
    const rows = state.publicState?.table || [];
    return rows.flatMap((row) => row.cards || []);
  }
  if (zone === "fish_discard") return state.publicState?.fish_discard_top ? [state.publicState.fish_discard_top] : [];
  if (zone === "quirk_discard") return state.publicState?.quirk_discard_top ? [state.publicState.quirk_discard_top] : [];
  return [];
};

const renderModalCard = (
  zone: NonNullable<typeof modalState.zone>,
  card: any,
  backImage: string | null
) => {
  const wrap = document.createElement("div");
  wrap.className = "card modal-card";

  const face = document.createElement("div");
  face.className = "card-face";

  const isTableFaceDown = zone === "table" && card?.face_state === "down";

  if (isTableFaceDown) {
    wrap.classList.add("face-down");
    if (backImage) {
      const img = document.createElement("img");
      img.className = "card-image card-back-image";
      img.alt = "Face down";
      img.src = backImage;
      face.appendChild(img);
    } else {
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = "Face down";
      face.appendChild(title);
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
    if (modalState.zone === "table") {
      modalCard.onclick = () => {
        state.channel?.push("game:flip_table_card", { card_id: modalState.cardId });
      };
    }
  }

  const prevVisible = modalState.zone !== "fish_discard" && modalState.zone !== "quirk_discard";
  ui.cardModalPrev.classList.toggle("hidden", !prevVisible);
  ui.cardModalNext.classList.toggle("hidden", !prevVisible);
  ui.cardModalPrev.disabled = !prevVisible || cards.length <= 1;
  ui.cardModalNext.disabled = !prevVisible || cards.length <= 1;

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
  } else if (modalState.zone === "fish_discard" || modalState.zone === "quirk_discard") {
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

const openCardModal = (zone: NonNullable<typeof modalState.zone>, cardId: string) => {
  modalState.zone = zone;
  modalState.cardId = cardId;
  const cards = getZoneCards(zone);
  const index = cards.findIndex((card: any) => card.card_id === cardId);
  modalState.lastIndex = index >= 0 ? index : 0;
  setCardModalOpen(true);
  renderCardModal();
};

const renderTableCard = (card: CardView) => {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.draggable = true;
  wrap.dataset.cardId = card.card_id;
  wrap.dataset.fromZone = "table";
  wrap.dataset.cardType = card.type;
  wrap.addEventListener("click", () => openCardModal("table", card.card_id));
  wrap.addEventListener("dragstart", (e) => {
    dragState.active = true;
    dragState.cardId = card.card_id;
    dragState.fromZone = "table";
    wrap.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.card_id);
    }
  });
  wrap.addEventListener("dragend", () => {
    dragState.active = false;
    dragState.cardId = "";
    dragState.fromZone = null;
    dragState.fromDeck = null;
    wrap.classList.remove("dragging");
    document.querySelectorAll(".drop-zone").forEach((zone) => {
      zone.classList.remove("drag-over");
    });
  });

  const face = document.createElement("div");
  face.className = "card-face";

  const isFaceDown = card.face_state === "down";
  const backImage = state.publicState?.deck_back_image || null;
  if (isFaceDown) {
    wrap.classList.add("face-down");
    if (backImage) {
      const img = document.createElement("img");
      img.className = "card-image card-back-image";
      img.alt = "Face down";
      img.src = backImage;
      face.appendChild(img);
    } else {
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = "Face down";
      face.appendChild(title);
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
  }

  wrap.appendChild(face);
  return wrap;
};

const renderHandCard = (card: CardView) => {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.draggable = true;
  wrap.dataset.cardId = card.card_id;
  wrap.dataset.fromZone = "hand";
  wrap.dataset.cardType = card.type;
  wrap.addEventListener("click", () => openCardModal("hand", card.card_id));
  wrap.addEventListener("dragstart", (e) => {
    dragState.active = true;
    dragState.cardId = card.card_id;
    dragState.fromZone = "hand";
    wrap.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.card_id);
    }
  });
  wrap.addEventListener("dragend", () => {
    dragState.active = false;
    dragState.cardId = "";
    dragState.fromZone = null;
    dragState.fromDeck = null;
    wrap.classList.remove("dragging");
    document.querySelectorAll(".drop-zone").forEach((zone) => {
      zone.classList.remove("drag-over");
    });
  });

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
  wrap.appendChild(face);
  return wrap;
};

const render = () => {
  if (!state.publicState) return;

  // Update drop zone positions when layout changes
  if ((window as any).updateTableDropZone) {
    (window as any).updateTableDropZone();
  }
  if ((window as any).updateHandDropZone) {
    (window as any).updateHandDropZone();
  }

  ui.fishDeckCount.textContent = String(state.publicState.fish_deck_count);
  ui.fishDiscardCount.textContent = String(state.publicState.fish_discard_count);
  ui.quirkDeckCount.textContent = String(state.publicState.quirk_deck_count);
  ui.quirkDiscardCount.textContent = String(state.publicState.quirk_discard_count);

  const fishDrawLabel = ui.drawFishButton.querySelector(".pile-card-label");
  if (state.publicState.deck_back_image) {
    ui.drawFishButton.style.backgroundImage = `url(${state.publicState.deck_back_image})`;
    ui.drawFishButton.classList.add("has-image");
    if (fishDrawLabel) {
      fishDrawLabel.textContent = "";
    }
  } else {
    ui.drawFishButton.style.backgroundImage = "";
    ui.drawFishButton.classList.remove("has-image");
    if (fishDrawLabel) {
      fishDrawLabel.textContent = "Fish";
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
      el.textContent = `${player.name}: ${player.fish_hand_count} Fish, ${player.quirk_hand_count} Quirks${player.connected ? "" : " (offline)"}`;

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
  const me = players.find((p) => p.id === state.playerId);
  ui.playersCompact.innerHTML = "";
  if (me) {
    const summary = document.createElement("div");
    summary.className = "players-compact-summary";
    summary.textContent = `${me.name}: ${me.fish_hand_count} Fish, ${me.quirk_hand_count} Quirks`;
    ui.playersCompact.appendChild(summary);
  }

  const playersById = new Map(state.publicState.players.map((p) => [p.id, p]));
  const tableRows = state.publicState.table || [];
  ui.table.innerHTML = "";
  tableRows.forEach((row) => {
    const rowWrap = document.createElement("div");
    rowWrap.className = "table-row";

    const label = document.createElement("div");
    label.className = "table-row-label";
    const player = playersById.get(row.player_id);
    label.textContent = player ? player.name : row.player_id;

    const cardsWrap = document.createElement("div");
    cardsWrap.className = "table-row-cards";
    row.cards.forEach((card) => cardsWrap.appendChild(renderTableCard(card)));

    rowWrap.appendChild(label);
    rowWrap.appendChild(cardsWrap);
    ui.table.appendChild(rowWrap);
  });

  // Center rows when they fit; fall back to left alignment when they overflow so the first card is visible.
  requestAnimationFrame(() => {
    ui.table.querySelectorAll(".table-row-cards").forEach((el) => {
      const rowEl = el as HTMLElement;
      const overflowing = rowEl.scrollWidth > rowEl.clientWidth + 1;
      rowEl.classList.toggle("overflowing", overflowing);
    });
  });

    ui.tableOverflow.classList.remove("show");
    ui.tableOverflow.textContent = "";

  const renderDiscard = (btn: HTMLButtonElement, top: DiscardTop | null, zone: "fish_discard" | "quirk_discard") => {
    btn.dataset.cardId = "";
    btn.innerHTML = `<span class="pile-card-label">Empty</span>`;
    btn.draggable = false;
    btn.classList.remove("render-as-card");
    if (!top) return;

    btn.dataset.cardId = top.card_id;
    btn.dataset.fromZone = "discard";
    btn.dataset.cardType = top.type;
    btn.draggable = true;
    btn.innerHTML = "";
    // Render discard top using the same card face structure as hand/table.
    btn.classList.add("render-as-card");
    const face = document.createElement("div");
    face.className = "card-face";
    const titleText = cardTitle(top.face);
    const bodyText = cardBody(top.face);
    const hasImage = Boolean(top.face?.image);
    if (titleText || !hasImage) {
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = titleText || "Card";
      face.appendChild(title);
    }
    if (top.face?.image) {
      const img = document.createElement("img");
      img.className = "card-image";
      img.alt = titleText || "Card";
      img.src = top.face.image;
      face.appendChild(img);
    }
    if (bodyText) {
      const body = document.createElement("div");
      body.className = "card-body";
      body.textContent = bodyText;
      face.appendChild(body);
    }
    btn.appendChild(face);
    // Clicking opens fullscreen modal for the discard top
    btn.onclick = () => openCardModal(zone, top.card_id);
  };

  renderDiscard(ui.fishDiscardCard, state.publicState.fish_discard_top, "fish_discard");
  renderDiscard(ui.quirkDiscardCard, state.publicState.quirk_discard_top, "quirk_discard");

  ui.hand.innerHTML = "";
  if (state.privateState) {
    const combined = [...state.privateState.fish_hand, ...state.privateState.quirk_hand];
    combined.forEach((card) => ui.hand.appendChild(renderHandCard(card)));
  }

  const layoutHand = (container: HTMLElement, centerR: number, distanceR: number) => {
    const cards = Array.from(container.children) as HTMLElement[];
    const count = cards.length;
    if (count <= 0) return;
    const boardRect = ui.board.getBoundingClientRect();
    const cfg = layoutConfig();
    const spacing = (cfg.handAngle * Math.PI) / 180;
    const start = -Math.PI / 2 - spacing * ((count - 1) / 2);
    const r = boardRect.width * 0.48;
    const cx = boardRect.width / 2;
    const cy = boardRect.height / 2 - centerR * r;
    const radius = distanceR * r;

    cards.forEach((card, index) => {
      const angle = start + spacing * index;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      const rotate = (angle * 180) / Math.PI + 90;
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      card.style.transform = `translate(-50%, -50%) rotate(${rotate}deg)`;
      card.style.zIndex = String(20 + index);
    });
  };

  const cfg = layoutConfig();
  layoutHand(ui.hand, cfg.handCenterR, cfg.handDistanceR);



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
  // Place all piles on one row: fish deck, fish discard, quirk deck, quirk discard.
  const gap = edgeGap * 0.35 + pileWidth;
  const left0 = centerX - 1.5 * gap;
  const tops = `${centerY}px`;

  ui.deckPile.style.left = `${left0 + 0 * gap}px`;
  ui.deckPile.style.top = tops;
  ui.discardPile.style.left = `${left0 + 1 * gap}px`;
  ui.discardPile.style.top = tops;
  ui.discardPile.style.right = "auto";
  ui.quirkDeckPile.style.left = `${left0 + 2 * gap}px`;
  ui.quirkDeckPile.style.top = tops;
  ui.quirkDiscardPile.style.left = `${left0 + 3 * gap}px`;
  ui.quirkDiscardPile.style.top = tops;
  ui.quirkDiscardPile.style.right = "auto";

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
  applyLayoutVar("--card-text-scale", cfg.cardTextScale);
  applyLayoutVar("--hand-center-r", cfg.handCenterR);
  applyLayoutVar("--hand-distance-r", cfg.handDistanceR);
  applyLayoutVar("--hand-angle", cfg.handAngle);
  applyLayoutVar("--quirk-offset-r", cfg.quirkOffsetR);
  applyLayoutVar("--pile-up-r", cfg.pileUpR);
  applyLayoutVar("--pile-gap-r", cfg.pileGapR);
  applyLayoutVar("--pile-scale", cfg.pileScale);
  applyLayoutVar("--table-row-r", cfg.tableRowR);
  applyLayoutVar("--table-card-gap", cfg.tableCardGap);
  applyLayoutVar("--table-circle", cfg.tableCircle);
  render();
};

ui.handCenterR.addEventListener("input", rerenderHand);
ui.handDistanceR.addEventListener("input", rerenderHand);
ui.handAngle.addEventListener("input", rerenderHand);
ui.cardHeightR.addEventListener("input", rerenderHand);
ui.cardTextScale.addEventListener("input", rerenderHand);
ui.quirkOffsetR.addEventListener("input", rerenderHand);
ui.pileUpR.addEventListener("input", rerenderHand);
ui.pileGapR.addEventListener("input", rerenderHand);
ui.pileScale.addEventListener("input", rerenderHand);
ui.tableRowR.addEventListener("input", rerenderHand);
ui.tableCardGap.addEventListener("input", rerenderHand);
ui.tableCircle.addEventListener("input", rerenderHand);


// Removed single-click draw - use drag and drop instead
// ui.drawButton.addEventListener("click", () => {
//   state.channel?.push("game:draw", { to_zone: "hand" });
// });

ui.shuffleDiscardButton.addEventListener("click", () => {
  state.channel?.push("game:shuffle_discard_into_deck", {});
});

ui.shuffleQuirkDiscardButton.addEventListener("click", () => {
  state.channel?.push("game:shuffle_quirk_discard_into_deck", {});
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
  const playersById = new Map(state.publicState.players.map((p) => [p.id, p]));
  const cards = state.publicState.table.flatMap((row) => row.cards || []);
  cards.forEach((card) => {
    const el = renderTableCard(card);
    const playedBy = card.played_by ? playersById.get(card.played_by)?.name || card.played_by : "";
    if (playedBy) {
      const badge = document.createElement("div");
      badge.className = "played-by-badge";
      badge.textContent = playedBy;
      el.appendChild(badge);
    }
    ui.tableModalCards.appendChild(el);
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
  if (cards.length === 0) return;
  const resolvedIndex = index >= 0 ? index : Math.min(modalState.lastIndex, cards.length - 1);
  const nextIndex = (resolvedIndex - 1 + cards.length) % cards.length;
  modalState.cardId = cards[nextIndex].card_id;
  modalState.lastIndex = nextIndex;
  renderCardModal();
});

ui.cardModalNext.addEventListener("click", () => {
  if (!modalState.zone) return;
  const cards = getZoneCards(modalState.zone);
  const index = cards.findIndex((card: any) => card.card_id === modalState.cardId);
  if (cards.length === 0) return;
  const resolvedIndex = index >= 0 ? index : Math.min(modalState.lastIndex, cards.length - 1);
  const nextIndex = (resolvedIndex + 1) % cards.length;
  modalState.cardId = cards[nextIndex].card_id;
  modalState.lastIndex = nextIndex;
  renderCardModal();
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

const setupDropZones = () => {
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    const target = e.currentTarget as HTMLElement;
    target.classList.add("drag-over");
  };

  const handleDragLeave = (e: DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.classList.remove("drag-over");
  };

  const handleDrop = (e: DragEvent, toZone: "hand" | "table" | "discard") => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.classList.remove("drag-over");

    if (!dragState.active || !dragState.fromZone || !dragState.cardId) {
      return;
    }

    const fromZone = dragState.fromZone;
    const cardId = dragState.cardId;

    // Special case: dragging from deck - draw a card
    if (fromZone === "deck") {
      const deck = dragState.fromDeck || "fish";
      if (toZone === "table" || toZone === "hand") {
        state.channel?.push("game:draw", { deck, to_zone: toZone });
      } else if (toZone === "discard") {
        // For deck to discard: draw to hand first, then move to discard after state updates
        dragState.pendingDiscardDraw = deck;
        state.channel?.push("game:draw", { deck, to_zone: "hand" });
      }
      return;
    }

    // Special case: dragging a table card back onto the table flips it.
    if (fromZone === "table" && toZone === "table") {
      state.channel?.push("game:flip_table_card", { card_id: cardId });
      return;
    }

    // Don't move if same zone (except table→table which is handled above)
    if (fromZone === toZone) {
      return;
    }

  state.channel?.push("game:move_card", {
    card_id: cardId,
      from_zone: fromZone,
      to_zone: toZone,
    });
  };

  // Setup hand drop zone. Hand is an absolute overlay; size it so it stops above the piles.
  const updateHandDropZone = () => {
    if (!ui.deckPile || !ui.discardPile || !ui.quirkDeckPile || !ui.quirkDiscardPile) return;
    const pileRects = [
      ui.deckPile.getBoundingClientRect(),
      ui.discardPile.getBoundingClientRect(),
      ui.quirkDeckPile.getBoundingClientRect(),
      ui.quirkDiscardPile.getBoundingClientRect(),
    ];
    const pilesTop = Math.min(...pileRects.map((r) => r.top));

    const handRect = ui.hand.getBoundingClientRect();
    const newHeight = pilesTop - handRect.top;
    ui.hand.style.height = `${Math.max(50, newHeight)}px`;
  };

  const setupHandZone = (handEl: HTMLDivElement) => {
    const handHandleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
      handEl.classList.add("drag-over");
    };

    const handHandleDragLeave = (e: DragEvent) => {
      e.stopPropagation();
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (!relatedTarget || !handEl.contains(relatedTarget)) {
        handEl.classList.remove("drag-over");
      }
    };

    const handHandleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handEl.classList.remove("drag-over");
      handleDrop(e, "hand");
    };

    handEl.style.pointerEvents = "auto";
    handEl.classList.add("drop-zone");
    handEl.addEventListener("dragover", handHandleDragOver);
    handEl.addEventListener("dragleave", handHandleDragLeave);
    handEl.addEventListener("drop", handHandleDrop);
  };

  setupHandZone(ui.hand);

  (window as any).updateHandDropZone = updateHandDropZone;
  updateHandDropZone();
  window.addEventListener("resize", updateHandDropZone);

  // Setup table drop zone - use only the table element, sized for 2 rows of cards
  const updateTableDropZone = () => {
    if (!ui.table) return;
    // Calculate height for 2 rows: (2 × card-height) + (1 × gap)
    // Gap is 0.6rem, convert to pixels using root font size
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const cardHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-height")) || 0;
    const gap = 0.6 * rootFontSize; // 0.6rem in pixels
    const minHeight = cardHeight * 2 + gap;
    if (minHeight > 0) {
      ui.table.style.minHeight = `${minHeight}px`;
    }
  };

  const tableHandleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    ui.table.classList.add("drag-over");
  };

  const tableHandleDragLeave = (e: DragEvent) => {
    e.stopPropagation();
    // Only remove if actually leaving the table element
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !ui.table.contains(relatedTarget)) {
      ui.table.classList.remove("drag-over");
    }
  };

  const tableHandleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ui.table.classList.remove("drag-over");
    handleDrop(e, "table");
  };

  // Setup table element as drop zone
  // Enable pointer events for drop zone (table-zone parent has pointer-events: none in CSS)
  ui.table.style.pointerEvents = "auto";
  ui.table.classList.add("drop-zone");
  ui.table.addEventListener("dragover", tableHandleDragOver);
  ui.table.addEventListener("dragleave", tableHandleDragLeave);
  ui.table.addEventListener("drop", tableHandleDrop);
  
  // Update table drop zone size when layout changes
  (window as any).updateTableDropZone = updateTableDropZone;
  updateTableDropZone();
  window.addEventListener("resize", updateTableDropZone);

  // Setup discard drop zones (fish + quirk)
  [ui.discardPile, ui.quirkDiscardPile].forEach((pile) => {
    pile.classList.add("drop-zone");
    pile.addEventListener("dragover", handleDragOver);
    pile.addEventListener("dragleave", handleDragLeave);
    pile.addEventListener("drop", (e) => handleDrop(e, "discard"));
  });

  const setupDiscardCardDrag = (btn: HTMLButtonElement) => {
    btn.addEventListener("dragstart", (e) => {
      const cardId = btn.dataset.cardId;
      if (!cardId) {
        e.preventDefault();
        return;
      }
      dragState.active = true;
      dragState.cardId = cardId;
      dragState.fromZone = "discard";
      btn.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", cardId);
      }
    });

    btn.addEventListener("dragend", () => {
      dragState.active = false;
      dragState.cardId = "";
      dragState.fromZone = null;
      dragState.fromDeck = null;
      btn.classList.remove("dragging");
      document.querySelectorAll(".drop-zone").forEach((zone) => {
        zone.classList.remove("drag-over");
      });
    });
  };

  setupDiscardCardDrag(ui.fishDiscardCard);
  setupDiscardCardDrag(ui.quirkDiscardCard);

  const setupDeckDrag = (btn: HTMLButtonElement, deck: "fish" | "quirk") => {
    // Make the entire button draggable - CSS will handle pointer-events on children
    btn.draggable = true;
    // Ensure the attribute is present so CSS like `[draggable="true"]` applies reliably.
    btn.setAttribute("draggable", "true");
    btn.dataset.fromZone = "deck";
    btn.style.cursor = "grab";

    btn.addEventListener("dragstart", (e) => {
      dragState.active = true;
      dragState.cardId = "deck";
      dragState.fromZone = "deck";
      dragState.fromDeck = deck;
      btn.classList.add("dragging");
      btn.style.cursor = "grabbing";
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "deck");
      }
    });

    // Prevent text selection on double click (but allow drag)
    btn.addEventListener("mousedown", (e) => {
      if (e.detail > 1) {
        e.preventDefault();
      }
    });

    btn.addEventListener("dragend", () => {
      dragState.active = false;
      dragState.cardId = "";
      dragState.fromZone = null;
      dragState.fromDeck = null;
      btn.classList.remove("dragging");
      btn.style.cursor = "grab";
      document.querySelectorAll(".drop-zone").forEach((zone) => {
        zone.classList.remove("drag-over");
      });
    });
  };

  setupDeckDrag(ui.drawFishButton, "fish");
  setupDeckDrag(ui.drawQuirkButton, "quirk");
};

const initialGame = new URLSearchParams(window.location.search).get("game");
if (initialGame) {
  ui.codeInput.value = initialGame.toUpperCase();
  setGameLink(initialGame.toUpperCase());
}

const setupTouchDrag = () => {
  let touchStartElement: HTMLElement | null = null;
  let touchStartZone: "hand" | "table" | "discard" | "deck" | null = null;
  let touchStartCardId: string | null = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let dragPreview: HTMLElement | null = null;
  let touchDragging = false;
  const DRAG_START_PX = 8;
  const tableZoneEl = document.querySelector(".table-zone") as HTMLElement | null;

  const createDragPreview = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const preview = element.cloneNode(true) as HTMLElement;
    preview.style.position = "fixed";
    preview.style.left = `${rect.left}px`;
    preview.style.top = `${rect.top}px`;
    preview.style.width = `${rect.width}px`;
    preview.style.height = `${rect.height}px`;
    preview.style.pointerEvents = "none";
    preview.style.opacity = "0.7";
    preview.style.zIndex = "10000";
    preview.style.transform = "rotate(0deg)";
    document.body.appendChild(preview);
    return preview;
  };

  const getDropZone = (x: number, y: number): "hand" | "table" | "discard" | null => {
    const handRect = ui.hand.getBoundingClientRect();
    // Use the full visible table area, not just the inner #table cards container.
    const tableRect = (tableZoneEl ?? ui.table).getBoundingClientRect();
    const fishDiscardRect = ui.discardPile.getBoundingClientRect();
    const quirkDiscardRect = ui.quirkDiscardPile.getBoundingClientRect();

    // Hand zone: the single hand overlay
    const inHand = x >= handRect.left && x <= handRect.right && y >= handRect.top && y <= handRect.bottom;
    if (inHand) return "hand";

    // Discard zone: either discard pile
    const inFishDiscard = x >= fishDiscardRect.left && x <= fishDiscardRect.right && y >= fishDiscardRect.top && y <= fishDiscardRect.bottom;
    const inQuirkDiscard = x >= quirkDiscardRect.left && x <= quirkDiscardRect.right && y >= quirkDiscardRect.top && y <= quirkDiscardRect.bottom;
    if (inFishDiscard || inQuirkDiscard) return "discard";

    // Table zone
    if (x >= tableRect.left && x <= tableRect.right && y >= tableRect.top && y <= tableRect.bottom) return "table";

    return null;
  };

  const handleTouchStart = (e: TouchEvent) => {
    // If a second finger comes down while dragging (e.g. scroll/zoom gesture),
    // aggressively cancel the drag so the preview cannot get stranded.
    if ((touchDragging || dragState.active || dragPreview) && e.touches.length > 1) {
      cleanup();
      return;
    }

    const target = e.target as HTMLElement;
    const card = target.closest(".card[draggable='true']") as HTMLElement | null;
    const discardCard =
      (target.closest("#discard-card[draggable='true']") as HTMLElement | null) ||
      (target.closest("#quirk-discard-card[draggable='true']") as HTMLElement | null);
    const drawButton =
      (target.closest("#draw-card[draggable='true']") as HTMLElement | null) ||
      (target.closest("#draw-quirk-card[draggable='true']") as HTMLElement | null);
    
    const element = card || discardCard || drawButton;
    if (!element) return;

    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartElement = element;
    touchDragging = false;
    touchStartCardId =
      element.dataset.cardId || (element.id === "draw-card" || element.id === "draw-quirk-card" ? "deck" : null);
    touchStartZone = (element.dataset.fromZone as "hand" | "table" | "discard" | "deck") || null;
  };

  const handleTouchMove = (e: TouchEvent) => {
    // Multi-touch while dragging typically indicates scroll/zoom; cancel to avoid stuck preview.
    if ((touchDragging || dragState.active || dragPreview) && e.touches.length > 1) {
      cleanup();
      return;
    }

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    // Don't treat taps as drags. This prevents "tap to open modal" from
    // triggering table→table flip on mobile.
    if (!touchDragging) {
      if (!touchStartElement || !touchStartZone || !touchStartCardId) return;
      if (Math.hypot(deltaX, deltaY) < DRAG_START_PX) return;

      touchDragging = true;
      dragState.active = true;
      dragState.cardId = touchStartCardId;
      dragState.fromZone = touchStartZone;
      dragState.fromDeck =
        touchStartElement.id === "draw-quirk-card"
          ? "quirk"
          : touchStartElement.id === "draw-card"
            ? "fish"
            : dragState.fromDeck;
      touchStartElement.classList.add("dragging");
      dragPreview = createDragPreview(touchStartElement);
    }

    if (!dragState.active || !dragPreview) return;

    e.preventDefault();

    dragPreview.style.left = `${touch.clientX - dragPreview.offsetWidth / 2}px`;
    dragPreview.style.top = `${touch.clientY - dragPreview.offsetHeight / 2}px`;

    // Update drop zone highlighting
    document.querySelectorAll(".drop-zone").forEach((zone) => {
      zone.classList.remove("drag-over");
    });

    const dropZone = getDropZone(touch.clientX, touch.clientY);
    if (dropZone) {
      let zoneElement: HTMLElement;
      if (dropZone === "hand") {
        zoneElement = ui.hand;
      } else if (dropZone === "table") {
        zoneElement = ui.table;
      } else {
        // Discard: highlight whichever pile we're over, default fish discard pile.
        const fishRect = ui.discardPile.getBoundingClientRect();
        const inFish =
          touch.clientX >= fishRect.left && touch.clientX <= fishRect.right && touch.clientY >= fishRect.top && touch.clientY <= fishRect.bottom;
        zoneElement = inFish ? ui.discardPile : ui.quirkDiscardPile;
      }
      zoneElement.classList.add("drag-over");
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    // If we never crossed the drag threshold, treat it as a tap and let the
    // normal click handler open the modal (no flip/move side-effects).
    if (!touchDragging) {
      cleanup();
      return;
    }
    if (!dragState.active || !touchStartCardId || !touchStartZone) {
      cleanup();
      return;
    }

    const touch = e.changedTouches[0];
    const dropZone = getDropZone(touch.clientX, touch.clientY);

    if (dropZone && touchStartZone && touchStartCardId) {
      // Special case: dragging from deck - draw a card
      if (touchStartZone === "deck") {
        const deck = dragState.fromDeck || "fish";
        if (dropZone === "table" || dropZone === "hand") {
          state.channel?.push("game:draw", { deck, to_zone: dropZone });
        } else if (dropZone === "discard") {
          // For deck to discard: draw to hand first, then move to discard after state updates
          dragState.pendingDiscardDraw = deck;
          state.channel?.push("game:draw", { deck, to_zone: "hand" });
        }
      }
      else if (touchStartZone === "table" && dropZone === "table") {
        // Table -> table flips on touch devices (mobile browsers often don't fire native DnD).
        state.channel?.push("game:flip_table_card", { card_id: touchStartCardId });
      }
      else if (touchStartZone !== dropZone) {
        // Move card to different zone
        state.channel?.push("game:move_card", {
          card_id: touchStartCardId,
          from_zone: touchStartZone,
          to_zone: dropZone,
        });
      }
    }

    cleanup();
  };

  const cleanup = () => {
    if (dragPreview) {
      dragPreview.remove();
      dragPreview = null;
    }
    if (touchStartElement) {
      touchStartElement.classList.remove("dragging");
    }
    document.querySelectorAll(".drop-zone").forEach((zone) => {
      zone.classList.remove("drag-over");
    });
    dragState.active = false;
    dragState.cardId = "";
    dragState.fromZone = null;
    dragState.fromDeck = null;
    touchStartElement = null;
    touchStartZone = null;
    touchStartCardId = null;
    touchDragging = false;
  };

  // Add touch listeners to the board
  ui.board.addEventListener("touchstart", handleTouchStart, { passive: false });
  ui.board.addEventListener("touchmove", handleTouchMove, { passive: false });
  ui.board.addEventListener("touchend", handleTouchEnd, { passive: false });
  ui.board.addEventListener("touchcancel", cleanup, { passive: false });

  // Defensive cleanup: mobile browsers can drop touchend/cancel during scroll,
  // gesture navigation, losing focus, or other interruptions.
  const cleanupIfDragging = () => {
    if (touchDragging || dragPreview || dragState.active) cleanup();
  };

  window.addEventListener(
    "touchend",
    (e) => {
      if (!touchDragging && !dragPreview && !dragState.active) return;
      handleTouchEnd(e);
    },
    { passive: false, capture: true }
  );
  window.addEventListener("touchcancel", cleanupIfDragging, { passive: true, capture: true });
  window.addEventListener("scroll", cleanupIfDragging, { passive: true, capture: true });
  window.addEventListener("blur", cleanupIfDragging, { passive: true });
  document.addEventListener("visibilitychange", cleanupIfDragging, { passive: true });
};

setupDropZones();
setupTouchDrag();
loadLayout();
