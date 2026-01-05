const { io } = require("socket.io-client");

const SOCKET_URL = process.env.SOCKET_URL || "http://backend:3000";
const TIMEOUT_MS = 15000;

const waitFor = (socket, event) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), TIMEOUT_MS);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

const connect = (name) =>
  new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL, { transports: ["websocket"], reconnection: true });
    const timer = setTimeout(() => reject(new Error(`timeout: connect ${name}`)), TIMEOUT_MS);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
  });

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const run = async () => {
  const p1 = await connect("p1");
  const p2 = await connect("p2");
  const p3 = await connect("p3");

  const role1 = waitFor(p1, "role-assigned");
  const role2 = waitFor(p2, "role-assigned");
  const role3 = waitFor(p3, "role-assigned");
  const started1 = waitFor(p1, "game-started");
  const started2 = waitFor(p2, "game-started");
  const started3 = waitFor(p3, "game-started");

  p1.emit("create-room", { name: "Player1" });
  const created = await waitFor(p1, "create-room-response");
  if (!created?.success || !created?.passphrase || !created?.room?.room?.id) {
    fail("create-room failed");
  }

  const passphrase = created.passphrase;
  const roomId = created.room.room.id;

  p2.emit("join-room", { passphrase, name: "Player2" });
  p3.emit("join-room", { passphrase, name: "Player3" });
  const joined2 = await waitFor(p2, "join-room-response");
  const joined3 = await waitFor(p3, "join-room-response");
  if (!joined2?.success || !joined3?.success) {
    fail("join-room failed");
  }

  p1.emit("start-game", { roomId });
  const startResponse = await waitFor(p1, "start-game-response");
  if (!startResponse?.success) {
    fail("start-game failed");
  }

  await Promise.all([started1, started2, started3, role1, role2, role3]);

  p1.emit("sync-room-state", { roomId });
  const sync = await waitFor(p1, "room-state-sync");
  const persona = sync?.room?.room?.swiper_persona_name;
  const personaNumber = sync?.room?.room?.swiper_persona_number;
  if (!sync?.success || !persona || !personaNumber) {
    fail("persona not assigned");
  }

  p1.disconnect();
  p2.disconnect();
  p3.disconnect();
  console.log("smoke test passed");
};

run().catch((err) => fail(err.message || String(err)));
