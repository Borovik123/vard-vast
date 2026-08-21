import { WebSocketServer } from "ws";
import crypto from "crypto";

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_SECOND = 180;

const EVENT_FIELDS = Object.freeze({
  // Events without payload must still be registered here; otherwise
  // validateEventData() rejects them before createWsHandlers() sees them.
  startAttack: [],
  clearHold: [], finishEat: [], cancelEat: [],
  start_spear_windup: [], cancel_spear_windup: [],
  tryConnectGame: ["name"], sendMovement: ["movement"], deleteMovement: ["movement"],
  getVisibleCells: ["id"], sendAngle: ["mouseX", "mouseY", "id", "angle"],
  placeBuildable: ["indexX", "indexY", "rotation"], toggleDoor: ["indexX", "indexY"], holdItem: ["slotIndex"],
  throw_spear: ["dirX", "dirY", "originX", "originY"], pickupItem: [],
  inventoryMove: ["from", "to"], inventorySplit: ["slotIndex"], inventoryDrop: ["slotIndex", "dirX", "dirY"],
  craftItem: ["recipeId"], cancelCraft: ["index"], sendChat: ["text"],
  openCampfire: ["indexX", "indexY"], openWorkbench: ["indexX", "indexY"], closeCampfire: [], closeWorkbench: [],
  workbenchCraft: ["indexX", "indexY", "recipeId"], cancelWorkbenchCraft: ["indexX", "indexY", "index"],
  takeWorkbenchItem: ["indexX", "indexY", "index"], addFuel: ["indexX", "indexY"],
  campfireCraft: ["indexX", "indexY", "recipeId"], cancelCampfireCraft: ["indexX", "indexY", "index"],
  takeCampfireItem: ["indexX", "indexY", "index"],
  clanCreate: ["name"], clanRequest: ["clanId"], clanLeave: [], clanDelete: [], clanKick: ["memberId"], clanAccept: [], clanReject: [],
});

function validateEventData(type, data) {
  const fields = EVENT_FIELDS[type];
  if (!fields) return false;
  for (const key of Object.keys(data)) if (!fields.includes(key)) return false;
  if (typeof data.name === "string" && data.name.length > 64) return false;
  if (typeof data.text === "string" && data.text.length > 512) return false;
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (["indexX", "indexY", "rotation", "slotIndex", "from", "to", "index", "mouseX", "mouseY", "angle", "dirX", "dirY", "originX", "originY"].includes(key) && !Number.isFinite(Number(value))) return false;
    if (["movement", "recipeId", "id", "clanId"].includes(key) && typeof value !== "string") return false;
  }
  return true;
}

const ALLOWED_CLIENT_EVENTS = new Set([
  "tryConnectGame", "sendMovement", "deleteMovement", "getVisibleCells", "sendAngle",
  "startAttack", "placeBuildable", "toggleDoor", "holdItem", "clearHold", "finishEat", "cancelEat",
  "start_spear_windup", "cancel_spear_windup", "throw_spear", "pickupItem",
  "inventoryMove", "inventorySplit", "inventoryDrop", "craftItem", "cancelCraft",
  "sendChat", "openCampfire", "openWorkbench", "closeCampfire", "closeWorkbench", "workbenchCraft", "cancelWorkbenchCraft",
  "takeWorkbenchItem", "addFuel", "campfireCraft", "cancelCampfireCraft", "takeCampfireItem",
  "clanCreate", "clanRequest", "clanLeave", "clanDelete", "clanKick", "clanAccept", "clanReject",
]);

export function createWsHub(server) {
  const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

  function send(ws, type, data) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, data }));
  }
  function broadcast(type, data) { for (const client of wss.clients) send(client, type, data); }
  function broadcastExcept(sender, type, data) { for (const client of wss.clients) if (client !== sender) send(client, type, data); }
  function sendToClientId(clientId, type, data) {
    for (const client of wss.clients) if (client.clientId === clientId) { send(client, type, data); return; }
  }

  function onConnection(handler) {
    wss.on("connection", (ws) => {
      ws.clientId = crypto.randomUUID();
      ws._rateWindowStartedAt = performance.now();
      ws._rateCount = 0;
      send(ws, "connected", { id: ws.clientId });
      handler(ws, "connect", {});

      ws.on("message", (raw) => {
        if (raw.length > MAX_MESSAGE_BYTES) return ws.close(1009, "message too large");
        const now = performance.now();
        if (now - ws._rateWindowStartedAt >= 1000) {
          ws._rateWindowStartedAt = now;
          ws._rateCount = 0;
        }
        ws._rateCount += 1;
        if (ws._rateCount > MAX_MESSAGES_PER_SECOND) return;

        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg.type !== "string" || !ALLOWED_CLIENT_EVENTS.has(msg.type)) return;
        const data = msg.data ?? {};
        if (data === null || typeof data !== "object" || Array.isArray(data)) return;
        if (!validateEventData(msg.type, data)) return;
        handler(ws, msg.type, data);
      });
      ws.on("close", () => handler(ws, "disconnect", {}));
    });
  }

  return { send, broadcast, broadcastExcept, sendToClientId, onConnection };
}