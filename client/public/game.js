class GameSocket {
  constructor() {
    this.id = null;
    this.handlers = {};
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${protocol}//${location.host}`);

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "connected") {
        this.id = msg.data.id;
      }

      if (this.handlers[msg.type]) {
        for (const fn of this.handlers[msg.type]) {
          fn(msg.data);
        }
      }
    };
  }

  on(event, fn) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
  }

  emit(event, data = {}) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: event, data }));
    }
  }
}

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const socket = new GameSocket();
let settings = undefined;

let scale = 1;
let pressingButton = [];
let showDebugHitboxes = false;
const btnPlay = document.getElementById("playGame");
const nickName = document.getElementById("nickName");
const mainDiv = document.getElementById("mainDiv");
const chatPanel = document.getElementById("chatPanel");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatToggleBtn = document.getElementById("chatToggleBtn");
const authorCredits = document.getElementById("authorCredits");
let chatCollapsed = false;
let metricCentre = { x: 0, y: 0 };

let activeCampfire = null;
let campfirePanelOpen = false;
let activeWorkbench = null;
let workbenchPanelOpen = false;
let selectedWorkbenchRecipeIndex = 0;
let temperature = 300;
let maxTemperature = 300;
let campfirePanelRect = null;
let selectedCampfireRecipeIndex = 0;
let campfireQueueUpdateTimer = 0; // для принудительного обновления
const images = {
  player: loadImage("day-skin0.png"),
  rightHand: loadImage("day-right-arm0.png"),
  leftHand: loadImage("day-left-arm0.png"),
  dead: loadImage("day-dead-player.png"),
  hurt: loadImage("hurt-player.png"),
  heal: loadImage("heal-player.png"),
  alert0: loadImage("alert0_0.png"),
  alert1: loadImage("alert0_1.png"),
  alert2: loadImage("alert0_2.png"),
  craftButton: loadImage("craftbox-button-in.png"),
  craftBox: loadImage("craftbox2.png"),
  timer: loadImage("timer.png"),
  timerArrow: loadImage("timer-arrow.png"),
  handBlueberry: loadImage("blueberry0.png"),
  handWildberry: loadImage("wildberry0.png"),
  handCraft: loadImage("day-hand-craft.png"),
  handCraftPencil: loadImage("day-hand-craftpencil.png"),
  spearInv: loadImage("wood-spear.png"),
  spearGround: loadImage("wood-spear-ground.png"),
  spearHand: loadImage("wood-spear-hand.png"),
  eCampfire: loadImage("e-campfire.png"),
  eWorkbench: loadImage("e-workbench.png"),
  eOpenDoor: loadImage("e-opendoor.png"),
  eClosedDoor: loadImage("e-closedoor.png"),
  hatchetHand: loadImage("hatchet-hand.png"),
  pickaxeStoneHand: loadImage("pickaxe-stone-hand.png"),
  hammerHand: loadImage("hammer-hand.png"),
};

const spearAudio = new Audio("/game/media/audio/spear-shot.mp3");

const PARTICLE_SETS = {
  tree: [
    "day-particules-leaf2.png",
    "day-particules-leaf3.png",
    "day-particules-leaf7.png",
    "day-particules-leaftree4.png",
    "day-particules-leaftree5.png",
  ],
  stone: [
    "day-particules-stone1.png",
    "day-particules-stone2.png",
    "day-particules-stone3.png",
  ],
  steel: [
    "day-particules-steel1.png",
    "day-particules-steel2.png",
    "day-particules-steel3.png",
  ],
  sulfur: [
    "day-particules-sulfur1.png",
    "day-particules-sulfur2.png",
    "day-particules-sulfur3.png",
  ],
};

const particleImages = {
  tree: PARTICLE_SETS.tree.map(loadImage),
  stone: PARTICLE_SETS.stone.map(loadImage),
  steel: PARTICLE_SETS.steel.map(loadImage),
  sulfur: PARTICLE_SETS.sulfur.map(loadImage),
};
particleImages.campfireNormal = [...particleImages.tree, ...particleImages.stone];
particleImages.campfireMax = [...particleImages.tree, ...particleImages.steel];

const NATURE_PARTICLE_KIND = {
  tree: "tree",
  blueberry: "tree",
  wildberry: "tree",
  stone: "stone",
  ironOre: "steel",
  sulfur: "sulfur",
  campfire: "campfireNormal",
  workbench: "tree",
};

const hitParticles = [];
const HIT_PARTICLE_COUNT = 5;
const DESTROY_PARTICLE_COUNT = 14;
const PARTICLE_LIFE_HIT_MS = 420;
const PARTICLE_LIFE_DESTROY_MS = 620;

let map_img = {};
let item_img = {};
let toolCatalog = {};
let inventory = Array(8).fill(null);
let leaderboardEntries = [];
let isNight = false;
let nightOverlayAlpha = 0;
let craftOpen = false;
let selectedCraftIndex = 0;
let craftRecipes = [];
let craftLayout = null;
let craftQueueState = { queue: [], max: 4 };
let natureCatalog = [];
const natureDrawLayerById = new Map();

const PLAYER_DRAW_LAYER = 30;
const SAPLING_DRAW_LAYER = 5;
let actionTimer = null;
let heldItemId = null;
let heldSlotIndex = -1;
let satiety = 300;
let maxSatiety = 300;
let energy = 300;
let maxEnergy = 300;
let myScore = 0;
let myLevel = 0;
let myXp = 0;
let myXpNeed = 100;
const resourceFlyAnims = [];
const hiddenGroundUntil = new Map();
let pickupReadyAt = 0;
const PICKUP_COOLDOWN_MS = 50;
const STATION_INTERACTION_COOLDOWN_MS = 300;
const stationInteractionCooldowns = new Map();

const flyingSpears = {};
const spearLandAnims = [];
const spearGroundHideUntil = [];

function canPickupNow() {
  if (workbenchPanelOpen || campfirePanelOpen) return false;
  return performance.now() >= pickupReadyAt;
}

function markPickupSent() {
  pickupReadyAt = performance.now() + PICKUP_COOLDOWN_MS;
}

let invDrag = null;
const INV_DRAG_THRESHOLD = 6;

const localSpear = {
  state: 'none',
  timer: 0,
  pullback: 0,
  distance: 0,
  angle: 0,
  worldX: 0,
  worldY: 0,
  dirX: 0,
  dirY: 0,
  lOffset: 30,
  rOffset: 30,
  endOfAnimation: false,
  animation: false,
  throwOriginX: 0,
  throwOriginY: 0
};

function updateLocalSpear(now) {
  const equipMs = settings?.settings?.SPEAR_EQUIP_MS ?? 1500;
  const windupMs = settings?.settings?.SPEAR_WINDUP_MS ?? 500;
  const dtMs = Math.min(100, Math.max(0, now - (localSpear.lastUpdateAt ?? now)));
  localSpear.lastUpdateAt = now;

  if (localSpear.state === 'equipping') {
    localSpear.timer = Math.min(equipMs, localSpear.timer + dtMs);
    return;
  }

  if (localSpear.state === 'windup') {
    localSpear.timer += dtMs;
    const progress = Math.min(1, localSpear.timer / windupMs);
    if (progress < 0.5) {
      const q = progress / 0.5;
      // Pull the spear hand to the left first.
      localSpear.lOffset = 30 - q * 60;
    } else {
      const q = (progress - 0.5) / 0.5;
      // Then drive it sharply to the right into the launch position.
      localSpear.lOffset = -30 + q * 60;
    }
    // The free hand is slightly to the right throughout the wind-up.
    localSpear.rOffset = 12;

    if (localSpear.timer >= windupMs) {
      const me = application.myPlayer;
      // Aim from the center of the game viewport toward the current pointer.
      // `getAngle` is not part of this client build, so calculate it locally.
      const angle = Math.atan2(
        pointerClientY - metricCentre.y,
        pointerClientX - metricCentre.x
      ) * 180 / Math.PI;
      const rad = angle * Math.PI / 180;

      localSpear.timer = windupMs;
      localSpear.endOfAnimation = true;
      const leftHandX = -images.leftHand.width / 60 + localSpear.lOffset;
      const leftHandY = -(178 / 2);
      const bodyAngle = ((me.angle ?? 0) * Math.PI) / 180;
      const cosA = Math.cos(bodyAngle);
      const sinA = Math.sin(bodyAngle);
      localSpear.throwOriginX = me.renderX + leftHandX * cosA - leftHandY * sinA;
      localSpear.throwOriginY = me.renderY + leftHandX * sinA + leftHandY * cosA;
      localSpear.worldX = localSpear.throwOriginX;
      localSpear.worldY = localSpear.throwOriginY;
      localSpear.angle = angle;
      localSpear.dirX = Math.cos(rad);
      localSpear.dirY = Math.sin(rad);
      localSpear.distance = 0;

      // Important: do not leave the projectile in the hand while waiting
      // for the server packet. The server validates the throw, but the
      // visual state changes exactly at the end of the 500 ms wind-up.
      localSpear.state = 'flying';
      localSpear.lOffset = 0;
      localSpear.rOffset = 0;

      socket.emit('throw_spear', {
        dirX: localSpear.dirX,
        dirY: localSpear.dirY,
        originX: localSpear.throwOriginX,
        originY: localSpear.throwOriginY,
      });
      spearAudio.currentTime = 0;
      spearAudio.play().catch(() => {});
    }
    return;
  }

  // The server continuously sends authoritative projectile positions.
  // Keep the local state here; do not advance it independently.
  if (localSpear.state === 'flying') {
    localSpear.lOffset = 0;
    localSpear.rOffset = 0;
  }
}

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

function loadNatureImages(natureImages) {
  map_img = {};
  if (!natureImages) return;
  for (const [key, file] of Object.entries(natureImages)) {
    map_img[key] = loadImage(file);
  }
}

function loadItemImages(itemImages) {
  item_img = {};
  if (!itemImages) return;
  for (const [key, file] of Object.entries(itemImages)) {
    item_img[key] = loadImage(file);
  }
}

function setInventory(next) {
  const slots = settings?.settings?.INVENTORY_SLOTS ?? 8;
  inventory = Array.from({ length: slots }, (_, i) => {
    const slot = next?.[i];
    return slot ? { itemId: slot.itemId, amount: slot.amount } : null;
  });
  syncLocalHoldFromInventory();
}

function syncLocalHoldFromInventory() {
  if (!heldItemId) return;
  const slot = inventory[heldSlotIndex];
  if (slot?.itemId === heldItemId && slot.amount > 0) return;
  const next = inventory.findIndex(
    (s) => s?.itemId === heldItemId && s.amount > 0
  );
  if (next !== -1) {
    heldSlotIndex = next;
    return;
  }
  if (application.myPlayer?.isEating) return;
  heldItemId = null;
  heldSlotIndex = -1;
  if (actionTimer?.kind === "equip") actionTimer = null;
  
  if (localSpear.state !== 'none' && localSpear.state !== 'landed') {
    localSpear.state = 'none';
    localSpear.timer = 0;
    localSpear.distance = 0;
  }
}

function isHoldingEdible() {
  return isEdibleBerry(heldItemId);
}

function isBuildingItemClient(id) { return ["wood_wall","wood_door","stone_wall","stone_door","metal_wall","metal_door"].includes(id); }
function isInBuildMode(player, isMe = true) {
  const id = isMe ? heldItemId : player?.heldItemId;
  return isBuildSeed(id) || id === "campfire" || id === "campfire_max" || id === "workbench" || isBuildingItemClient(id);
}

function isToolItem(itemId) { return !!itemId && !!(toolCatalog[itemId]?.damage || (itemId === "hatchet" || itemId === "pickaxe_stone" || itemId === "hammer")); }
function getClientToolProfile(itemId) { return toolCatalog[itemId] ?? null; }

function isHoldingSpear(isMe = true) {
  const id = isMe ? heldItemId : null;
  return id === 'spear';
}

let buildReadyAt = 0;
let buildRotation = 0;
let pointerClientX = 0;
let pointerClientY = 0;

function getWorldCellIndex(worldX, worldY) {
  const cellSize = settings?.settings?.CELL_SIDE_LENGTH_PIXEL ?? 200;
  return {
    indexX: Math.floor(worldX / cellSize) + 1,
    indexY: Math.floor(worldY / cellSize) + 1,
  };
}

function canClientBuildOnCell(cell) {
  if (!cell) return false;
  if (cell.sapling?.kind && cell.sapling.hp > 0) return false;
  if (cell.campfire || cell.workbench || cell.building) return false;
  if (cell.natureType && cell.natureType !== "empty" && cell.hp > 0) {
    return false;
  }
  return true;
}

function tryBuildAtScreen(clientX, clientY) {
  if (!isInBuildMode(null, true)) return false;
  if (actionTimer?.kind === "equip") return false;
  const now = performance.now();
  const delay = settings?.settings?.PLANT_DELAY_MS ?? 100;
  if (now < buildReadyAt) return false;

  const world = screenToWorld(clientX, clientY);
  const { indexX, indexY } = getWorldCellIndex(world.x, world.y);
  const playerCell = getWorldCellIndex(
    application.myPlayer.renderX,
    application.myPlayer.renderY
  );
  const px = playerCell.indexX;
  const py = playerCell.indexY;
  const adx = Math.abs(indexX - px);
  const ady = Math.abs(indexY - py);
  if (adx > 1 || ady > 1 || (adx === 0 && ady === 0)) return false;

  const me = application.playersList.list.find((p) => p.id === socket.id);
  const cell = me?.visibleCells?.find(
    (c) => c.indexX === indexX && c.indexY === indexY
  );
  if (!canClientBuildOnCell(cell)) return false;

  buildReadyAt = now + delay;
  setTimeout(() => {
    if (!isInBuildMode(null, true)) return;
    socket.emit("placeBuildable", { indexX, indexY, rotation: buildRotation });
  }, delay);
  return true;
}

function startActionTimer(kind, duration, extra = {}) {
  actionTimer = {
    kind,
    startedAt: performance.now(),
    duration,
    ...extra,
  };
}

function clearActionTimer() {
  actionTimer = null;
}

function isEdibleBerry(itemId) {
  return itemId === "blueberry" || itemId === "wildberry";
}

function isBuildSeed(itemId) {
  return itemId === "blueberrySeed" || itemId === "wildberrySeed";
}

function getHandBerryImage(itemId) {
  if (itemId === "blueberry") return images.handBlueberry;
  if (itemId === "wildberry") return images.handWildberry;
  return null;
}

function getGhostPlantImageKey(seedItemId) {
  if (seedItemId === "blueberrySeed") return "blueberryPlant2";
  if (seedItemId === "wildberrySeed") return "wildberryPlant2";
  return null;
}

function unequipHeldItem() {
  if (application.myPlayer?.isEating || actionTimer?.kind === "eat") {
    cancelLocalEat();
  }
  if (actionTimer?.kind === "equip") clearActionTimer();
  if (localSpear.state !== 'none' && localSpear.state !== 'landed') {
    socket.emit('cancel_spear_windup');
    localSpear.state = 'none';
    localSpear.timer = 0;
    localSpear.pullback = 0;
    localSpear.distance = 0;
    localSpear.rOffset = 30;
    localSpear.lOffset = 30;
  }
  
  heldItemId = null;
  heldSlotIndex = -1;
  clearEatAnimation(application.myPlayer);
  const me = application.playersList.list.find((p) => p.id === socket.id);
  if (me) {
    me.heldItemId = null;
    me.heldSlotIndex = -1;
    clearEatAnimation(me);
  }
  socket.emit("clearHold", {});
}

function tryBeginEquipBerry(slotIndex) {
  const slot = inventory[slotIndex];
  if (!slot || !isEdibleBerry(slot.itemId)) return false;

  if (heldItemId && heldItemId !== slot.itemId) { unequipHeldItem(); }

  if (heldItemId === slot.itemId) {
    unequipHeldItem();
    return true;
  }

  if (actionTimer?.kind === "equip" && actionTimer.slotIndex === slotIndex) {
    clearActionTimer();
    return true;
  }

  const duration = settings?.settings?.EQUIP_FOOD_MS ?? 500;
  startActionTimer("equip", duration, { slotIndex });
  return true;
}

function tryBeginEquipSeed(slotIndex) {
  const slot = inventory[slotIndex];
  if (!slot || !isBuildSeed(slot.itemId)) return false;

  if (heldItemId && heldItemId !== slot.itemId) { unequipHeldItem(); }

  if (heldItemId === slot.itemId) {
    unequipHeldItem();
    return true;
  }

  // Build mode becomes active only after the equip timer finishes.
  if (actionTimer?.kind === "equip" && actionTimer.slotIndex === slotIndex) {
    clearActionTimer();
    return true;
  }

  const duration = settings?.settings?.EQUIP_BUILD_MS ?? 1000;
  startActionTimer("equip", duration, { slotIndex });
  return true;
}

function tryBeginEquipSpear(slotIndex) {
  const slot = inventory[slotIndex];
  if (!slot || slot.itemId !== 'spear') return false;

  if (heldItemId && heldItemId !== 'spear') unequipHeldItem();

  if (heldItemId === slot.itemId && localSpear.state !== 'none' && localSpear.state !== 'flying') {
    unequipHeldItem();
    return true;
  }

  if (actionTimer?.kind === "equip" && actionTimer.slotIndex === slotIndex) {
    clearActionTimer();
    localSpear.state = 'none';
    localSpear.timer = 0;
    localSpear.lOffset = 30;
    localSpear.rOffset = 30;
    return true;
  }

  const duration = settings?.settings?.SPEAR_EQUIP_MS ?? 1500;
  startActionTimer("equip", duration, { slotIndex });
  localSpear.state = 'equipping';
  localSpear.timer = 0;
  localSpear.lOffset = 30;
  localSpear.rOffset = 30;
  localSpear.distance = 0;
  return true;
}

function tryBeginEquipTool(slotIndex) {
  const slot = inventory[slotIndex];
  if (!slot || !isToolItem(slot.itemId)) return false;
  if (heldItemId === slot.itemId) { unequipHeldItem(); return true; }
  if (actionTimer?.kind === "equip" && actionTimer.slotIndex === slotIndex) { clearActionTimer(); return true; }
  if (heldItemId && heldItemId !== slot.itemId) unequipHeldItem();
  const profile = getClientToolProfile(slot.itemId);
  const duration = profile?.equipMs ?? (slot.itemId === "hatchet" ? (settings?.settings?.HATCHET_EQUIP_MS ?? 500) : (settings?.settings?.PICKAXE_STONE_EQUIP_MS ?? 1000));
  startActionTimer("equip", duration, { slotIndex });
  return true;
}

function tryBeginEquipBuilding(slotIndex) {
  const slot=inventory[slotIndex];
  if(!slot||!isBuildingItemClient(slot.itemId))return false;
  if(heldItemId===slot.itemId){unequipHeldItem();return true;}
  if(actionTimer?.kind==="equip"&&actionTimer.slotIndex===slotIndex){clearActionTimer();return true;}
  if(heldItemId)unequipHeldItem();
  startActionTimer("equip",1000,{slotIndex});
  return true;
}

function tryBeginEquipCampfire(slotIndex) {
  const slot = inventory[slotIndex];
  if (!slot || (slot.itemId !== 'campfire' && slot.itemId !== 'campfire_max')) return false;

  if (heldItemId && heldItemId !== slot.itemId) { unequipHeldItem(); }

  if (heldItemId === slot.itemId) {
    unequipHeldItem();
    return true;
  }

  if (actionTimer?.kind === "equip" && actionTimer.slotIndex === slotIndex) {
    clearActionTimer();
    return true;
  }

  const duration = settings?.settings?.EQUIP_BUILD_MS ?? 1000;
  startActionTimer("equip", duration, { slotIndex });
  return true;
}

function tryBeginEquipWorkbench(slotIndex) {
  const slot = inventory[slotIndex];
  if (!slot || slot.itemId !== "workbench") return false;
  if (heldItemId === "workbench") { unequipHeldItem(); return true; }
  if (actionTimer?.kind === "equip" && actionTimer.slotIndex === slotIndex) { clearActionTimer(); return true; }
  if (heldItemId) unequipHeldItem();
  startActionTimer("equip", settings?.settings?.WORKBENCH?.buildTimeMs ?? settings?.settings?.EQUIP_BUILD_MS ?? 1000, { slotIndex });
  return true;
}

function updateActionTimer(now) {
  if (!actionTimer) return;
  if (now - actionTimer.startedAt < actionTimer.duration) return;

  if (actionTimer.kind === "equip") {
    const slotIndex = actionTimer.slotIndex;
    clearActionTimer();
    const slot = inventory[slotIndex];
    if (!slot) return;

    if (isEdibleBerry(slot.itemId) || isBuildSeed(slot.itemId)) {
      heldItemId = slot.itemId;
      heldSlotIndex = slotIndex;
      socket.emit("holdItem", { slotIndex });
    } 
    else if (slot.itemId === 'spear') {
      heldItemId = slot.itemId;
      heldSlotIndex = slotIndex;
      socket.emit("holdItem", { slotIndex });
    }
    else if (slot.itemId === 'campfire' || slot.itemId === 'campfire_max' || slot.itemId === 'workbench' || isToolItem(slot.itemId) || isBuildingItemClient(slot.itemId)) {
      heldItemId = slot.itemId;
      heldSlotIndex = slotIndex;
      socket.emit("holdItem", { slotIndex });
    }
    return;
  }

  if (actionTimer.kind === "eat") {
    clearActionTimer();
    clearEatAnimation(application.myPlayer);
    const me = application.playersList.list.find((p) => p.id === socket.id);
    if (me) clearEatAnimation(me);
    socket.emit("finishEat", {});
    syncLocalHoldFromInventory();
  }
}

function getGroundImage(itemId) {
  return item_img[`${itemId}Ground`];
}

function getInventoryImage(itemId) {
  return item_img[`${itemId}Inv`];
}

function getGroundDrawScale(itemId) {
  if (itemId === "spear") return 1.28;
  if (itemId === "blueberry" || itemId === "wildberry") return 0.78;
  if (itemId === "blueberrySeed" || itemId === "wildberrySeed") return 1.22;
  return 1;
}

nickName.maxLength = 20;

function setChatVisible(visible) {
  chatPanel.style.display = visible ? "flex" : "none";
}

function setChatCollapsed(collapsed) {
  chatCollapsed = collapsed;
  chatPanel.classList.toggle("collapsed", collapsed);
  chatToggleBtn.textContent = collapsed ? "+" : "−";
  chatToggleBtn.title = collapsed ? "Развернуть чат" : "Свернуть чат";
}

chatToggleBtn.addEventListener("click", () => {
  setChatCollapsed(!chatCollapsed);
});

function isChatNearBottom() {
  return (
    chatMessagesEl.scrollHeight -
      chatMessagesEl.scrollTop -
      chatMessagesEl.clientHeight <
    48
  );
}

function scrollChatToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function renderChatMessage(message) {
  if (message.id !== undefined && chatMessageIds.has(message.id)) return;
  if (message.id !== undefined) chatMessageIds.add(message.id);

  chatMessages.push(message);

  const row = document.createElement("div");
  row.className = "chat-message";

  const name = document.createElement("span");
  name.className = "chat-name";
  name.textContent = `${message.name || "Player"}: `;

  row.appendChild(name);
  row.appendChild(document.createTextNode(message.text));
  chatMessagesEl.appendChild(row);

  if (chatStickToBottom) {
    scrollChatToBottom();
  }
}

function loadChatHistory(messages) {
  chatMessagesEl.innerHTML = "";
  chatMessages.length = 0;
  chatMessageIds.clear();

  for (let i = 0; i < messages.length; i++) {
    renderChatMessage(messages[i]);
  }

  chatStickToBottom = true;
  scrollChatToBottom();
}

chatMessagesEl.addEventListener("scroll", () => {
  chatStickToBottom = isChatNearBottom();
});

btnPlay.addEventListener("click", (event) => {
  event.preventDefault();
  if (!socket.id) {
    alert("Подключение к серверу...");
    return;
  }
  socket.emit("tryConnectGame", { name: nickName.value });
});

class PlayersList {
  constructor() {
    this.list = [];
  }
}

class MyPlayer {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.renderX = 0;
    this.renderY = 0;
    this.vector = [];
    this.speed = 0;
    this.sprinting = false;
    this.energy = 300;
    this.maxEnergy = 300;
    this.angle = 0;
    this.hp = 300;
    this.maxHp = 300;
    this.interactionRadius = 200;
    this.playerXCell = 0;
    this.playerYCell = 0;
    this.mouseIsDown = false;
    this.isAttacking = false;
    this.attackStartedAt = 0;
    this.nextAttackAllowedAt = 0;
    this.attackPending = false;
    this.attackPendingSince = 0;
    this.attackX = 0;
    this.attackY = 0;
    this.attackAngle = 0;
  }
}

const ATTACK_DURATION = 500;
const REMOTE_ATTACK_ANIM_MS = 380;
const ALERT_SHOW_MS = 2500;
const ALERT_FADE_MS = 300;
const ALERT_COOLDOWN_MS = 2000;
const HURT_OVERLAY_MS = 200;
const HEAL_OVERLAY_MS = 200;

const corpses = [];
const chatMessages = [];
const chatMessageIds = new Set();
const natureHitAnimations = new Map();
const campfireHitVisuals = new Map();
let chatStickToBottom = true;
const effectOverlays = new Map();

const playerAlertStates = new Map();

function getPlayerAlertState(playerId) {
  if (!playerAlertStates.has(playerId)) {
    playerAlertStates.set(playerId, {
      queue: [],
      current: null,
      cooldownUntil: 0,
    });
  }
  return playerAlertStates.get(playerId);
}

function queueAlert(playerId, tier) {
  if (tier < 0) return;
  const state = getPlayerAlertState(playerId);
  if (state.current || performance.now() < state.cooldownUntil) {
    if (!state.queue.includes(tier)) state.queue.push(tier);
    return;
  }
  startAlert(playerId, tier);
}

function startAlert(playerId, tier) {
  const state = getPlayerAlertState(playerId);
  state.current = {
    tier,
    startedAt: performance.now(),
    alpha: 0,
  };
}

function updateAlerts() {
  for (const state of playerAlertStates.values()) {
    if (!state.current) {
      if (state.queue.length > 0 && performance.now() >= state.cooldownUntil) {
        const nextTier = state.queue.shift();
        state.current = {
          tier: nextTier,
          startedAt: performance.now(),
          alpha: 0,
        };
      }
      continue;
    }

    const alert = state.current;
    const elapsed = performance.now() - alert.startedAt;

    if (elapsed < ALERT_FADE_MS) {
      alert.alpha = elapsed / ALERT_FADE_MS;
    } else if (elapsed < ALERT_FADE_MS + ALERT_SHOW_MS) {
      alert.alpha = 1;
    } else {
      state.current = null;
      state.cooldownUntil = performance.now() + ALERT_COOLDOWN_MS;
    }
  }
}

function smoothToward(current, target, factor) {
  return current + (target - current) * factor;
}

function ensureRenderPosition(entity) {
  if (entity.renderX === undefined) entity.renderX = entity.targetX ?? entity.x;
  if (entity.renderY === undefined) entity.renderY = entity.targetY ?? entity.y;
  if (entity.targetX === undefined) entity.targetX = entity.x;
  if (entity.targetY === undefined) entity.targetY = entity.y;
}

function getAttackZone(player) {
  const s = settings.settings;
  const angleRad = (player.angle * Math.PI) / 180;
  return {
    cx: player.x + Math.cos(angleRad) * s.ATTACK_ZONE_DISTANCE,
    cy: player.y + Math.sin(angleRad) * s.ATTACK_ZONE_DISTANCE,
    radius: s.ATTACK_ZONE_RADIUS,
  };
}

function addEffectOverlay(playerId, type, duration) {
  effectOverlays.set(`${playerId}:${type}:${performance.now()}`, {
    playerId,
    type,
    until: performance.now() + duration,
  });
}

function updateAttackAnimation(entity) {
  if (!entity.isAttacking) {
    return { lOffset: 0, rOffset: 0 };
  }

  const duration = entity.attackAnimDuration ?? ATTACK_DURATION;
  const elapsed = Math.max(0, performance.now() - entity.attackStartedAt);
  if (elapsed >= duration) {
    entity.isAttacking = false;
    if (entity.attackAnimPending) {
      entity.attackAnimPending = false;
      entity.isAttacking = true;
      entity.attackStartedAt = performance.now();
      return updateAttackAnimation(entity);
    }
    return { lOffset: 0, rOffset: 0 };
  }

  const half = duration / 2;
  const amplitude = 15;

  if (elapsed < half) {
    const t = elapsed / half;
    const lOffset = Math.sin(t * Math.PI) * amplitude;
    return { lOffset, rOffset: 0 };
  }

  const t = (elapsed - half) / half;
  const rOffset = -Math.sin(t * Math.PI) * amplitude;
  return { lOffset: 0, rOffset };
}

function beginAttackAnimation(entity, startedAt, duration = ATTACK_DURATION) {
  if (entity.isAttacking) {
    const activeDuration = entity.attackAnimDuration ?? ATTACK_DURATION;
    const elapsed = Math.max(0, performance.now() - entity.attackStartedAt);
    if (elapsed < activeDuration) {
      entity.attackAnimPending = true;
      return;
    }
  }

  entity.isAttacking = true;
  entity.attackAnimPending = false;
  entity.attackStartedAt = startedAt ?? performance.now();
  entity.attackAnimDuration = duration;
  entity.attackX = entity.x ?? entity.renderX ?? 0;
  entity.attackY = entity.y ?? entity.renderY ?? 0;
  entity.attackAngle = entity.angle;
}

function clearEatAnimation(entity) {
  if (!entity) return;
  entity.isEating = false;
  entity.eatItemId = null;
  entity.eatStartedAt = 0;
}

function beginEatAnimation(entity, duration = 500, itemId = "blueberry") {
  if (!entity) return;
  entity.isEating = true;
  entity.eatStartedAt = performance.now();
  entity.eatAnimDuration = duration;
  entity.eatItemId = itemId ?? "blueberry";
}

function getEatSqueeze(entity) {
  if (!entity?.isEating) return 0;
  const duration = entity.eatAnimDuration ?? 500;
  const elapsed = performance.now() - (entity.eatStartedAt ?? 0);
  if (elapsed >= duration) {
    clearEatAnimation(entity);
    return 0;
  }
  return Math.abs(Math.sin((elapsed / duration) * Math.PI * 2));
}

function cancelLocalEat() {
  if (!application.myPlayer?.isEating && actionTimer?.kind !== "eat") return false;
  clearEatAnimation(application.myPlayer);
  const me = application.playersList.list.find((p) => p.id === socket.id);
  if (me) clearEatAnimation(me);
  if (actionTimer?.kind === "eat") clearActionTimer();
  socket.emit("cancelEat", {});
  return true;
}

function isShowingHeldBerry(player, isMe) {
  const heldId = isMe ? heldItemId : player?.heldItemId;
  if (isEdibleBerry(heldId)) return true;
  const eatEntity = isMe ? application.myPlayer : player;
  return !!(
    eatEntity?.isEating && isEdibleBerry(eatEntity.eatItemId)
  );
}

function requestAttack() {
  const mp = application.myPlayer;
  if (!application.canvasShow) return;

  if (isToolItem(heldItemId)) {
    const cost = getClientToolProfile(heldItemId)?.energy ?? (heldItemId === "pickaxe_stone" ? (settings?.settings?.PICKAXE_STONE_ATTACK_ENERGY ?? 15) : (settings?.settings?.HATCHET_ATTACK_ENERGY ?? 7));
    if (energy < cost) return;
  }

  if (heldItemId === 'spear' && localSpear.state === 'idle_hand') {
    if (energy < (settings?.settings?.SPEAR_ENERGY_COST ?? 30)) return;
    localSpear.state = 'windup';
    localSpear.timer = 0;
    localSpear.rOffset = 30;
    localSpear.lOffset = 30;
    localSpear.endOfAnimation = false;
    localSpear.animation = false;
    socket.emit('start_spear_windup');
    return;
  }
  if (mp.attackPending) {
    if (performance.now() - mp.attackPendingSince > 200) {
      mp.attackPending = false;
    } else {
      return;
    }
  }

  if (mp.isAttacking) return;
  if (performance.now() < mp.nextAttackAllowedAt) return;
  mp.attackPending = true;
  mp.attackPendingSince = performance.now();
  socket.emit("startAttack", {});
}

function angleCalc(xMouse, yMouse, xPlayer, yPlayer) {
  const deltaX = xMouse - xPlayer;
  const deltaY = yMouse - yPlayer;
  const angle = Math.round(Math.atan(deltaY / deltaX) * (180 / Math.PI));
  if (deltaX >= 0 && deltaY >= 0) return angle;
  if (deltaX < 0 && deltaY >= 0) return 180 + angle;
  if (deltaX < 0 && deltaY < 0) return 180 + angle;
  if (deltaX > 0 && deltaY < 0) return 360 + angle;
}

// ===== КОСТРЫ =====

function getStationKey(kind, cell) {
  return `${kind}:${cell?.indexX ?? -1}:${cell?.indexY ?? -1}`;
}

function isStationOnCooldown(kind, cell) {
  return performance.now() < (stationInteractionCooldowns.get(getStationKey(kind, cell)) ?? 0);
}

function markStationClosed(kind, cell) {
  if (!cell) return;
  stationInteractionCooldowns.set(getStationKey(kind, cell), performance.now() + STATION_INTERACTION_COOLDOWN_MS);
}

function findNearestWorkbench({ ignoreCooldown = false } = {}) {
  const me = application.playersList.list.find(p => p.id === socket.id);
  if (!me) return null;
  const radius = settings?.settings?.WORKBENCH?.radius ?? 200;
  let nearest = null, minDist = radius;
  for (const cell of me.visibleCells ?? []) {
    if (!cell.workbench) continue;
    if (!ignoreCooldown && isStationOnCooldown("workbench", cell)) continue;
    const dist = Math.hypot(cell.x + cell.w / 2 - me.x, cell.y + cell.h / 2 - me.y);
    if (dist < minDist) { minDist = dist; nearest = cell; nearest._interactionDistance = dist; }
  }
  return nearest;
}

function findNearestCampfire({ ignoreCooldown = false } = {}) {
  const me = application.playersList.list.find(p => p.id === socket.id);
  if (!me) return null;
  const radius = settings?.settings?.INTERACTION_RADIUS ?? 200;
  let nearest = null, minDist = radius;
  for (const cell of me.visibleCells ?? []) {
    if (!cell.campfire) continue;
    if (!ignoreCooldown && isStationOnCooldown("campfire", cell)) continue;
    const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2;
    const dist = Math.hypot(cx - me.x, cy - me.y);
    if (dist < minDist) { minDist = dist; nearest = cell; nearest._interactionDistance = dist; }
  }
  return nearest;
}

function findNearestStationInteractable() {
  const wb = findNearestWorkbench();
  const cf = findNearestCampfire();
  if (!wb) return cf ? { kind: "campfire", cell: cf, dist: cf._interactionDistance } : null;
  if (!cf) return { kind: "workbench", cell: wb, dist: wb._interactionDistance };
  return wb._interactionDistance <= cf._interactionDistance
    ? { kind: "workbench", cell: wb, dist: wb._interactionDistance }
    : { kind: "campfire", cell: cf, dist: cf._interactionDistance };
}

function closeWorkbenchPanel() {
  if (activeWorkbench) {
    const cell = application.playersList.list.find(p => p.id === socket.id)?.visibleCells?.find(c => c.indexX === activeWorkbench.indexX && c.indexY === activeWorkbench.indexY);
    markStationClosed("workbench", cell);
  }
  workbenchPanelOpen = false;
  activeWorkbench = null;
  socket.emit("closeWorkbench", {});
}

function toggleWorkbenchPanel(preferredCell = null) {
  const nearest = preferredCell ?? findNearestWorkbench();
  if (!nearest) { closeWorkbenchPanel(); return; }
  if (workbenchPanelOpen && activeWorkbench?.indexX === nearest.indexX && activeWorkbench?.indexY === nearest.indexY) {
    closeWorkbenchPanel();
    return;
  }
  if (campfirePanelOpen) closeCampfirePanel();
  workbenchPanelOpen = true; craftOpen = false;
  activeWorkbench = { indexX: nearest.indexX, indexY: nearest.indexY, workbenchData: nearest.workbench };
  socket.emit("openWorkbench", { indexX: nearest.indexX, indexY: nearest.indexY });
}

function checkWorkbenchDistance() {
  if (!workbenchPanelOpen || !activeWorkbench) return;
  const me = application.playersList.list.find(p => p.id === socket.id);
  const cell = me?.visibleCells?.find(c => c.indexX === activeWorkbench.indexX && c.indexY === activeWorkbench.indexY);
  if (!cell?.workbench || Math.hypot(cell.x + cell.w/2 - me.x, cell.y + cell.h/2 - me.y) > (settings?.settings?.WORKBENCH?.radius ?? 200)) {
    closeWorkbenchPanel();
  }
}

function getWorkbenchQueueRowRects(panel) {
  const layout = getCraftQueueBarLayout();
  const iconSize = layout.iconSize, barH = layout.barH, xBtn = layout.xBtn, gap = layout.gap, rowH = layout.rowH;
  const barW = Math.min(layout.barW, 310 * panel.scale);
  const totalW = iconSize + gap + barW + gap + xBtn;
  const ing = craftLayout?.ingredients;
  const ingCenterNative = ing ? ing.startX + (5 * ing.cellSize + 4 * ing.gap) / 2 : 932;
  const x = panel.x + ingCenterNative * panel.scale - totalW / 2;
  const craftBtn = getCraftActionButtonRect(panel);
  const startY = craftBtn.y + craftBtn.h + 46;
  const count = activeWorkbench?.workbenchData?.craftQueue?.length || 0;
  return Array.from({length: count}, (_, index) => {
    const y = startY + index * rowH;
    const icon = { x, y: y + (rowH-iconSize)/2, w: iconSize, h: iconSize };
    const bar = { x: icon.x + icon.w + gap, y: y + (rowH-barH)/2, w: barW, h: barH };
    const action = { x: bar.x + bar.w + gap, y: y + (rowH-xBtn)/2, w: xBtn, h: xBtn };
    return { index, icon, bar, action };
  });
}

function toggleCampfirePanel() {
  if (!application.canvasShow) return;
  const me = application.playersList.list.find(p => p.id === socket.id);
  if (!me) return;
  const radius = settings?.settings?.CAMPFIRE_NORMAL?.radius || 200;
  let nearest = null;
  let minDist = radius;
  for (const cell of me.visibleCells) {
    if (!cell.campfire) continue;
    const cx = cell.x + cell.w/2, cy = cell.y + cell.h/2;
    const dist = Math.hypot(cx - me.x, cy - me.y);
    if (dist < minDist) {
      minDist = dist;
      nearest = cell;
    }
  }
  if (!nearest) {
    if (campfirePanelOpen) closeCampfirePanel();
    return;
  }
  if (campfirePanelOpen && activeCampfire &&
      activeCampfire.indexX === nearest.indexX &&
      activeCampfire.indexY === nearest.indexY) {
    closeCampfirePanel();
  } else {
    openCampfirePanel(nearest);
  }
}

function openCampfirePanel(cell) {
  closeWorkbenchPanel();
  campfirePanelOpen = true;
  craftOpen = false;
  activeCampfire = { indexX: cell.indexX, indexY: cell.indexY, campfireData: cell.campfire };
  socket.emit("openCampfire", { indexX: cell.indexX, indexY: cell.indexY });
}

function closeCampfirePanel() {
  if (activeCampfire) {
    const cell = application.playersList.list.find(p => p.id === socket.id)?.visibleCells?.find(c => c.indexX === activeCampfire.indexX && c.indexY === activeCampfire.indexY);
    markStationClosed("campfire", cell);
  }
  campfirePanelOpen = false;
  activeCampfire = null;
  socket.emit("closeCampfire", {});
}

function checkCampfireDistance() {
  if (!campfirePanelOpen || !activeCampfire) return;
  const me = application.playersList.list.find(p => p.id === socket.id);
  if (!me) return;
  const cell = me.visibleCells?.find(c =>
    c.indexX === activeCampfire.indexX && c.indexY === activeCampfire.indexY
  );
  if (!cell || !cell.campfire) {
    closeCampfirePanel();
    return;
  }
  const cx = cell.x + cell.w/2, cy = cell.y + cell.h/2;
  const dist = Math.hypot(cx - me.x, cy - me.y);
  const radius = settings?.settings?.CAMPFIRE_NORMAL?.radius || 200;
  if (dist > radius) {
    closeCampfirePanel();
  }
}

class Application {
  constructor() {
    this.canvasShow = false;
    this.playersList = new PlayersList();
    this.myPlayer = new MyPlayer();
    this.initInput();
  }

  initInput() {
    let lastAngleSent = 0;
    let lastAngleTime = 0;

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.code === "KeyP") {
          showDebugHitboxes = !showDebugHitboxes;
          return;
        }

        if (event.code === "Enter" || event.code === "NumpadEnter") {
          if (this.canvasShow && document.activeElement !== chatInput) {
            event.preventDefault();
            chatInput.focus({ preventScroll: true });
          }
          return;
        }

        if (event.code === "Escape" && document.activeElement === chatInput) {
          chatInput.blur();
          return;
        }

        if (!this.canvasShow) {
          return;
        }

        if (document.activeElement === chatInput || ClanUI.isInputFocused()) {
          return;
        }

        const numberMatch = event.code.match(/^Digit([1-8])$/);
        if (numberMatch) {
          event.preventDefault();
          activateInventorySlot(Number(numberMatch[1]) - 1);
          return;
        }

        if (event.code === "KeyF") {
          event.preventDefault();
          if (findNearestWorkbench()) toggleWorkbenchPanel();
          else toggleCampfirePanel();
          return;
        }

        if (event.code === "KeyR") {
          if (isInBuildMode(null, true) && !workbenchPanelOpen && !campfirePanelOpen) {
            event.preventDefault();
            buildRotation = (buildRotation + 1) % 4;
          }
          return;
        }

        if (event.code === "KeyE") {
          event.preventDefault();

          // E is contextual: while a station panel is open, E only closes it.
          // A second E can then immediately select another nearby station; the
          // just-closed station is protected by its own 300 ms cooldown.
          if (workbenchPanelOpen) {
            closeWorkbenchPanel();
            return;
          }
          if (campfirePanelOpen) {
            closeCampfirePanel();
            return;
          }

          const visible = application.playersList.list.find(p => p.id === socket.id)?.visibleCells ?? [];
          const door = findNearestDoorInteractable();
          const station = findNearestStationInteractable();
          const loot = findNearestInteractableGround(visible);
          if (door && (!station || door.dist <= station.dist) && (!loot || door.dist <= loot.dist)) {
            socket.emit("toggleDoor", { indexX:door.cell.indexX,indexY:door.cell.indexY });
            return;
          }
          if (station && (!loot || station.dist <= loot.dist)) {
            if (station.kind === "workbench") toggleWorkbenchPanel(station.cell);
            else openCampfirePanel(station.cell);
            return;
          }

          if (!canPickupNow() || !loot) return;
          markPickupSent();
          socket.emit("pickupItem", {});
          return;
        }

        if (event.code === "KeyC") {
          event.preventDefault();
          ClanUI.closeAll();

          craftOpen = !craftOpen;
          if (craftOpen) {
            if (campfirePanelOpen) closeCampfirePanel();
            if (workbenchPanelOpen) closeWorkbenchPanel();
          }
          return;
        }

        if (pressingButton.includes(event.code)) return;
        pressingButton.push(event.code);
        socket.emit("sendMovement", { movement: event.code });
      },
      true
    );

    document.addEventListener("keyup", (event) => {
      if (!this.canvasShow) return;
      if (document.activeElement === chatInput) return;
      const index = pressingButton.indexOf(event.code);
      if (index === -1) return;
      pressingButton.splice(index, 1);
      socket.emit("deleteMovement", { movement: event.code });
    });

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    canvas.addEventListener("mousedown", (event) => {
      if (!this.canvasShow) return;

      if (ClanUI.handlePointerDown(event)) {
        event.preventDefault();
        return;
      }

      if (handleCraftPointerDown(event)) {
        event.preventDefault();
        return;
      }

      if (craftOpen) {
        event.preventDefault();
        return;
      }

      if (event.button === 2) {
        const slotIndex = hitTestInventorySlot(event.clientX, event.clientY);
        if (slotIndex !== -1 && inventory[slotIndex]) {
          event.preventDefault();
          socket.emit("inventoryDrop", { slotIndex });
          return;
        }
        
        if (localSpear.state === 'windup') {
          event.preventDefault();
          socket.emit('cancel_spear_windup');
          localSpear.state = 'idle_hand';
          localSpear.timer = 0;
          localSpear.rOffset = 30;
          return;
        }

        if (application.myPlayer.isEating || actionTimer?.kind === "eat") {
          event.preventDefault();
          cancelLocalEat();
          return;
        }
        if (isInBuildMode(null, true)) {
          event.preventDefault();
          tryBuildAtScreen(event.clientX, event.clientY);
          return;
        }
        if (isHoldingEdible()) {
          event.preventDefault();
          this.tryStartAttack();
          return;
        }
        this.myPlayer.mouseIsDown = true;
        this.tryStartAttack();
        return;
      }

      if (event.button !== 0) return;

      const slotIndex = hitTestInventorySlot(event.clientX, event.clientY);
      if (slotIndex === -1) {
        if (application.myPlayer.isEating || actionTimer?.kind === "eat") {
          event.preventDefault();
          return;
        }
        if (isHoldingSpear() && localSpear.state === 'idle_hand') {
          event.preventDefault();
          this.tryStartAttack();
          return;
        }
        if (isHoldingEdible()) {
          event.preventDefault();
          this.tryStartAttack();
        }
        return;
      }

      event.preventDefault();
      const slot = inventory[slotIndex];
      if (!slot) return;

      if (event.ctrlKey) {
        socket.emit("inventorySplit", { slotIndex });
        return;
      }

      invDrag = {
        fromIndex: slotIndex,
        itemId: slot.itemId,
        amount: slot.amount,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
      };
    });

    canvas.addEventListener("mouseup", (event) => {
      if (event.button === 2) this.myPlayer.mouseIsDown = false;

      if (event.button === 0 && invDrag) {
        finishInventoryDrag(event.clientX, event.clientY);
      }
    });

    document.addEventListener("mouseup", (event) => {
      if (event.button === 0 && invDrag) {
        finishInventoryDrag(event.clientX, event.clientY);
      }
    });

    document.addEventListener("mousemove", (event) => {
      pointerClientX = event.clientX;
      pointerClientY = event.clientY;
      if (invDrag) {
        invDrag.x = event.clientX;
        invDrag.y = event.clientY;
        if (!invDrag.dragging) {
          const layout = getInventoryLayout();
          const origin = layout.slots[invDrag.fromIndex];
          if (origin) {
            const dx = event.clientX - (origin.x + origin.size / 2);
            const dy = event.clientY - (origin.y + origin.size / 2);
            if (Math.hypot(dx, dy) >= INV_DRAG_THRESHOLD) {
              invDrag.dragging = true;
            }
          }
        }
      }

      if (!this.canvasShow) return;
      const angle = angleCalc(
        event.clientX,
        event.clientY,
        window.innerWidth / 2,
        window.innerHeight / 2
      );
      this.myPlayer.angle = angle;

      const now = performance.now();
      if (now - lastAngleTime < 33 && Math.abs(angle - lastAngleSent) < 4) return;

      lastAngleTime = now;
      lastAngleSent = angle;
      socket.emit("sendAngle", {
        mouseX: event.clientX,
        mouseY: event.clientY,
        id: socket.id,
        angle,
      });
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.canvasShow) return;
        event.preventDefault();
        const delta = -event.deltaY;
        scale += delta * 0.001;
        if (scale < 0.2) scale = 0.2;
        if (scale > 3) scale = 3;
      },
      { passive: false }
    );

    chatInput.addEventListener("keydown", (event) => {
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        event.stopPropagation();
        const text = chatInput.value.trim();
        if (text) socket.emit("sendChat", { text });
        chatInput.value = "";
        chatInput.blur();
      }
    });
  }

  tryStartAttack() {
    if (actionTimer?.kind === "equip") return;
    if (this.myPlayer.isEating || actionTimer?.kind === "eat") return;
    if (isInBuildMode(null, true)) return;
    requestAttack();
  }

  enterGame() {
    // A new life must not inherit client-only station/craft state from the previous life.
    workbenchPanelOpen = false;
    activeWorkbench = null;
    campfirePanelOpen = false;
    activeCampfire = null;
    craftOpen = false;
    actionTimer = null;
    heldItemId = null;
    heldSlotIndex = -1;
    craftQueueState = { queue: [], max: settings?.settings?.CRAFT_QUEUE_MAX ?? 4 };
    temperature = settings?.settings?.TEMPERATURE_MAX ?? 300;
    maxTemperature = settings?.settings?.TEMPERATURE_MAX ?? 300;
    energy = settings?.settings?.MAX_ENERGY ?? 300;
    maxEnergy = settings?.settings?.MAX_ENERGY ?? 300;
    this.myPlayer.isEating = false;
    this.myPlayer.attackPending = false;
    this.myPlayer.attackTool = "hand";
    this.canvasShow = true;
    mainDiv.style.display = "none";
    setChatVisible(true);
    setChatCollapsed(false);
    authorCredits.style.display = "none";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    metricCentre.x = canvas.width / 2;
    metricCentre.y = canvas.height / 2;
  }

  returnToMenu() {
    this.canvasShow = false;
    mainDiv.style.display = "block";
    chatInput.blur();
    setChatVisible(false);
    authorCredits.style.display = "block";
    this.playersList.list = this.playersList.list.filter((p) => p.id === socket.id);
    const me = this.playersList.list[0];
    if (me) {
      this.myPlayer.hp = me.hp ?? this.myPlayer.hp;
    }
    const selfState = getPlayerAlertState(socket.id);
    selfState.current = null;
    selfState.queue = [];
    selfState.cooldownUntil = 0;
    leaderboardEntries = [];
    craftOpen = false;
    ClanUI.reset();

    // A death ends the previous life completely. Do not carry the previous
    // spear projectile/landing animation into the next life or respawn.
    localSpear.state = "none";
    localSpear.timer = 0;
    localSpear.distance = 0;
    localSpear.worldX = 0;
    localSpear.worldY = 0;
    localSpear.endOfAnimation = false;
    localSpear.lOffset = 30;
    localSpear.rOffset = 30;
    for (const id of Object.keys(flyingSpears)) delete flyingSpears[id];
    spearLandAnims.length = 0;
    spearGroundHideUntil.length = 0;

    heldItemId = null;
    heldSlotIndex = -1;
    actionTimer = null;
    craftQueueState = { queue: [], max: settings?.settings?.CRAFT_QUEUE_MAX ?? 4 };
    satiety = settings?.settings?.MAX_SATIETY ?? 300;
    maxSatiety = settings?.settings?.MAX_SATIETY ?? 300;
    temperature = settings?.settings?.TEMPERATURE_MAX ?? 300;
    maxTemperature = settings?.settings?.TEMPERATURE_MAX ?? 300;
    energy = settings?.settings?.MAX_ENERGY ?? 300;
    maxEnergy = settings?.settings?.MAX_ENERGY ?? 300;
    application.myPlayer.energy = energy;
    application.myPlayer.maxEnergy = maxEnergy;
    myScore = 0;
    myLevel = 0;
    myXp = 0;
    myXpNeed = settings?.settings?.XP_BASE ?? 100;
    campfirePanelOpen = false;
    activeCampfire = null;
    
    localSpear.state = 'none';
    localSpear.timer = 0;
  }
}

const application = new Application();
ClanUI.init({ socket, canvas, ctx, application, getSettings: () => settings });

function UpdateSize() {
  if (!application.canvasShow) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  metricCentre.x = canvas.width / 2;
  metricCentre.y = canvas.height / 2;
}

window.addEventListener("resize", UpdateSize);

socket.on("sendSettings", (data) => {
  settings = data;
  loadNatureImages(data.natureImages);
  loadItemImages(data.itemImages);
  toolCatalog = data.toolCatalog && typeof data.toolCatalog === "object" ? data.toolCatalog : {};
  natureCatalog = Array.isArray(data.natureCatalog) ? data.natureCatalog : [];
  natureDrawLayerById.clear();
  for (const def of natureCatalog) {
    if (def?.id) natureDrawLayerById.set(def.id, def.drawLayer ?? 20);
  }
  const slots = data.settings?.INVENTORY_SLOTS ?? 8;
  if (inventory.length !== slots) {
    inventory = Array(slots).fill(null);
  }
  if (data.dayNight) applyDayNightState(data.dayNight);
  craftRecipes = Array.isArray(data.crafts) ? data.crafts : [];
  craftLayout = data.craftLayout ?? null;
  if (selectedCraftIndex >= getNormalCraftRecipes().length) selectedCraftIndex = 0;
  temperature = data.settings?.TEMPERATURE_MAX || 300;
  maxTemperature = data.settings?.TEMPERATURE_MAX || 300;
  energy = data.settings?.MAX_ENERGY ?? 300;
  maxEnergy = data.settings?.MAX_ENERGY ?? 300;
});

socket.on("craftQueueUpdate", (data) => {
  const now = performance.now();
  const raw = Array.isArray(data?.queue) ? data.queue : [];
  craftQueueState = {
    max: data?.max ?? settings?.settings?.CRAFT_QUEUE_MAX ?? 4,
    queue: raw.map((job) => ({
      recipeId: job.recipeId,
      durationMs: job.durationMs ?? 3000,
      remainingMs: job.remainingMs ?? job.durationMs ?? 3000,
      active: !!job.active,
      endsAt: now + (Number(job.remainingMs) || 0),
    })),
  };
});
socket.on("dayNightUpdate", (data) => {
  applyDayNightState(data);
});

function applyDayNightState(state) {
  if (!state) return;
  isNight = !!state.isNight;
}

socket.on("inventoryUpdate", (data) => {
  setInventory(data.inventory);
});

socket.on("playerSatietyUpdate", (data) => {
  satiety = data.satiety ?? satiety;
  maxSatiety = data.maxSatiety ?? maxSatiety;
});

socket.on("energyUpdate", (data) => {
  energy = Math.max(0, Number(data.energy ?? energy));
  maxEnergy = Math.max(1, Number(data.maxEnergy ?? maxEnergy));
  if (application.myPlayer) {
    application.myPlayer.energy = energy;
    if (data.sprinting === false) application.myPlayer.sprinting = false;
  }
  const me = application.playersList.list.find((p) => p.id === socket.id);
  if (me && data.sprinting === false) me.sprinting = false;
});

socket.on("scoreUpdate", (data) => {
  myScore = Math.floor(data.score ?? 0);
  myLevel = Math.max(0, Math.floor(data.level ?? 0));
  myXp = Math.max(0, Number(data.xp) || 0);
  myXpNeed = Math.max(1, Number(data.xpNeed) || settings?.settings?.XP_BASE || 100);
});

socket.on("playerHoldUpdate", (data) => {
  const player = application.playersList.list.find((p) => p.id === data.id);
  if (player) {
    if (!(player.isEating && !data.heldItemId)) {
      player.heldItemId = data.heldItemId ?? null;
      player.heldSlotIndex = data.heldSlotIndex ?? -1;
    }
  }
  if (data.id === socket.id) {
    if (application.myPlayer?.isEating && !data.heldItemId) {
      return;
    }
    heldItemId = data.heldItemId ?? null;
    heldSlotIndex = data.heldSlotIndex ?? -1;
  }
});

socket.on("playerFoodEat", (data) => {
  const duration = data.durationMs ?? settings?.settings?.EAT_FOOD_MS ?? 500;
  const itemId = data.itemId ?? "blueberry";
  const player = application.playersList.list.find((p) => p.id === data.id);
  if (player) beginEatAnimation(player, duration, itemId);
  if (data.id === socket.id) {
    application.myPlayer.attackPending = false;
    beginEatAnimation(application.myPlayer, duration, itemId);
    startActionTimer("eat", duration);
  }
});

socket.on("playerFoodEatCancel", (data) => {
  const player = application.playersList.list.find((p) => p.id === data.id);
  if (player) clearEatAnimation(player);
  if (data.id === socket.id) {
    clearEatAnimation(application.myPlayer);
    if (actionTimer?.kind === "eat") clearActionTimer();
  }
});

socket.on("leaderboardUpdate", (data) => {
  leaderboardEntries = Array.isArray(data.entries) ? data.entries : [];
});

socket.on("resourceCollect", (data) => {
  if (data.inventory) setInventory(data.inventory);

  // The landed spear has its own render path in addition to normal ground
  // loot. Clear that local visual as soon as the server confirms pickup.
  if (data.itemId === "spear" && (data.playerId ?? socket.id) === socket.id) {
    localSpear.state = "none";
    localSpear.timer = 0;
    localSpear.distance = 0;
    localSpear.endOfAnimation = false;
  }
  const pickerId = data.playerId ?? socket.id;
  const duration = settings?.settings?.RESOURCE_FLY_ANIM_MS ?? 560;
  const amount = Math.max(1, Number(data.amount) || 1);

  if (data.oneByOne) {
    const pendingCollect = resourceFlyAnims.filter((a) => a.mode === "collect")
      .length;
    for (let i = 0; i < amount; i++) {
      resourceFlyAnims.push({
        mode: "collect",
        itemId: data.itemId,
        fromX: data.fromX,
        fromY: data.fromY,
        toX: data.fromX,
        toY: data.fromY,
        followPlayerId: pickerId,
        startedAt: performance.now() + (pendingCollect + i) * 90,
        duration,
      });
    }
    return;
  }

  resourceFlyAnims.push({
    mode: "collect",
    itemId: data.itemId,
    fromX: data.fromX,
    fromY: data.fromY,
    toX: data.fromX,
    toY: data.fromY,
    followPlayerId: pickerId,
    startedAt: performance.now(),
    duration,
  });
});

socket.on("resourceDrop", (data) => {
  const duration = settings?.settings?.RESOURCE_DROP_ANIM_MS ?? 640;
  const hideKey =
    data.lootId || getCellKey(data.indexX, data.indexY);
  hiddenGroundUntil.set(hideKey, performance.now() + duration);
  resourceFlyAnims.push({
    mode: "drop",
    itemId: data.itemId,
    fromX: data.fromX,
    fromY: data.fromY,
    toX: data.toX,
    toY: data.toY,
    indexX: data.indexX,
    indexY: data.indexY,
    lootId: data.lootId,
    startedAt: performance.now(),
    duration,
  });
});

socket.on("groundItemUpdate", (data) => {
  const now = performance.now();
  const raw = Array.isArray(data.groundItems)
    ? data.groundItems
    : data.groundItem
      ? [data.groundItem]
      : [];
  const items = raw.map((loot) => hydrateGroundLootTimers(loot, now));
  updateLocalNatureCell(data.indexX, data.indexY, {
    groundItems: items.length ? items : null,
    groundItem: items[0] ?? null,
  });
});

socket.on("failedToConnectGame", () => {
  alert("Не удалось войти в игру");
});

socket.on("successToConnectGame", () => {
  localSpear.state = "none";
  localSpear.timer = 0;
  localSpear.distance = 0;
  localSpear.worldX = 0;
  localSpear.worldY = 0;
  localSpear.endOfAnimation = false;
  localSpear.lOffset = 30;
  localSpear.rOffset = 30;
  for (const id of Object.keys(flyingSpears)) delete flyingSpears[id];
  spearLandAnims.length = 0;
  spearGroundHideUntil.length = 0;
  application.enterGame();
});

socket.on("playerDied", () => {
  application.returnToMenu();
});

socket.on("sendPlayers", (data) => {
  const isMe = data.player.id === socket.id;
  const existingPlayer = application.playersList.list.find((p) => p.id === data.player.id);

  if (existingPlayer) {
    Object.assign(existingPlayer, data.player, {
      visibleCells:
        isMe && data.visibleCells
          ? hydrateCellsGroundTimers(data.visibleCells)
          : existingPlayer.visibleCells ?? [],
    });
    syncMyPlayerFrom(existingPlayer, isMe);
    return;
  }

  const newPlayer = {
    ...data.player,
    visibleCells: isMe && data.visibleCells
      ? hydrateCellsGroundTimers(data.visibleCells)
      : [],
    isAttacking: false,
    attackStartedAt: 0,
  };

  ensureRenderPosition(newPlayer);
  newPlayer.targetX = newPlayer.x;
  newPlayer.targetY = newPlayer.y;
  newPlayer.renderX = newPlayer.x;
  newPlayer.renderY = newPlayer.y;
  application.playersList.list.push(newPlayer);
  syncMyPlayerFrom(newPlayer, isMe);
});

function syncMyPlayerFrom(player, isMe) {
  if (!isMe) return;
  application.myPlayer.x = player.x;
  application.myPlayer.y = player.y;
  application.myPlayer.targetX = player.x;
  application.myPlayer.targetY = player.y;
  application.myPlayer.renderX = player.x;
  application.myPlayer.renderY = player.y;
  application.myPlayer.speed = player.speed;
  application.myPlayer.hp = player.hp ?? application.myPlayer.hp;
  application.myPlayer.maxHp = player.maxHp ?? application.myPlayer.maxHp;
  if (player.satiety != null) satiety = player.satiety;
  if (player.maxSatiety != null) maxSatiety = player.maxSatiety;
  if (player.energy != null) energy = player.energy;
  if (player.maxEnergy != null) maxEnergy = player.maxEnergy;
  application.myPlayer.energy = energy;
  application.myPlayer.maxEnergy = maxEnergy;
  if (player.heldItemId !== undefined) {
    heldItemId = player.heldItemId ?? null;
    heldSlotIndex = player.heldSlotIndex ?? -1;
  }
  application.myPlayer.interactionRadius =
    player.interactionRadius ??
    settings?.settings?.INTERACTION_RADIUS ??
    application.myPlayer.interactionRadius;
  application.myPlayer.playerXCell = player.playerXCell;
  application.myPlayer.playerYCell = player.playerYCell;
}

socket.on("sendVisibleCells", (data) => {
  if (data.id !== socket.id) return;
  const me = application.playersList.list.find((p) => p.id === socket.id);
  if (!me) return;
  me.visibleCells = hydrateCellsGroundTimers(data.visibleCells);
  application.myPlayer.playerXCell = data.indexPlayerXCell;
  application.myPlayer.playerYCell = data.indexPlayerYCell;
});

socket.on("sendVectors", (data) => {
  const me = application.playersList.list.find((p) => p.id === socket.id);
  const myVisibleCells = me ? me.visibleCells : [];

  for (const serverPlayer of data.players) {
    const localPlayer = application.playersList.list.find((p) => p.id === serverPlayer.id);
    if (!localPlayer) continue;
    localPlayer.vector = serverPlayer.vector;
    localPlayer.sprinting = serverPlayer.sprinting;
  }

  if (me) {
    me.visibleCells = myVisibleCells;
    application.myPlayer.vector = me.vector;
    application.myPlayer.sprinting = me.sprinting;
  }
});

socket.on("sendPositions", (data) => {
  for (const serverPlayer of data.players) {
    const localPlayer = application.playersList.list.find((p) => p.id === serverPlayer.id);
    if (!localPlayer) continue;

    ensureRenderPosition(localPlayer);
    localPlayer.x = serverPlayer.x;
    localPlayer.y = serverPlayer.y;
    localPlayer.targetX = serverPlayer.x;
    localPlayer.targetY = serverPlayer.y;

    if (serverPlayer.hp !== undefined) {
      localPlayer.hp = serverPlayer.hp;
    }

    if (serverPlayer.id === socket.id) {
      application.myPlayer.x = serverPlayer.x;
      application.myPlayer.y = serverPlayer.y;
      application.myPlayer.targetX = serverPlayer.x;
      application.myPlayer.targetY = serverPlayer.y;
      application.myPlayer.hp = serverPlayer.hp ?? application.myPlayer.hp;
    }
  }
});

socket.on("playerHpUpdate", (data) => {
  const localPlayer = application.playersList.list.find((p) => p.id === data.id);
  if (!localPlayer) return;
  localPlayer.hp = data.hp;
  if (data.x !== undefined) {
    localPlayer.x = data.x;
    localPlayer.y = data.y;
    localPlayer.targetX = data.x;
    localPlayer.targetY = data.y;
  }
  if (data.id === socket.id) application.myPlayer.hp = data.hp;
});

socket.on("deletePlayer", (data) => {
  application.playersList.list = application.playersList.list.filter(
    (p) => p.id !== data.id
  );
  playerAlertStates.delete(data.id);
  delete flyingSpears[data.id];
});

socket.on("sendMouseCoordinatesToClient", (data) => {
  const player = application.playersList.list.find((p) => p.id === data.id);
  if (player) player.angle = data.angle;
});

socket.on("playerAttack", (data) => {
  const isMe = data.id === socket.id;
  const startedAt = performance.now();
  const player = application.playersList.list.find((p) => p.id === data.id);

  if (isMe) {
    application.myPlayer.attackPending = false;
    const duration = Number(data.durationMs) || ATTACK_DURATION;
    application.myPlayer.nextAttackAllowedAt = startedAt + duration;
    application.myPlayer.attackTool = data.tool || "hand";
    beginAttackAnimation(application.myPlayer, startedAt, duration);
  }

  if (player) {
    player.attackTool = data.tool || "hand";
    beginAttackAnimation(player, startedAt, Number(data.durationMs) || REMOTE_ATTACK_ANIM_MS);
  }
});

socket.on("playerHurt", (data) => {
  addEffectOverlay(data.id, "hurt", HURT_OVERLAY_MS);
});

socket.on("playerHealVisual", (data) => {
  addEffectOverlay(data.id, "heal", HEAL_OVERLAY_MS);
});

socket.on("playerAlert", (data) => {
  queueAlert(data.id, data.tier);
});

socket.on("spawnCorpse", (data) => {
  corpses.push({
    id: data.id,
    x: data.x,
    y: data.y,
    angle: data.angle ?? 0,
    until: performance.now() + (settings?.settings?.CORPSE_DURATION_MS ?? 2000),
  });
});

socket.on("removeCorpse", (data) => {
  const index = corpses.findIndex((c) => c.id === data.id);
  if (index !== -1) corpses.splice(index, 1);
});

socket.on("chatHistory", (data) => {
  loadChatHistory(data.messages || []);
});

socket.on("chatMessage", (data) => {
  renderChatMessage(data);
});

socket.on("natureObjectHit", (data) => {
  startNatureHitAnimation(data.indexX, data.indexY, data.knockDx, data.knockDy);
  spawnNatureHitParticles(data);

  if (data.natureType === "campfire") {
    const key = getCellKey(data.indexX, data.indexY);
    const me = application.playersList.list.find(p => p.id === socket.id);
    const cell = me?.visibleCells?.find(c => c.indexX === data.indexX && c.indexY === data.indexY);
    const cf = cell?.campfire;
    campfireHitVisuals.set(key, {
      x: cell ? cell.x + cell.w / 2 : 0,
      y: cell ? cell.y + cell.h / 2 : 0,
      type: data.campfireType || cf?.type || "normal",
      rotation: cell?.campfire?.rotation ?? 0,
      startedAt: performance.now(),
    });
    if (cell) cell.campfire = data.destroyed ? null : { ...cf, hp: data.hp };
  } else {
    updateLocalNatureCell(data.indexX, data.indexY, { hp: data.hp });
  }

  if (data.destroyed) {
    const duration = settings?.settings?.NATURE_HIT_ANIM_MS ?? 200;
    setTimeout(() => {
      updateLocalNatureCell(data.indexX, data.indexY, {
        natureType: "empty",
        natureImage: undefined,
        hp: 0,
        hitboxRadius: 0,
      });
      natureHitAnimations.delete(getCellKey(data.indexX, data.indexY));
      campfireHitVisuals.delete(getCellKey(data.indexX, data.indexY));
    }, duration);
  }
});

socket.on("buildingState", (data) => {
  const me = application.playersList.list.find((p) => p.id === socket.id);
  if (!me) return;
  const cell = me.visibleCells.find(c => c.indexX === data.indexX && c.indexY === data.indexY);
  if (!cell) return;

  const previous = cell.building;

  if (data.building) {
    cell.building = { ...data.building };
    hydrateBuildingAnimationState(cell.building);

    const hpDropped = previous && Number(data.building.hp) < Number(previous.hp);
    if (hpDropped) {
      startNatureHitAnimation(
        data.indexX,
        data.indexY,
        Number(data.knockDx) || 0,
        Number(data.knockDy) || 0
      );
      const material = data.material || (data.building.buildingId?.startsWith("metal") ? "steel" : data.building.buildingId?.startsWith("stone") ? "stone" : "tree");
      spawnNatureHitParticles({
        indexX: data.indexX,
        indexY: data.indexY,
        natureType: material,
        kind: "building",
        destroyed: false,
        worldX: Number.isFinite(Number(data.worldX)) ? Number(data.worldX) : undefined,
        worldY: Number.isFinite(Number(data.worldY)) ? Number(data.worldY) : undefined,
      });
    }
  } else {
    const material = data.material || (previous?.buildingId?.startsWith("metal") ? "steel" : previous?.buildingId?.startsWith("stone") ? "stone" : "tree");
    startNatureHitAnimation(
      data.indexX,
      data.indexY,
      Number(data.knockDx) || 0,
      Number(data.knockDy) || 0
    );
    spawnNatureHitParticles({
      indexX: data.indexX,
      indexY: data.indexY,
      natureType: material,
      kind: "building",
      destroyed: true,
      worldX: Number.isFinite(Number(data.worldX)) ? Number(data.worldX) : undefined,
      worldY: Number.isFinite(Number(data.worldY)) ? Number(data.worldY) : undefined,
    });
    cell.building = null;
  }
});

socket.on("workbenchState", (data) => {
  const me = application.playersList.list.find(p => p.id === socket.id);
  if (!me) return;
  const cell = me.visibleCells.find(c => c.indexX === data.indexX && c.indexY === data.indexY);
  if (cell) {
    cell.workbench = data.workbench ? { ...data.workbench, _receivedAt: performance.now() } : null;
    if (activeWorkbench?.indexX === data.indexX && activeWorkbench?.indexY === data.indexY) activeWorkbench.workbenchData = cell.workbench;
  }
});

socket.on("workbenchHit", (data) => {
  startNatureHitAnimation(data.indexX, data.indexY, Number(data.knockDx) || 0, Number(data.knockDy) || 0);
  spawnNatureHitParticles({ ...data, natureType: "workbench", destroyed: !!data.destroyed });
  updateLocalNatureCell(data.indexX, data.indexY, data.destroyed ? { workbench: null } : { workbench: { ...(application.playersList.list.find(p=>p.id===socket.id)?.visibleCells.find(c=>c.indexX===data.indexX&&c.indexY===data.indexY)?.workbench || {}), hp: data.hp } });
  if (data.destroyed && activeWorkbench?.indexX === data.indexX && activeWorkbench?.indexY === data.indexY) { closeWorkbenchPanel(); }
});

socket.on("saplingUpdate", (data) => {
  updateLocalNatureCell(data.indexX, data.indexY, {
    sapling: data.sapling ?? null,
  });
});

socket.on("saplingHit", (data) => {
  startNatureHitAnimation(data.indexX, data.indexY, data.knockDx, data.knockDy);
  spawnNatureHitParticles({
    indexX: data.indexX,
    indexY: data.indexY,
    natureType: data.kind,
    destroyed: !!data.destroyed,
  });
  if (data.destroyed) {
    const duration = settings?.settings?.NATURE_HIT_ANIM_MS ?? 200;
    setTimeout(() => {
      updateLocalNatureCell(data.indexX, data.indexY, { sapling: null });
      natureHitAnimations.delete(getCellKey(data.indexX, data.indexY));
    }, duration);
  } else if (data.harvested) {
    updateLocalNatureCell(data.indexX, data.indexY, {
      sapling: {
        ...(application.playersList.list
          .find((p) => p.id === socket.id)
          ?.visibleCells?.find(
            (c) => c.indexX === data.indexX && c.indexY === data.indexY
          )?.sapling || {}),
        stage: 0,
        natureImage:
          data.kind === "wildberry" ? "wildberryPlant0" : "blueberryPlant0",
      },
    });
  }
});

socket.on("spear_throw_rejected", (data) => {
  if (data?.reason === "not_enough_energy") {
    localSpear.state = "idle_hand";
    localSpear.timer = 0;
    localSpear.lOffset = 30;
    localSpear.rOffset = 30;
  }
});

socket.on("spear_state", (data) => {
  if (!data?.id || !data?.spearState) return;

  const player = application.playersList.list.find((p) => p.id === data.id);
  if (player) {
    player.spearState = data.spearState;
    player.throwDirection = { x: Number(data.dirX) || 0, y: Number(data.dirY) || 0 };
  }

  if (data.spearState === 'windup') {
    if (data.id === socket.id && localSpear.state === 'idle_hand') {
      localSpear.state = 'windup';
      localSpear.timer = 0;
      localSpear.lOffset = 30;
      localSpear.rOffset = 30;
    }
    return;
  }

  if (data.spearState === 'flying') {
    const dx = Number(data.dirX) || 0;
    const dy = Number(data.dirY) || 0;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const x = Number(data.x);
    const y = Number(data.y);
    if (data.id !== socket.id) {
      flyingSpears[data.id] = { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, angle };
    } else {
      // Authoritative server position. This is the only source that moves
      // the local projectile after the throw.
      localSpear.state = 'flying';
      localSpear.timer = 0;
      localSpear.endOfAnimation = true;
      localSpear.worldX = Number.isFinite(x) ? x : application.myPlayer.renderX;
      localSpear.worldY = Number.isFinite(y) ? y : application.myPlayer.renderY;
      localSpear.dirX = dx;
      localSpear.dirY = dy;
      localSpear.angle = angle;
      localSpear.distance = 0;
      localSpear.lOffset = 0;
      heldItemId = null;
      heldSlotIndex = -1;
    }
    return;
  }

  if (data.id !== socket.id) {
    if (data.spearState === 'landed' || data.spearState === 'none' || data.spearState === 'idle_hand') {
      delete flyingSpears[data.id];
    }
    return;
  }

  if (data.spearState === 'idle_hand') {
    localSpear.state = 'idle_hand';
    localSpear.timer = 0;
    localSpear.lOffset = 30;
    localSpear.rOffset = 30;
    localSpear.distance = 0;
    localSpear.endOfAnimation = false;
    return;
  }

  if (data.spearState === 'landed') {
    localSpear.state = 'landed';
    localSpear.timer = 0;
    localSpear.worldX = Number.isFinite(Number(data.x)) ? Number(data.x) : localSpear.worldX;
    localSpear.worldY = Number.isFinite(Number(data.y)) ? Number(data.y) : localSpear.worldY;
    localSpear.distance = 0;
    heldItemId = null;
    heldSlotIndex = -1;
    return;
  }

  if (data.spearState === 'none') {
    localSpear.state = 'none';
    localSpear.timer = 0;
    localSpear.distance = 0;
    localSpear.lOffset = 30;
    localSpear.rOffset = 30;
    localSpear.endOfAnimation = false;
    heldItemId = null;
    heldSlotIndex = -1;
  }
});

socket.on("spear_throw_rejected", () => {
  // Server did not accept the throw. Return to a usable hand state instead
  // of leaving the local visual projectile in limbo.
  if (heldItemId === 'spear' && localSpear.state === 'flying') {
    localSpear.state = 'idle_hand';
    localSpear.timer = 0;
    localSpear.distance = 0;
    localSpear.lOffset = 30;
    localSpear.rOffset = 30;
    localSpear.endOfAnimation = false;
  }
});

socket.on("spear_landed", (data) => {
  if (data?.id && data.id !== socket.id) {
    delete flyingSpears[data.id];
    return;
  }
  localSpear.state = 'landed';
  localSpear.worldX = Number.isFinite(Number(data?.x)) ? Number(data.x) : localSpear.worldX;
  localSpear.worldY = Number.isFinite(Number(data?.y)) ? Number(data.y) : localSpear.worldY;
  localSpear.timer = 0;
  spearLandAnims.push({ x: localSpear.worldX, y: localSpear.worldY, startedAt: performance.now(), duration: 480, angle: localSpear.angle });
  spearGroundHideUntil.push({ x: localSpear.worldX, y: localSpear.worldY, until: performance.now() + 480 });
});

socket.on("temperatureUpdate", (data) => {
  temperature = data.temperature;
  maxTemperature = data.maxTemperature;
});

socket.on("campfireState", (data) => {
  const me = application.playersList.list.find(p => p.id === socket.id);
  if (!me) return;
  const cell = me.visibleCells.find(c => c.indexX === data.indexX && c.indexY === data.indexY);
  if (cell) {
    cell.campfire = data.campfire ? { ...data.campfire, _receivedAt: performance.now() } : null;
    if (activeCampfire && activeCampfire.indexX === data.indexX && activeCampfire.indexY === data.indexY) {
      activeCampfire.campfireData = cell.campfire;
    }
  }
});

function updateLocalCampfire(indexX, indexY, campfireData) {
  const me = application.playersList.list.find(p => p.id === socket.id);
  if (!me) return;
  const cell = me.visibleCells.find(c => c.indexX === indexX && c.indexY === indexY);
  if (cell) {
    cell.campfire = campfireData;
  }
}

let lastRequestedCellX = 0;
let lastRequestedCellY = 0;

function getCellKey(indexX, indexY) {
  return `${indexX}:${indexY}`;
}

function updateLocalNatureCell(indexX, indexY, patch) {
  const me = application.playersList.list.find((p) => p.id === socket.id);
  if (!me) return;
  const cell = me.visibleCells.find(
    (c) => c.indexX === indexX && c.indexY === indexY
  );
  if (cell) Object.assign(cell, patch);
}

function startNatureHitAnimation(indexX, indexY, knockDx, knockDy) {
  natureHitAnimations.set(getCellKey(indexX, indexY), {
    knockDx,
    knockDy,
    startedAt: performance.now(),
  });
}

function getNatureCellInfo(indexX, indexY) {
  const me = application.playersList.list.find((p) => p.id === socket.id);
  const cell = me?.visibleCells.find(
    (c) => c.indexX === indexX && c.indexY === indexY
  );
  if (cell) {
    const sap = cell.sapling;
    return {
      x: cell.x + cell.w / 2,
      y: cell.y + cell.h / 2,
      radius:
        sap?.hitboxRadius ||
        cell.hitboxRadius ||
        settings?.settings?.DEFAULT_OBJECT_RADIUS ||
        40,
      natureType: sap?.kind || cell.natureType || (cell.workbench ? "workbench" : null),
      natureImage: sap?.natureImage || cell.natureImage,
    };
  }
  const cellSize = settings?.settings?.CELL_SIDE_LENGTH_PIXEL ?? 100;
  return {
    x: indexX * cellSize + cellSize / 2,
    y: indexY * cellSize + cellSize / 2,
    radius: settings?.settings?.DEFAULT_OBJECT_RADIUS ?? 40,
    natureType: null,
    natureImage: null,
  };
}

function pickParticleImage(kind) {
  const pool = particleImages[kind];
  if (!pool?.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnNatureHitParticles(data) {
  const info = getNatureCellInfo(data.indexX, data.indexY);
  const particleX = Number.isFinite(Number(data.worldX)) ? Number(data.worldX) : info.x;
  const particleY = Number.isFinite(Number(data.worldY)) ? Number(data.worldY) : info.y;
  const natureType = data.natureType || info.natureType;
  let kind = NATURE_PARTICLE_KIND[natureType];
  if (natureType === "campfire") {
    kind = data.campfireType === "max" ? "campfireMax" : "campfireNormal";
  }
  if (!kind) return;

  let radius = info.radius;
  if (natureType === "campfire") {
    radius = settings?.settings?.CAMPFIRE_HITBOX_RADIUS ?? 90;
    radius *= 1.75;
  } else {
    const sprite = info.natureImage ? map_img[info.natureImage] : null;
    if (sprite?.complete && sprite.naturalWidth) {
      radius = Math.max(radius, Math.min(sprite.naturalWidth, sprite.naturalHeight) * 0.42);
    }
    if (data.kind === "building") {
      radius = Math.max(radius, 140);
      radius *= 1.25;
    } else if (data.kind === "blueberry" || data.kind === "wildberry") {
      radius *= 1.9;
    } else if (natureType === "blueberry" || natureType === "wildberry") {
      radius *= 1.65;
    }
  }

  const destroyed = !!data.destroyed;
  const count = destroyed ? DESTROY_PARTICLE_COUNT : HIT_PARTICLE_COUNT;
  let life = destroyed ? PARTICLE_LIFE_DESTROY_MS : PARTICLE_LIFE_HIT_MS;
  let edgeMul = destroyed ? 1.35 : 1.12;
  if (kind === "stone" || kind === "steel" || kind === "sulfur" || kind === "campfireNormal" || kind === "campfireMax") {
    edgeMul = destroyed ? 1.85 : 1.55;
    life *= 1.25;
  }
  const now = performance.now();

  for (let i = 0; i < count; i++) {
    const img = pickParticleImage(kind);
    if (!img) continue;

    const angle = Math.random() * Math.PI * 2;
    const r1 = radius * edgeMul * (0.92 + Math.random() * 0.2);

    hitParticles.push({
      img,
      ox: particleX,
      oy: particleY,
      angle,
      r0: radius * 0.08,
      r1,
      rot: angle + Math.PI / 2,
      rotSpeed: (Math.random() - 0.5) * 3,
      scale: destroyed
        ? 0.7 + Math.random() * 0.65
        : 0.55 + Math.random() * 0.4,
      born: now,
      life: life * (0.85 + Math.random() * 0.25),
    });
  }
}

function updateAndDrawHitParticles(cameraX, cameraY, now) {
  for (let i = hitParticles.length - 1; i >= 0; i--) {
    const p = hitParticles[i];
    const age = now - p.born;
    if (age >= p.life) {
      hitParticles.splice(i, 1);
      continue;
    }

    const t = age / p.life;
    const eased = 1 - (1 - t) * (1 - t);
    const r = p.r0 + (p.r1 - p.r0) * eased;
    const x = p.ox + Math.cos(p.angle) * r;
    const y = p.oy + Math.sin(p.angle) * r;
    p.rot += p.rotSpeed * (1 / 60);

    const alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
    const img = p.img;
    if (!img?.complete || !img.naturalWidth) continue;

    const w = img.naturalWidth * p.scale;
    const h = img.naturalHeight * p.scale;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(x - cameraX, y - cameraY);
    ctx.rotate(p.rot);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

function getNatureHitOffset(indexX, indexY) {
  const key = getCellKey(indexX, indexY);
  const anim = natureHitAnimations.get(key);
  if (!anim) return { x: 0, y: 0 };

  const duration = settings?.settings?.NATURE_HIT_ANIM_MS ?? 200;
  const elapsed = performance.now() - anim.startedAt;

  if (elapsed >= duration) {
    natureHitAnimations.delete(key);
    return { x: 0, y: 0 };
  }

  const half = duration / 2;
  const factor =
    elapsed < half ? elapsed / half : 1 - (elapsed - half) / half;

  return {
    x: anim.knockDx * factor,
    y: anim.knockDy * factor,
  };
}

function calculateCellsVisionZone(x, y) {
  const cellSize = settings.settings.CELL_SIDE_LENGTH_PIXEL;
  const cellX = Math.ceil(x / cellSize);
  const cellY = Math.ceil(y / cellSize);
  if (cellX === lastRequestedCellX && cellY === lastRequestedCellY) return;
  lastRequestedCellX = cellX;
  lastRequestedCellY = cellY;
  application.myPlayer.playerXCell = cellX;
  application.myPlayer.playerYCell = cellY;
  socket.emit("getVisibleCells", { id: socket.id });
}

function drawCircle(x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function cleanupEffectOverlays() {
  const now = performance.now();
  for (const [key, overlay] of effectOverlays.entries()) {
    if (now > overlay.until) {
      effectOverlays.delete(key);
    }
  }
}

function drawEffectOverlays(playerId, px, py) {
  const overlaySize = 178;
  const overlayHalf = overlaySize / 2;
  const overlayTop = py - 91;

  for (const overlay of effectOverlays.values()) {
    if (overlay.playerId !== playerId) continue;
    const img = overlay.type === "hurt" ? images.hurt : images.heal;
    ctx.drawImage(img, px - overlayHalf, overlayTop, overlaySize, overlaySize);
  }
}

function drawPlayerAlert(px, py, playerId) {
  const state = getPlayerAlertState(playerId);
  if (!state.current) return;

  const alertImg =
    state.current.tier === 2
      ? images.alert2
      : state.current.tier === 1
        ? images.alert1
        : images.alert0;

  const alertSize = 96;
  const alertX = px + 55;
  const alertY = py - 140;

  ctx.save();
  ctx.globalAlpha = state.current.alpha;
  ctx.translate(alertX + alertSize, alertY);
  ctx.scale(-1, 1);
  ctx.drawImage(alertImg, 0, 0, alertSize, alertSize);
  ctx.restore();
}

function arcToward(from, to, t, side) {
  const mx = (from.x + to.x) * 0.5;
  const my = (from.y + to.y) * 0.5;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bulge = 22 * side;
  const cx = mx - (dy / len) * bulge;
  const cy = my + (dx / len) * bulge;
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
    y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
  };
}

function drawPlayerEntity(player, cameraX, cameraY, isMe, attackAnim) {
  const px = isMe ? 0 : player.renderX - cameraX;
  const py = isMe ? 0 : player.renderY - cameraY;

  const name = ClanUI.getPlayerDisplayName(player);
  ctx.fillStyle = "white";
  ctx.font = "30px Verdana";
  ctx.textAlign = "center";
  ctx.fillText(name, px, py - 118);
  ctx.textAlign = "left";

  drawEffectOverlays(player.id, px, py);

  const holdingBerry = isShowingHeldBerry(player, isMe);
  const building = isInBuildMode(player, isMe);
  const heldIdForRender = isMe ? heldItemId : player?.heldItemId;
  const holdingTool = isToolItem(heldIdForRender);
  const eatEntity = isMe ? application.myPlayer : player;
  const eatSqueeze = holdingBerry ? getEatSqueeze(eatEntity) : 0;

  const handSpearStates = ['idle_hand', 'windup'];
  const isSpear = isMe ? handSpearStates.includes(localSpear.state) : handSpearStates.includes(player.spearState);
  const spearIsFlying = isMe ? localSpear.state === 'flying' : player.spearState === 'flying';
  const spearData = isMe ? localSpear : null;

  ctx.save();
  const angleRad = (player.angle * Math.PI) / 180;
  ctx.translate(px, py);
  ctx.rotate(angleRad);

  const bodySize = 178;
  const bodyHalf = bodySize / 2;

  if (isSpear && !spearIsFlying) {
    const leftHandX = -images.leftHand.width / 60 + (spearData ? spearData.lOffset : 30);
    const leftHandY = -bodyHalf;
    const rightHandX = -images.rightHand.width / 60 + 18 - (spearData ? (spearData.rOffset - 12) : 0);
    const rightHandY = bodyHalf - 60;

    // Arms stay behind the torso; the body must occlude their inner portions.
    ctx.drawImage(images.leftHand, leftHandX, leftHandY);
    ctx.drawImage(images.rightHand, rightHandX, rightHandY);
    ctx.drawImage(images.player, -bodyHalf, -bodyHalf, bodySize, bodySize);

    const spearImg = images.spearHand;
    if (spearImg?.complete && spearImg.naturalWidth) {
      let sw = 80;
      let sh = (spearImg.naturalHeight / spearImg.naturalWidth) * sw;
      
      ctx.save();
      ctx.translate(leftHandX, leftHandY);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(spearImg, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }
    ctx.restore();
    drawPlayerAlert(px, py, player.id);
    if (showDebugHitboxes && isMe) {
      ctx.strokeStyle = "black";
      ctx.lineWidth = 2 / scale;
      drawCircle(px, py, player.hitboxRadius ?? settings.settings.PLAYER_HITBOX_RADIUS);
    }
    return;
  }

  if (isSpear && isMe && localSpear.state === 'flying') {
    ctx.drawImage(images.player, -bodyHalf, -bodyHalf, bodySize, bodySize);
  } else {
    if (holdingTool) {
      const isHatchet = heldIdForRender === "hatchet";
      const isHammer = heldIdForRender === "hammer";
      const toolImg = isHatchet ? images.hatchetHand : (isHammer ? images.hammerHand : images.pickaxeStoneHand);
      const elapsed = performance.now() - (isMe ? application.myPlayer.attackStartedAt : player.attackStartedAt);
      const duration = player.attackAnimDuration || (isHatchet ? 400 : (isHammer ? 1000 : 700));
      const attacking = !!player.isAttacking && elapsed >= 0 && elapsed < duration;
      const t = attacking ? Math.min(1, Math.max(0, elapsed / duration)) : 0;
      // A single smooth arc: neutral -> full backswing -> neutral.
      // This prevents the old snap at the end of the attack.
      const swing = attacking ? Math.sin(t * Math.PI) : 0;
      const swingAngle = -0.95 * swing;

      // The player is the base layer. Hands and tool are explicitly rendered
      // afterwards so the body can never hide them. Both hands follow the same
      // swing and stay vertically centred relative to the player.
      // Tool-holding hands stay 20px lower than the old neutral position.
      // During the swing they also separate horizontally so both hands read
      // as if they are gripping the same handle.
      const leftX = -images.leftHand.width / 60 - (attacking ? swing * 40 : 0);
      const leftY = -bodyHalf;
      const rightX = -images.rightHand.width / 60 + 20 + (attacking ? swing * 10 : 0);
      const rightY = bodyHalf - 65;
      // Hands are a rear layer: draw them first so the player's body always
      // occludes the part of the arms that enters the torso.
      ctx.save();
      const handPivotX = leftX + images.leftHand.width * 0.5;
      const handPivotY = leftY + images.leftHand.height * 0.5;
      ctx.translate(handPivotX, handPivotY);
      ctx.rotate(swingAngle * 0.55);
      ctx.translate(-handPivotX, -handPivotY);
      ctx.drawImage(images.leftHand, leftX, leftY);
      ctx.restore();

      ctx.save();
      const rightHandSwingX = rightX + swing * 10;
      const rightHandSwingY = rightY + swing * 4;
      ctx.translate(rightHandSwingX + images.rightHand.width * 0.5, rightHandSwingY + images.rightHand.height * 0.5);
      ctx.rotate(swingAngle * 0.35);
      ctx.drawImage(images.rightHand, -images.rightHand.width * 0.5, -images.rightHand.height * 0.5);
      ctx.restore();

      // Tool is drawn together with the hands, behind the player's body.
      // This makes the torso occlude the part of the tool that enters the body.
      if (toolImg?.complete && toolImg.naturalWidth) {
        // Preserve the existing neutral proportions while applying the requested
        // hand-tool scaling: pickaxe ~1.7x, hatchet ~0.7x.
        const baseToolLength = isHatchet ? 105 : (isHammer ? 349 : 349);
        const toolScale = isHatchet ? 1.2 : (isHammer ? 0.5 : (heldIdForRender === "pickaxe_stone" ? (1 / 1.4) : 1));
        const toolLength = baseToolLength * toolScale;
        const th = toolImg.naturalHeight / toolImg.naturalWidth * toolLength;
        const handX = leftX + images.leftHand.width * 0.62 + 38;
        const handY = 10;
        ctx.save();
        ctx.translate(handX, handY);
        ctx.rotate(swingAngle);
        ctx.drawImage(toolImg, -toolLength / 2, -th / 2, toolLength, th);
        ctx.restore();
      }

      // Body is deliberately rendered last in the tool-holding layer.
      // The torso therefore occludes both hands and the tool where they overlap it.
      ctx.drawImage(images.player, -bodyHalf, -bodyHalf, bodySize, bodySize);
    } else if (building) {
      const leftHandX = -images.leftHand.width / 60;
      const leftHandY = -bodyHalf;
      const rightHandX = -images.rightHand.width / 60;
      const rightHandY = bodyHalf - 60;
      ctx.drawImage(images.leftHand, leftHandX, leftHandY);
      ctx.drawImage(images.rightHand, rightHandX, rightHandY);
      ctx.drawImage(images.player, -bodyHalf, -bodyHalf, bodySize, bodySize);
      
      const leftCx = leftHandX + images.leftHand.width * 0.5;
      const leftCy = leftHandY + images.leftHand.height * 0.5;
      const rightCx = rightHandX + images.rightHand.width * 0.5;
      const rightCy = rightHandY + images.rightHand.height * 0.5;
      const pencil = images.handCraftPencil;
      if (pencil?.complete && pencil.naturalWidth) {
        const pw = Math.min(112, pencil.naturalWidth * 0.52);
        const ph = (pencil.naturalHeight / pencil.naturalWidth) * pw;
        ctx.drawImage(pencil, rightCx - pw * 0.5, rightCy - ph / 2, pw, ph);
      }
      const craft = images.handCraft;
      if (craft?.complete && craft.naturalWidth) {
        const cw = Math.min(84, craft.naturalWidth * 0.88);
        const ch = (craft.naturalHeight / craft.naturalWidth) * cw;
        ctx.save();
        ctx.translate(leftCx + 22, leftCy - 20);
        ctx.rotate((-120 * Math.PI) / 180);
        ctx.drawImage(craft, -cw / 2, -ch / 2, cw, ch);
        ctx.restore();
      }
    } else if (holdingBerry) {
      const berryHold = { x: 91, y: 4 };
      const berryBite = { x: 85, y: 4 };
      const s = eatSqueeze;
      const ox = berryHold.x + (berryBite.x - berryHold.x) * s;
      const oy = berryHold.y + (berryBite.y - berryHold.y) * s;
      const leftHold = { x: -4, y: -74 };
      const rightHold = { x: -4, y: 10 };
      const leftTarget = { x: ox - 50, y: oy - 34 };
      const rightTarget = { x: ox - 50, y: oy - 2 };
      const left = arcToward(leftHold, leftTarget, s, -1);
      const right = arcToward(rightHold, rightTarget, s, 1);
      ctx.drawImage(images.leftHand, left.x, left.y);
      ctx.drawImage(images.rightHand, right.x, right.y);
      const heldId = (isMe ? heldItemId : player?.heldItemId) || eatEntity?.eatItemId || "blueberry";
      const handImg = getHandBerryImage(heldId);
      if (handImg?.complete && handImg.naturalWidth) {
        const hw = handImg.naturalWidth * (1 - s * 0.08);
        const hh = handImg.naturalHeight * (1 - s * 0.08);
        ctx.drawImage(handImg, ox - hw / 2, oy - hh / 2, hw, hh);
      }
      // The player body is intentionally above the held berry, matching the
      // depth order of the character instead of letting the berry cover the torso.
      ctx.drawImage(images.player, -bodyHalf, -bodyHalf, bodySize, bodySize);
    } else {
      const lOffset = attackAnim.lOffset ?? 0;
      const rOffset = attackAnim.rOffset ?? 0;
      const activeOffset = lOffset !== 0 ? lOffset : rOffset;
      const swingAngle = Math.PI * (activeOffset / 180);
      ctx.rotate(swingAngle + swingAngle / 2);
      ctx.drawImage(images.leftHand, -images.leftHand.width / 60 + lOffset, -bodyHalf);
      ctx.drawImage(images.rightHand, -images.rightHand.width / 60 + rOffset, bodyHalf - 60);
      ctx.rotate(-swingAngle);
      ctx.drawImage(images.player, -bodyHalf, -bodyHalf, bodySize, bodySize);
      ctx.rotate(-swingAngle / 2);
    }
  }

  ctx.restore();

  if (isMe && localSpear.state === 'flying') {
    const spearImg = images.spearHand;
    if (spearImg?.complete && spearImg.naturalWidth) {
      let sw = 80;
      let sh = (spearImg.naturalHeight / spearImg.naturalWidth) * sw;
      const flyScreenX = localSpear.worldX - cameraX;
      const flyScreenY = localSpear.worldY - cameraY;
      ctx.save();
      ctx.translate(flyScreenX, flyScreenY);
      ctx.rotate((localSpear.angle + 90) * Math.PI / 180);
      ctx.drawImage(spearImg, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }
  }

  drawPlayerAlert(px, py, player.id);
  if (showDebugHitboxes && isMe) {
    ctx.strokeStyle = "black"; ctx.lineWidth = 2 / scale;
    drawCircle(px, py, player.hitboxRadius ?? settings.settings.PLAYER_HITBOX_RADIUS);
    const tool = player.attackTool || "hand";
    const profile = getClientToolProfile(tool);
    const dist = profile?.zoneDistance ?? settings.settings.ATTACK_ZONE_DISTANCE;
    const rad = profile?.zoneRadius ?? settings.settings.ATTACK_ZONE_RADIUS;
    const ar = (player.angle * Math.PI) / 180;
    drawCircle(px + Math.cos(ar) * dist, py + Math.sin(ar) * dist, rad);
  }
}

function drawActionTimerAbove(px, py, extraYOffset = 0) {
  if (!actionTimer) return;
  const now = performance.now();
  const t = Math.min(1, (now - actionTimer.startedAt) / actionTimer.duration);
  const face = images.timer;
  const arrow = images.timerArrow;
  if (!face?.complete || !face.naturalWidth) return;

  const tw = face.naturalWidth * 0.55;
  const th = face.naturalHeight * 0.55;
  const tx = px - tw / 2;
  const ty = py - 210 + extraYOffset;

  ctx.save();
  ctx.drawImage(face, tx, ty, tw, th);

  if (arrow?.complete && arrow.naturalWidth) {
    const dialX = tx + (59.5 / face.naturalWidth) * tw;
    const dialY = ty + (75.25 / face.naturalHeight) * th;
    const pivotX = (59.5 / arrow.naturalWidth) * tw;
    const pivotY = (75.3 / arrow.naturalHeight) * th;
    ctx.translate(dialX, dialY);
    ctx.rotate(t * Math.PI * 2);
    ctx.drawImage(arrow, -pivotX, -pivotY, tw, th);
  }
  ctx.restore();
}

function inventoryHasSpaceFor(itemId) {
  const stackMax = 100;
  let free = 0;
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];
    if (!slot) free += stackMax;
    else if (slot.itemId === itemId) free += Math.max(0, stackMax - slot.amount);
  }
  return free > 0;
}

function hydrateGroundLootTimers(loot, now = performance.now()) {
  if (!loot) return loot;
  const wait = Number(loot.pickableInMs) || 0;
  const expiresIn = Number(loot.expiresInMs);
  return {
    ...loot,
    pickableUntil: wait > 0 ? now + wait : 0,
    expiresUntil: Number.isFinite(expiresIn) ? now + expiresIn : loot.expiresUntil,
  };
}

function hydrateBuildingAnimationState(building, now = performance.now()) {
  if (!building || building.kind !== "door") return;
  const state = String(building.state ?? "CLOSED").toUpperCase();
  const progress = Math.max(0, Math.min(1, Number(building.doorProgress) || (state === "OPEN" ? 1 : 0)));
  if (state === "OPENING") {
    building._animReceivedAt = now - progress * 600;
  } else if (state === "CLOSING") {
    building._animReceivedAt = now - (1 - progress) * 600;
  } else {
    building._animReceivedAt = now;
  }
}

function hydrateCellsGroundTimers(cells) {
  if (!Array.isArray(cells)) return cells;
  const now = performance.now();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const items = getCellGroundItems(cell);
    if (items.length) {
      const next = items.map((loot) => hydrateGroundLootTimers(loot, now));
      cell.groundItems = next;
      cell.groundItem = next[0] ?? null;
    }
    if (cell._buildingData) {
      cell.building = cell._buildingData;
      delete cell._buildingData;
      hydrateBuildingAnimationState(cell.building, now);
    } else if (cell.building) {
      hydrateBuildingAnimationState(cell.building, now);
    }
    if (cell._campfireData) {
      cell.campfire = cell._campfireData;
      delete cell._campfireData;
    }
  }
  return cells;
}

function getCellGroundItems(cell) {
  if (Array.isArray(cell?.groundItems) && cell.groundItems.length) {
    return cell.groundItems;
  }
  if (cell?.groundItem?.itemId) return [cell.groundItem];
  return [];
}

function findNearestInteractableGround(visibleCells) {
  const radius = application.myPlayer.interactionRadius ?? settings?.settings?.INTERACTION_RADIUS ?? 200;
  const pickRadius = radius + 8;
  const px = application.myPlayer.renderX;
  const py = application.myPlayer.renderY;
  const now = performance.now();
  let best = null;
  let bestDist = pickRadius;

  for (const cell of visibleCells) {
    const items = getCellGroundItems(cell);
    for (let i = 0; i < items.length; i++) {
      const ground = items[i];
      if (!ground?.itemId) continue;
      if (!inventoryHasSpaceFor(ground.itemId)) continue;

      const hideKey = ground.id || getCellKey(cell.indexX, cell.indexY);
      const hideUntil = hiddenGroundUntil.get(hideKey);
      if (hideUntil && now < hideUntil) continue;
      if (ground.pickableUntil && now < ground.pickableUntil) continue;
      if (ground.expiresUntil && now >= ground.expiresUntil) continue;

      const gx = ground.x ?? cell.x + cell.w / 2;
      const gy = ground.y ?? cell.y + cell.h / 2;
      const dist = Math.hypot(gx - px, gy - py);
      if (dist <= bestDist) {
        bestDist = dist;
        best = { cell, itemId: ground.itemId, lootId: ground.id, dist };
      }
    }
  }
  return best;
}

function drawLootInteractionHint(itemId, cameraX, cameraY, offsetX = 0) {
  const lootImg = item_img.lootHint;
  if (!lootImg || !lootImg.complete || !lootImg.naturalWidth) return;

  const px = 0;
  const py = 0;
  const lootW = lootImg.naturalWidth;
  const lootH = lootImg.naturalHeight;
  const drawX = px + offsetX - lootW / 2;
  const drawY = py - 150 - lootH / 2;

  ctx.drawImage(lootImg, drawX, drawY, lootW, lootH);

  const itemImg = getGroundImage(itemId);
  if (!itemImg || !itemImg.complete || !itemImg.naturalWidth) return;

  const slotX = 108;
  const slotY = 19;
  const slotW = 93;
  const slotH = 92;
  const pad = 8;
  const maxW = slotW - pad * 2;
  const maxH = slotH - pad * 2;
  const fit = Math.min(maxW / itemImg.naturalWidth, maxH / itemImg.naturalHeight);
  const dw = itemImg.naturalWidth * fit;
  const dh = itemImg.naturalHeight * fit;
  const iconX = drawX + slotX + (slotW - dw) / 2;
  const iconY = drawY + slotY + (slotH - dh) / 2;
  ctx.drawImage(itemImg, iconX, iconY, dw, dh);
}

function drawCampfireInteractionHint(cameraX, cameraY, offsetX = 0) {
  const nearest = findNearestCampfire();
  if (!nearest) return;
  
  const eImg = images.eCampfire;
  if (!eImg || !eImg.complete || !eImg.naturalWidth) return;
  
  const px = 0;
  const py = 0;
  const w = eImg.naturalWidth;
  const h = eImg.naturalHeight;
  const drawX = px + offsetX - w / 2;
  const drawY = py - 150 - h / 2;
  ctx.drawImage(eImg, drawX, drawY, w, h);
}

function getInventoryLayout() {
  const slotsCount = settings?.settings?.INVENTORY_SLOTS ?? 8;
  const emptyImg = item_img.invEmpty;
  const slotSize = emptyImg?.naturalWidth || 64;
  const gap = 6;
  const totalW = slotsCount * slotSize + (slotsCount - 1) * gap;
  const startX = Math.round((canvas.width - totalW) / 2);
  const startY = canvas.height - slotSize - 18;
  const slots = [];
  for (let i = 0; i < slotsCount; i++) {
    slots.push({
      index: i,
      x: startX + i * (slotSize + gap),
      y: startY,
      size: slotSize,
    });
  }
  return { slots, slotSize, startX, startY, totalW };
}

function hitTestInventorySlot(clientX, clientY) {
  const layout = getInventoryLayout();
  for (let i = 0; i < layout.slots.length; i++) {
    const s = layout.slots[i];
    if (clientX >= s.x && clientX <= s.x + s.size && clientY >= s.y && clientY <= s.y + s.size) {
      return i;
    }
  }
  return -1;
}

function screenToWorld(clientX, clientY) {
  return {
    x: application.myPlayer.renderX + (clientX - canvas.width / 2) / scale,
    y: application.myPlayer.renderY + (clientY - canvas.height / 2) / scale,
  };
}

function activateInventorySlot(slotIndex) {
  const slot = inventory[slotIndex];
  if (!slot) return false;
  const itemId = slot.itemId;
  if (isEdibleBerry(itemId)) return tryBeginEquipBerry(slotIndex);
  if (isBuildSeed(itemId)) return tryBeginEquipSeed(slotIndex);
  if (itemId === "spear") return tryBeginEquipSpear(slotIndex);
  if (itemId === "campfire" || itemId === "campfire_max") return tryBeginEquipCampfire(slotIndex);
  if (itemId === "workbench") return tryBeginEquipWorkbench(slotIndex);
  if (isBuildingItemClient(itemId)) return tryBeginEquipBuilding(slotIndex);
  if (isToolItem(itemId)) return tryBeginEquipTool(slotIndex);
  return false;
}

function finishInventoryDrag(clientX, clientY) {
  if (!invDrag) return;
  const from = invDrag.fromIndex;
  const wasDragging = invDrag.dragging;
  const itemId = invDrag.itemId;
  invDrag = null;

  if (!wasDragging) {
    activateInventorySlot(from);
    return;
  }
  const to = hitTestInventorySlot(clientX, clientY);
  if (to === -1) {
    if (heldItemId === 'spear' && from === heldSlotIndex) {
      unequipHeldItem();
    }
    const world = screenToWorld(clientX, clientY);
    socket.emit("inventoryDrop", {
      slotIndex: from,
      dirX: world.x - application.myPlayer.renderX,
      dirY: world.y - application.myPlayer.renderY,
    });
    return;
  }
  if (to === from) return;
  socket.emit("inventoryMove", { from, to });
}

function countLocalItem(itemId) {
  let total = 0;
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];
    if (slot?.itemId === itemId) total += slot.amount;
  }
  return total;
}


function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function getCraftButtonRect() {
  const img = images.craftButton;
  const size = img?.naturalWidth ? Math.min(72, img.naturalWidth) : 64;
  return { x: 16, y: 16, w: size, h: size };
}

function getCraftPanelRect() {
  const img = images.craftBox;
  if (!img?.naturalWidth) {
    return { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  }
  const maxW = Math.min(900, canvas.width * 0.72);
  const maxH = Math.min(640, canvas.height * 0.78);
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  return {
    x: Math.round((canvas.width - w) / 2),
    y: Math.round((canvas.height - h) / 2),
    w,
    h,
    scale,
  };
}

function craftNativeToScreen(nx, ny, panel) {
  return {
    x: panel.x + nx * panel.scale,
    y: panel.y + ny * panel.scale,
  };
}

function getCraftGridSlots(panel) {
  const layout = craftLayout?.grid;
  if (!layout) return [];
  const slots = [];
  const size = layout.cellSize * panel.scale;
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      const index = row * layout.cols + col;
      const origin = craftNativeToScreen(layout.colStarts[col], layout.origins[row], panel);
      slots.push({
        index,
        x: origin.x,
        y: origin.y,
        w: size,
        h: size,
      });
    }
  }
  return slots;
}

function getWorkbenchCraftRecipes() {
  // The server marks every workbench-only recipe with station: "workbench".
  // Keep the existing normal recipes that are intentionally available in the
  // workbench, and include all building recipes without maintaining a second
  // hard-coded list on the client.
  const ids = new Set([
    "wood_spear",
    "campfire",
    "campfire_max",
    "workbench",
    "hatchet",
    "pickaxe_stone",
  ]);
  return craftRecipes.filter((r) => r?.station === "workbench" || ids.has(r?.id));
}

function getNormalCraftRecipes() { return craftRecipes.filter(r => r.station === "normal"); }
function getSelectedCraftRecipe() { return getNormalCraftRecipes()[selectedCraftIndex] ?? null; }

function canCraftRecipe(recipe) {
  if (!recipe) return false;
  if (craftQueueState.queue.length >= (craftQueueState.max || 4)) return false;
  for (const ing of recipe.ingredients) {
    if (countLocalItem(ing.itemId) < ing.amount) return false;
  }
  return true;
}

function canCraftCampfireRecipe(recipe) {
  if (!recipe) return false;
  for (const ing of recipe.ingredients || []) {
    if (countLocalItem(ing.itemId) < ing.amount) return false;
  }
  return true;
}

function getCraftQueueBarLayout() {
  const btn = getCraftButtonRect();
  const iconSize = 40;
  const barH = 22;
  const barW = Math.max(220, btn.w * 3.1);
  const xBtn = 32;
  const gap = 8;
  const rowH = 48;
  const startY = btn.y + btn.h + 12;
  return { x: btn.x, startY, barW, barH, rowH, xBtn, iconSize, gap };
}

function getCraftQueueRowRects() {
  const layout = getCraftQueueBarLayout();
  const rows = [];
  for (let i = 0; i < craftQueueState.queue.length; i++) {
    const y = layout.startY + i * layout.rowH;
    const icon = {
      x: layout.x,
      y: y + (layout.rowH - layout.iconSize) / 2 - 4,
      w: layout.iconSize,
      h: layout.iconSize,
    };
    const bar = {
      x: icon.x + icon.w + layout.gap,
      y: y + (layout.rowH - layout.barH) / 2 - 4,
      w: layout.barW,
      h: layout.barH,
    };
    const cancel = {
      x: bar.x + bar.w + layout.gap,
      y: y + (layout.rowH - layout.xBtn) / 2 - 4,
      w: layout.xBtn,
      h: layout.xBtn,
    };
    rows.push({ index: i, icon, bar, cancel });
  }
  return rows;
}

function getCraftActionButtonRect(panel) {
  if (!panel || !craftLayout) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const btn = craftLayout.craftButton;
  if (btn) {
    return {
      x: panel.x + btn.x * panel.scale,
      y: panel.y + btn.y * panel.scale,
      w: btn.w * panel.scale,
      h: btn.h * panel.scale,
    };
  }
  const resultCenter = craftNativeToScreen(craftLayout.result.cx, craftLayout.result.cy, panel);
  const w = 132 * panel.scale;
  const h = 40 * panel.scale;
  return {
    x: resultCenter.x - w / 2,
    y: panel.y + panel.h * 0.52,
    w,
    h,
  };
}

function getCampfireQueueRowRects(panel) {
  // Keep the queue rows exactly the same size as the normal crafting queue.
  const layout = getCraftQueueBarLayout();
  const iconSize = layout.iconSize;
  const barH = layout.barH;
  const xBtn = layout.xBtn;
  const gap = layout.gap;
  const rowH = layout.rowH;
  const barW = Math.min(layout.barW, 310 * panel.scale);
  const totalW = iconSize + gap + barW + gap + xBtn;
  // Center the queue group under the same five ingredient cells used above.
  const ing = craftLayout?.ingredients;
  const ingCenterNative = ing ? ing.startX + (5 * ing.cellSize + 4 * ing.gap) / 2 : 932;
  const centerX = panel.x + ingCenterNative * panel.scale;
  const x = centerX - totalW / 2;
  const craftBtn = getCraftActionButtonRect(panel);
  const startY = craftBtn.y + craftBtn.h + 46;
  return Array.from({ length: activeCampfire?.campfireData?.craftQueue?.length || 0 }, (_, index) => {
    const y = startY + index * rowH;
    const icon = { x, y: y + (rowH - iconSize) / 2, w: iconSize, h: iconSize };
    const bar = { x: icon.x + icon.w + gap, y: y + (rowH - barH) / 2, w: barW, h: barH };
    const action = { x: bar.x + bar.w + gap, y: y + (rowH - xBtn) / 2, w: xBtn, h: xBtn };
    return { index, icon, bar, action };
  });
}

function getCampfireJobProgress(job, cfData) {
  const now = performance.now();
  const duration = Math.max(1, Number(job.durationMs) || 5000);
  let elapsed = Number(job.elapsed) || 0;
  if (job.status === "active" && cfData?._receivedAt) {
    elapsed += Math.min(duration - elapsed, Math.max(0, now - cfData._receivedAt));
  }
  return Math.max(0, Math.min(1, elapsed / duration));
}

function getCraftJobProgress(job) {
  const now = performance.now();
  const duration = job.durationMs || 5000;
  if (!job.active) {
    return { progress: 0, duration, recipeId: job.recipeId };
  }
  const remaining = Math.max(0, (job.endsAt ?? now) - now);
  return {
    progress: Math.max(0, Math.min(1, 1 - remaining / duration)),
    duration,
    recipeId: job.recipeId,
  };
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}


function handleCraftPointerDown(event) {
  if (event.button !== 0) return false;

  const btn = getCraftButtonRect();
  if (pointInRect(event.clientX, event.clientY, btn)) {
    craftOpen = !craftOpen;
    if (craftOpen) {
      campfirePanelOpen = false;
      activeCampfire = null;
      workbenchPanelOpen = false;
      activeWorkbench = null;
    }
    return true;
  }

  const queueRows = getCraftQueueRowRects();
  for (let i = 0; i < queueRows.length; i++) {
    if (pointInRect(event.clientX, event.clientY, queueRows[i].cancel)) {
      socket.emit("cancelCraft", { index: queueRows[i].index });
      return true;
    }
  }

  // === ОЧЕРЕДЬ ВЕРСТАКА ===
  if (workbenchPanelOpen && activeWorkbench) {
    const rows = getWorkbenchQueueRowRects(getCraftPanelRect());
    for (const row of rows) {
      if (!pointInRect(event.clientX, event.clientY, row.action)) continue;
      const job = activeWorkbench.workbenchData?.craftQueue?.[row.index];
      if (!job) return true;
      socket.emit(job.status === "ready" ? "takeWorkbenchItem" : "cancelWorkbenchCraft", { indexX: activeWorkbench.indexX, indexY: activeWorkbench.indexY, index: row.index });
      return true;
    }
  }

  if (workbenchPanelOpen && activeWorkbench) {
    const panel = getCraftPanelRect();
    if (!pointInRect(event.clientX, event.clientY, panel)) { closeWorkbenchPanel(); return true; }
    const allowedRecipes = getWorkbenchCraftRecipes();
    const slots = getCraftGridSlots(panel);
    for (let i = 0; i < slots.length; i++) {
      if (pointInRect(event.clientX, event.clientY, slots[i])) { if (i < allowedRecipes.length) selectedWorkbenchRecipeIndex = i; return true; }
    }
    const recipe = allowedRecipes[selectedWorkbenchRecipeIndex];
    const craftBtn = getCraftActionButtonRect(panel);
    if (recipe && canCraftCampfireRecipe(recipe) && pointInRect(event.clientX, event.clientY, craftBtn)) {
      const queue = activeWorkbench.workbenchData?.craftQueue || [];
      if (queue.length < (settings?.settings?.WORKBENCH?.craftQueueMax ?? 4)) socket.emit("workbenchCraft", { indexX: activeWorkbench.indexX, indexY: activeWorkbench.indexY, recipeId: recipe.id });
      return true;
    }
    return true;
  }

  // === ОЧЕРЕДЬ КОСТРА ===
  if (campfirePanelOpen && activeCampfire) {
    const cfRows = getCampfireQueueRowRects(getCraftPanelRect());
    for (const row of cfRows) {
      if (!pointInRect(event.clientX, event.clientY, row.action)) continue;
      const job = activeCampfire.campfireData?.craftQueue?.[row.index];
      if (!job) return true;
      if (job.status === "ready") {
        socket.emit("takeCampfireItem", { indexX: activeCampfire.indexX, indexY: activeCampfire.indexY, index: row.index });
      } else {
        socket.emit("cancelCampfireCraft", { indexX: activeCampfire.indexX, indexY: activeCampfire.indexY, index: row.index });
      }
      return true;
    }
  }

  // === ОБРАБОТКА ПАНЕЛИ КОСТРА ===
  if (campfirePanelOpen && activeCampfire) {
    const panel = getCraftPanelRect();
    if (!pointInRect(event.clientX, event.clientY, panel)) {
      closeCampfirePanel();
      return true;
    }
    
    const cfType = activeCampfire?.campfireData?.type === 'max' ? 'campfire_max' : 'campfire';
    const allowedRecipes = craftRecipes.filter(r => r.station === 'campfire' || (cfType === 'campfire_max' && r.id === 'metal'));
    const slots = getCraftGridSlots(panel);
    for (let i = 0; i < slots.length; i++) {
      if (pointInRect(event.clientX, event.clientY, slots[i])) {
        if (i < allowedRecipes.length) {
          selectedCampfireRecipeIndex = i;
        }
        return true;
      }
    }
    
    const craftBtn = getCraftActionButtonRect(panel);
    const craftW = craftBtn.w * 0.6;
    const gap = 8;
    const plusW = craftBtn.w * 0.3;
    const totalW = craftW + gap + plusW;
    const startX = craftBtn.x + (craftBtn.w - totalW) / 2;
    const craftRect = { x: startX, y: craftBtn.y, w: craftW, h: craftBtn.h };
    const plusRect = { x: startX + craftW + gap, y: craftBtn.y, w: plusW, h: craftBtn.h };
    
    if (pointInRect(event.clientX, event.clientY, craftRect)) {
      const recipe = allowedRecipes[selectedCampfireRecipeIndex];
      if (recipe && canCraftCampfireRecipe(recipe)) {
        const cfData = activeCampfire.campfireData;
        if (cfData && cfData.isBurning && (cfData.craftQueue?.length || 0) < (settings?.settings?.CAMPFIRE_CRAFT_QUEUE_MAX || 4)) {
          socket.emit("campfireCraft", {
            indexX: activeCampfire.indexX,
            indexY: activeCampfire.indexY,
            recipeId: recipe.id,
          });
        } else {
          // Топлива нет или очередь полна – можно показать сообщение
          console.warn("Cannot craft: no fuel or queue full");
        }
      }
      return true;
    }
    
    if (pointInRect(event.clientX, event.clientY, plusRect)) {
      socket.emit("addFuel", {
        indexX: activeCampfire.indexX,
        indexY: activeCampfire.indexY,
      });
      return true;
    }
    
    return true;
  }

  // === ОБЫЧНЫЙ КРАФТ ===
  if (!craftOpen) return false;

  const panel = getCraftPanelRect();
  if (!pointInRect(event.clientX, event.clientY, panel)) {
    craftOpen = false;
    return true;
  }

  const normalRecipes = getNormalCraftRecipes();
  const slots = getCraftGridSlots(panel);
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!pointInRect(event.clientX, event.clientY, slot)) continue;
    if (slot.index < normalRecipes.length) selectedCraftIndex = slot.index;
    return true;
  }

  const recipe = getSelectedCraftRecipe();
  const craftBtn = getCraftActionButtonRect(panel);
  if (recipe && canCraftRecipe(recipe) && craftBtn.w > 0 && pointInRect(event.clientX, event.clientY, craftBtn)) {
    socket.emit("craftItem", { recipeId: recipe.id });
    return true;
  }

  return true;
}


function drawCraftButton() {
  const img = images.craftButton;
  const rect = getCraftButtonRect();
  if (img && img.complete && img.naturalWidth) {
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  } else {
    ctx.fillStyle = "#8a7a3a";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  if (!craftQueueState.queue.length) return;

  const rows = getCraftQueueRowRects();
  ctx.save();
  for (let i = 0; i < rows.length; i++) {
    const job = craftQueueState.queue[i];
    const row = rows[i];
    const info = getCraftJobProgress(job);
    const recipe = craftRecipes.find((r) => r.id === job.recipeId);
    const resultIcon = recipe ? getInventoryImage(recipe.result.itemId) : null;

    roundRectPath(ctx, row.icon.x, row.icon.y, row.icon.w, row.icon.h, 7);
    ctx.fillStyle = "rgba(18, 16, 12, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 210, 120, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (resultIcon?.complete && resultIcon.naturalWidth) {
      const pad = 5;
      ctx.drawImage(resultIcon, row.icon.x + pad, row.icon.y + pad, row.icon.w - pad * 2, row.icon.h - pad * 2);
    }

    roundRectPath(ctx, row.bar.x, row.bar.y, row.bar.w, row.bar.h, 7);
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fill();

    const fillW = Math.max(0, (row.bar.w - 4) * info.progress);
    if (fillW > 0) {
      roundRectPath(ctx, row.bar.x + 2, row.bar.y + 2, fillW, row.bar.h - 4, 5);
      const grad = ctx.createLinearGradient(row.bar.x, row.bar.y, row.bar.x + row.bar.w, row.bar.y);
      grad.addColorStop(0, "#ffe566");
      grad.addColorStop(1, "#f0b429");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(255, 220, 120, 0.65)";
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, row.bar.x, row.bar.y, row.bar.w, row.bar.h, 7);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 244, 200, 0.95)";
    ctx.font = "bold 12px Verdana";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(recipe?.label ?? "Craft", row.bar.x + 10, row.bar.y + row.bar.h / 2);

    roundRectPath(ctx, row.cancel.x, row.cancel.y, row.cancel.w, row.cancel.h, 7);
    ctx.fillStyle = "rgba(90, 28, 22, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 170, 145, 0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "#ffc2b0";
    ctx.lineWidth = 2.5;
    const cx = row.cancel.x + row.cancel.w / 2;
    const cy = row.cancel.y + row.cancel.h / 2;
    const arm = 7;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy - arm);
    ctx.lineTo(cx + arm, cy + arm);
    ctx.moveTo(cx + arm, cy - arm);
    ctx.lineTo(cx - arm, cy + arm);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapCraftInfoText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let line = "";
  let cy = y;
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (line && ctx.measureText(next).width > maxW) {
      ctx.fillText(line, x, cy);
      line = words[i];
      cy += lineH;
    } else {
      line = next;
    }
  }
  if (line) {
    ctx.fillText(line, x, cy);
    cy += lineH;
  }
  return cy;
}

function drawCraftPanel() {
  if (!craftOpen) return;
  const img = images.craftBox;
  const panel = getCraftPanelRect();
  if (!img?.complete || !img.naturalWidth || panel.w <= 0) return;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(img, panel.x, panel.y, panel.w, panel.h);

  const normalRecipes = getNormalCraftRecipes();
  const slots = getCraftGridSlots(panel);
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const recipe = normalRecipes[slot.index];
    if (!recipe) continue;

    const icon = getInventoryImage(recipe.result.itemId);
    const pad = slot.w * 0.18;
    if (icon && icon.complete && icon.naturalWidth) {
      ctx.drawImage(icon, slot.x + pad, slot.y + pad, slot.w - pad * 2, slot.h - pad * 2);
    }

    if (slot.index === selectedCraftIndex) {
      ctx.strokeStyle = "#ffe08a";
      ctx.lineWidth = 3;
      ctx.strokeRect(slot.x + 2, slot.y + 2, slot.w - 4, slot.h - 4);
    }

    if (recipe.result.amount > 1) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(12, Math.round(slot.w * 0.2))}px Verdana`;
      ctx.textAlign = "right";
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = 3;
      const label = String(recipe.result.amount);
      ctx.strokeText(label, slot.x + slot.w - 6, slot.y + slot.h - 8);
      ctx.fillText(label, slot.x + slot.w - 6, slot.y + slot.h - 8);
      ctx.textAlign = "left";
    }
  }

  const recipe = getSelectedCraftRecipe();
  if (recipe && craftLayout) {
    const resultLayout = craftLayout.result;
    const iconLayout = resultLayout.icon ?? resultLayout;
    const resultSize = (iconLayout.size ?? resultLayout.size) * panel.scale;
    const resultCenter = craftNativeToScreen(iconLayout.cx, iconLayout.cy, panel);
    const resultIcon = getInventoryImage(recipe.result.itemId);
    if (resultIcon?.complete && resultIcon.naturalWidth) {
      ctx.drawImage(resultIcon, resultCenter.x - resultSize / 2, resultCenter.y - resultSize / 2, resultSize, resultSize);
    }

    const info = resultLayout.info;
    if (info) {
      const infoX = panel.x + info.x * panel.scale;
      const infoY = panel.y + info.y * panel.scale;
      const infoW = info.w * panel.scale;
      const padX = 14 * panel.scale;
      let textY = infoY + 28 * panel.scale;

      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#ffe08a";
      ctx.font = `bold ${Math.max(16, Math.round(20 * panel.scale))}px Verdana`;
      ctx.fillText(recipe.label, infoX + padX, textY);

      textY += 26 * panel.scale;
      ctx.fillStyle = "#f0f0f0";
      ctx.font = `${Math.max(12, Math.round(14 * panel.scale))}px Verdana`;
      const desc = recipe.description || "";
      if (desc) {
        textY = wrapCraftInfoText(ctx, desc, infoX + padX, textY, infoW - padX * 2, 18 * panel.scale);
        textY += 6 * panel.scale;
      }

      const extra = recipe.info || (recipe.result.amount > 1 ? `Amount: ${recipe.result.amount}` : "");
      if (extra) {
        ctx.fillStyle = "#ffe08a";
        ctx.font = `bold ${Math.max(12, Math.round(14 * panel.scale))}px Verdana`;
        ctx.fillText(extra, infoX + padX, textY);
      }
    } else {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px Verdana";
      ctx.textAlign = "center";
      ctx.fillText(recipe.label, resultCenter.x, resultCenter.y + resultSize / 2 + 22);
    }

    const ingLayout = craftLayout.ingredients;
    const ingSize = ingLayout.cellSize * panel.scale;
    const gap = ingLayout.gap * panel.scale;
    let ingX = panel.x + ingLayout.startX * panel.scale;
    const ingY = panel.y + ingLayout.y * panel.scale;

    for (let i = 0; i < recipe.ingredients.length; i++) {
      const ing = recipe.ingredients[i];
      const have = countLocalItem(ing.itemId);
      const enough = have >= ing.amount;
      const icon = getInventoryImage(ing.itemId);

      ctx.fillStyle = enough ? "rgba(40,80,40,0.4)" : "rgba(80,30,30,0.4)";
      ctx.fillRect(ingX + 2, ingY + 2, ingSize - 4, ingSize - 4);

      if (icon?.complete && icon.naturalWidth) {
        const pad = ingSize * 0.14;
        const maxInner = ingSize - pad * 2;
        const scale = Math.min(maxInner / icon.naturalWidth, maxInner / icon.naturalHeight);
        const dw = icon.naturalWidth * scale;
        const dh = icon.naturalHeight * scale;
        ctx.drawImage(icon, ingX + (ingSize - dw) / 2, ingY + (ingSize - dh) / 2, dw, dh);
      }

      ctx.fillStyle = enough ? "#b6ffb6" : "#ffb0b0";
      ctx.font = `bold ${Math.max(12, Math.round(ingSize * 0.22))}px Verdana`;
      ctx.textAlign = "right";
      ctx.fillText(`${have}/${ing.amount}`, ingX + ingSize - 6, ingY + ingSize - 8);

      ingX += ingSize + gap;
    }

    const can = canCraftRecipe(recipe);
    const craftBtn = getCraftActionButtonRect(panel);
    roundRectPath(ctx, craftBtn.x, craftBtn.y, craftBtn.w, craftBtn.h, 10);
    ctx.fillStyle = can ? "rgba(210, 160, 40, 0.95)" : "rgba(70, 70, 70, 0.75)";
    ctx.fill();
    ctx.strokeStyle = can ? "rgba(255, 230, 140, 0.9)" : "rgba(120,120,120,0.5)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = can ? "#1a1408" : "#aaa";
    ctx.font = `bold ${Math.max(18, Math.round(craftBtn.h * 0.42))}px Verdana`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Craft", craftBtn.x + craftBtn.w / 2, craftBtn.y + craftBtn.h / 2);
    ctx.textBaseline = "alphabetic";

    if (craftQueueState.queue.length > 0) {
      ctx.fillStyle = "#cde8ff";
      ctx.font = "12px Verdana";
      ctx.fillText(`Queued: ${craftQueueState.queue.length}/${craftQueueState.max}`, craftBtn.x + craftBtn.w / 2, craftBtn.y + craftBtn.h + 16);
    }
    ctx.textAlign = "left";
  }

  ctx.restore();
}

function drawWorkbenchPanel() {
  if (!workbenchPanelOpen || !activeWorkbench?.workbenchData) return;
  const panel = getCraftPanelRect();
  const img = images.craftBox;
  if (!img?.complete || !img.naturalWidth || panel.w <= 0) return;
  const allowedRecipes = getWorkbenchCraftRecipes();
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,panel.x,panel.y,panel.w,panel.h);
  const slots = getCraftGridSlots(panel);
  for (let i=0;i<slots.length;i++) { const recipe=allowedRecipes[i]; if(!recipe) continue; const icon=getInventoryImage(recipe.result.itemId); const pad=slots[i].w*0.18; if(icon?.complete&&icon.naturalWidth) ctx.drawImage(icon,slots[i].x+pad,slots[i].y+pad,slots[i].w-pad*2,slots[i].h-pad*2); if(i===selectedWorkbenchRecipeIndex){ctx.strokeStyle="#ffe08a";ctx.lineWidth=3;ctx.strokeRect(slots[i].x+2,slots[i].y+2,slots[i].w-4,slots[i].h-4);}}
  const recipe=allowedRecipes[selectedWorkbenchRecipeIndex];
  if(recipe&&craftLayout){ const r=craftLayout.result.icon; const center=craftNativeToScreen(r.cx,r.cy,panel); const size=r.size*panel.scale; const icon=getInventoryImage(recipe.result.itemId); if(icon?.complete&&icon.naturalWidth)ctx.drawImage(icon,center.x-size/2,center.y-size/2,size,size); const info=craftLayout.result.info; ctx.fillStyle="#ffe08a";ctx.font=`bold ${Math.max(16,Math.round(20*panel.scale))}px Verdana`;ctx.textAlign="left";ctx.fillText(recipe.label,panel.x+info.x*panel.scale+14*panel.scale,panel.y+info.y*panel.scale+28*panel.scale); ctx.fillStyle="#f0f0f0";ctx.font=`${Math.max(12,Math.round(14*panel.scale))}px Verdana`;wrapCraftInfoText(ctx,recipe.description||"",panel.x+info.x*panel.scale+14*panel.scale,panel.y+info.y*panel.scale+54*panel.scale,(info.w-28)*panel.scale,18*panel.scale);
    let ix=panel.x+craftLayout.ingredients.startX*panel.scale, iy=panel.y+craftLayout.ingredients.y*panel.scale, isz=craftLayout.ingredients.cellSize*panel.scale, gap=craftLayout.ingredients.gap*panel.scale;
    for(const ing of recipe.ingredients){const have=countLocalItem(ing.itemId), icon2=getInventoryImage(ing.itemId);ctx.fillStyle=have>=ing.amount?"rgba(40,80,40,.4)":"rgba(80,30,30,.4)";ctx.fillRect(ix+2,iy+2,isz-4,isz-4);if(icon2?.complete&&icon2.naturalWidth){const pad=isz*.14, sc=Math.min((isz-pad*2)/icon2.naturalWidth,(isz-pad*2)/icon2.naturalHeight),dw=icon2.naturalWidth*sc,dh=icon2.naturalHeight*sc;ctx.drawImage(icon2,ix+(isz-dw)/2,iy+(isz-dh)/2,dw,dh);}ctx.fillStyle=have>=ing.amount?"#b6ffb6":"#ffb0b0";ctx.font=`bold ${Math.max(12,Math.round(isz*.22))}px Verdana`;ctx.textAlign="right";ctx.fillText(`${have}/${ing.amount}`,ix+isz-6,iy+isz-8);ix+=isz+gap;}
    const can=canCraftCampfireRecipe(recipe), btn=getCraftActionButtonRect(panel);roundRectPath(ctx,btn.x,btn.y,btn.w,btn.h,10);ctx.fillStyle=can?"rgba(210,160,40,.95)":"rgba(70,70,70,.75)";ctx.fill();ctx.strokeStyle=can?"rgba(255,230,140,.9)":"rgba(120,120,120,.5)";ctx.lineWidth=2.5;ctx.stroke();ctx.fillStyle=can?"#1a1408":"#aaa";ctx.font=`bold ${Math.max(18,Math.round(btn.h*.42))}px Verdana`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("Craft",btn.x+btn.w/2,btn.y+btn.h/2);ctx.textBaseline="alphabetic";
    const queue = activeWorkbench.workbenchData?.craftQueue || [];
    const rows = getWorkbenchQueueRowRects(panel);
    ctx.save();
    for (let i = 0; i < rows.length; i++) {
      const job = queue[i];
      const row = rows[i];
      if (!job) continue;
      const duration = Math.max(1, Number(job.durationMs) || 5000);
      let elapsed = Number(job.elapsed) || 0;
      if (job.status === "active" && activeWorkbench.workbenchData?._receivedAt) {
        elapsed += Math.min(duration - elapsed, Math.max(0, performance.now() - activeWorkbench.workbenchData._receivedAt));
      }
      const progress = Math.max(0, Math.min(1, job.status === "ready" ? 1 : elapsed / duration));
      const recipeDef = craftRecipes.find(r => r.id === job.recipeId);
      const resultIcon = recipeDef ? getInventoryImage(recipeDef.result.itemId) : null;

      roundRectPath(ctx, row.icon.x, row.icon.y, row.icon.w, row.icon.h, 7);
      ctx.fillStyle = "rgba(18, 16, 12, 0.85)"; ctx.fill();
      ctx.strokeStyle = "rgba(255, 210, 120, 0.9)"; ctx.lineWidth = 2; ctx.stroke();
      if (resultIcon?.complete && resultIcon.naturalWidth) { const pad = 5; ctx.drawImage(resultIcon, row.icon.x + pad, row.icon.y + pad, row.icon.w - pad * 2, row.icon.h - pad * 2); }

      roundRectPath(ctx, row.bar.x, row.bar.y, row.bar.w, row.bar.h, 7);
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)"; ctx.fill();
      const fillW = Math.max(0, (row.bar.w - 4) * progress);
      if (fillW > 0) {
        roundRectPath(ctx, row.bar.x + 2, row.bar.y + 2, fillW, row.bar.h - 4, 5);
        const grad = ctx.createLinearGradient(row.bar.x, row.bar.y, row.bar.x + row.bar.w, row.bar.y);
        grad.addColorStop(0, "#ffe566"); grad.addColorStop(1, "#f0b429"); ctx.fillStyle = grad; ctx.fill();
      }
      ctx.strokeStyle = "rgba(255, 220, 120, 0.65)"; ctx.lineWidth = 1.5; roundRectPath(ctx, row.bar.x, row.bar.y, row.bar.w, row.bar.h, 7); ctx.stroke();
      ctx.fillStyle = "rgba(255, 244, 200, 0.95)"; ctx.font = "bold 12px Verdana"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(recipeDef?.label ?? "Craft", row.bar.x + 10, row.bar.y + row.bar.h / 2);

      roundRectPath(ctx, row.action.x, row.action.y, row.action.w, row.action.h, 7);
      const ready = job.status === "ready";
      ctx.fillStyle = ready ? "rgba(38, 105, 48, 0.95)" : "rgba(90, 28, 22, 0.95)"; ctx.fill();
      ctx.strokeStyle = ready ? "rgba(170, 255, 175, 0.95)" : "rgba(255, 170, 145, 0.95)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = ready ? "#caffca" : "#ffc2b0"; ctx.lineWidth = 2.5;
      const ax = row.action.x + row.action.w / 2, ay = row.action.y + row.action.h / 2;
      ctx.beginPath();
      if (ready) { ctx.moveTo(ax - 8, ay); ctx.lineTo(ax - 2, ay + 6); ctx.lineTo(ax + 9, ay - 7); }
      else { ctx.moveTo(ax - 7, ay - 7); ctx.lineTo(ax + 7, ay + 7); ctx.moveTo(ax + 7, ay - 7); ctx.lineTo(ax - 7, ay + 7); }
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawCampfirePanel() {
  if (!campfirePanelOpen || !activeCampfire) return;
  const cfData = activeCampfire.campfireData;
  if (!cfData) return;

  const img = images.craftBox;
  const panel = getCraftPanelRect();
  if (!img?.complete || !img.naturalWidth || panel.w <= 0) return;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, panel.x, panel.y, panel.w, panel.h);

  // Рецепты (только семена)
  const cfType = activeCampfire?.campfireData?.type === 'max' ? 'campfire_max' : 'campfire';
    const allowedRecipes = craftRecipes.filter(r => r.station === 'campfire' || (cfType === 'campfire_max' && r.id === 'metal'));
  const slots = getCraftGridSlots(panel);
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const recipe = allowedRecipes[i];
    if (!recipe) continue;
    const icon = getInventoryImage(recipe.result.itemId);
    const pad = slot.w * 0.18;
    if (icon?.complete && icon.naturalWidth) {
      ctx.drawImage(icon, slot.x + pad, slot.y + pad, slot.w - pad * 2, slot.h - pad * 2);
    }
    if (i === selectedCampfireRecipeIndex) {
      ctx.strokeStyle = "#ffe08a";
      ctx.lineWidth = 3;
      ctx.strokeRect(slot.x + 2, slot.y + 2, slot.w - 4, slot.h - 4);
    }
    // Количество
    if (recipe.result.amount > 1) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(12, Math.round(slot.w * 0.2))}px Verdana`;
      ctx.textAlign = "right";
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = 3;
      ctx.strokeText(String(recipe.result.amount), slot.x + slot.w - 6, slot.y + slot.h - 8);
      ctx.fillText(String(recipe.result.amount), slot.x + slot.w - 6, slot.y + slot.h - 8);
      ctx.textAlign = "left";
    }
  }

  // Информация о рецепте (как в обычном крафте)
  const recipe = allowedRecipes[selectedCampfireRecipeIndex];
  if (recipe && craftLayout) {
    const resultLayout = craftLayout.result;
    const iconLayout = resultLayout.icon ?? resultLayout;
    const resultSize = (iconLayout.size ?? resultLayout.size) * panel.scale;
    const resultCenter = craftNativeToScreen(iconLayout.cx, iconLayout.cy, panel);
    const resultIcon = getInventoryImage(recipe.result.itemId);
    if (resultIcon?.complete && resultIcon.naturalWidth) {
      ctx.drawImage(resultIcon, resultCenter.x - resultSize / 2, resultCenter.y - resultSize / 2, resultSize, resultSize);
    }

    const info = resultLayout.info;
    if (info) {
      const infoX = panel.x + info.x * panel.scale;
      const infoY = panel.y + info.y * panel.scale;
      const infoW = info.w * panel.scale;
      const padX = 14 * panel.scale;
      let textY = infoY + 28 * panel.scale;

      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#ffe08a";
      ctx.font = `bold ${Math.max(16, Math.round(20 * panel.scale))}px Verdana`;
      ctx.fillText(recipe.label, infoX + padX, textY);

      textY += 26 * panel.scale;
      ctx.fillStyle = "#f0f0f0";
      ctx.font = `${Math.max(12, Math.round(14 * panel.scale))}px Verdana`;
      const desc = recipe.description || "";
      if (desc) {
        textY = wrapCraftInfoText(ctx, desc, infoX + padX, textY, infoW - padX * 2, 18 * panel.scale);
        textY += 6 * panel.scale;
      }

      const extra = recipe.info || (recipe.result.amount > 1 ? `Amount: ${recipe.result.amount}` : "");
      if (extra) {
        ctx.fillStyle = "#ffe08a";
        ctx.font = `bold ${Math.max(12, Math.round(14 * panel.scale))}px Verdana`;
        ctx.fillText(extra, infoX + padX, textY);
      }
    }

    // Ингредиенты
    const ingLayout = craftLayout.ingredients;
    const ingSize = ingLayout.cellSize * panel.scale;
    const gap = ingLayout.gap * panel.scale;
    let ingX = panel.x + ingLayout.startX * panel.scale;
    const ingY = panel.y + ingLayout.y * panel.scale;

    for (let i = 0; i < recipe.ingredients.length; i++) {
      const ing = recipe.ingredients[i];
      const have = countLocalItem(ing.itemId);
      const enough = have >= ing.amount;
      const icon = getInventoryImage(ing.itemId);

      ctx.fillStyle = enough ? "rgba(40,80,40,0.4)" : "rgba(80,30,30,0.4)";
      ctx.fillRect(ingX + 2, ingY + 2, ingSize - 4, ingSize - 4);

      if (icon?.complete && icon.naturalWidth) {
        const pad = ingSize * 0.14;
        const maxInner = ingSize - pad * 2;
        const scale = Math.min(maxInner / icon.naturalWidth, maxInner / icon.naturalHeight);
        const dw = icon.naturalWidth * scale;
        const dh = icon.naturalHeight * scale;
        ctx.drawImage(icon, ingX + (ingSize - dw) / 2, ingY + (ingSize - dh) / 2, dw, dh);
      }

      ctx.fillStyle = enough ? "#b6ffb6" : "#ffb0b0";
      ctx.font = `bold ${Math.max(12, Math.round(ingSize * 0.22))}px Verdana`;
      ctx.textAlign = "right";
      ctx.fillText(`${have}/${ing.amount}`, ingX + ingSize - 6, ingY + ingSize - 8);

      ingX += ingSize + gap;
    }
  }

  // Кнопки Craft и + (топливо)
  const craftBtn = getCraftActionButtonRect(panel);
  const craftW = craftBtn.w * 0.6;
  const plusW = craftBtn.w * 0.3;
  const gap = 8;
  const totalW = craftW + gap + plusW;
  const startX = craftBtn.x + (craftBtn.w - totalW) / 2;
  const y = craftBtn.y;

  const canCraft = recipe && canCraftCampfireRecipe(recipe) &&
                   cfData.isBurning &&
                   (cfData.craftQueue?.length || 0) < (settings?.settings?.CAMPFIRE_CRAFT_QUEUE_MAX || 4);

  // Кнопка Craft
  roundRectPath(ctx, startX, y, craftW, craftBtn.h, 10);
  ctx.fillStyle = canCraft ? "rgba(210,160,40,0.95)" : "rgba(70,70,70,0.75)";
  ctx.fill();
  ctx.strokeStyle = canCraft ? "rgba(255,230,140,0.9)" : "rgba(120,120,120,0.5)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = canCraft ? "#1a1408" : "#aaa";
  ctx.font = `bold ${Math.max(18, Math.round(craftBtn.h * 0.42))}px Verdana`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Craft", startX + craftW/2, y + craftBtn.h/2);

  // Кнопка + (добавить дрова)
  const plusX = startX + craftW + gap;
  roundRectPath(ctx, plusX, y, plusW, craftBtn.h, 10);
  ctx.fillStyle = "rgba(60,120,60,0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(180,255,180,0.8)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.max(24, Math.round(craftBtn.h * 0.5))}px Verdana`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("+", plusX + plusW/2, y + craftBtn.h/2 + 2);

  // Топливо
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffe08a";
  ctx.font = "14px Verdana";
  ctx.fillText(`Fuel: ${cfData.fuel > 0 ? Math.ceil(cfData.fuel) : 0}/${cfData.fuelMax || 0}`, plusX, y + craftBtn.h + 20);

  // Очередь костра — те же размеры/стиль, что у обычного крафта.
  const queue = cfData.craftQueue || [];
  const rows = getCampfireQueueRowRects(panel);
  ctx.save();
  for (let i = 0; i < rows.length; i++) {
    const job = queue[i];
    const row = rows[i];
    const progress = getCampfireJobProgress(job, cfData);
    const recipeDef = craftRecipes.find(r => r.id === job.recipeId);
    const resultIcon = recipeDef ? getInventoryImage(recipeDef.result.itemId) : null;

    roundRectPath(ctx, row.icon.x, row.icon.y, row.icon.w, row.icon.h, 7);
    ctx.fillStyle = "rgba(18, 16, 12, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 210, 120, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (resultIcon?.complete && resultIcon.naturalWidth) {
      const pad = 5;
      ctx.drawImage(resultIcon, row.icon.x + pad, row.icon.y + pad, row.icon.w - pad * 2, row.icon.h - pad * 2);
    }

    roundRectPath(ctx, row.bar.x, row.bar.y, row.bar.w, row.bar.h, 7);
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fill();
    const fillW = Math.max(0, (row.bar.w - 4) * progress);
    if (fillW > 0) {
      roundRectPath(ctx, row.bar.x + 2, row.bar.y + 2, fillW, row.bar.h - 4, 5);
      const grad = ctx.createLinearGradient(row.bar.x, row.bar.y, row.bar.x + row.bar.w, row.bar.y);
      grad.addColorStop(0, "#ffe566");
      grad.addColorStop(1, "#f0b429");
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255, 220, 120, 0.65)";
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, row.bar.x, row.bar.y, row.bar.w, row.bar.h, 7);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 244, 200, 0.95)";
    ctx.font = "bold 12px Verdana";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(recipeDef?.label ?? "Craft", row.bar.x + 10, row.bar.y + row.bar.h / 2);

    roundRectPath(ctx, row.action.x, row.action.y, row.action.w, row.action.h, 7);
    const ready = job.status === "ready";
    ctx.fillStyle = ready ? "rgba(38, 105, 48, 0.95)" : "rgba(90, 28, 22, 0.95)";
    ctx.fill();
    ctx.strokeStyle = ready ? "rgba(170, 255, 175, 0.95)" : "rgba(255, 170, 145, 0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = ready ? "#caffca" : "#ffc2b0";
    ctx.lineWidth = 2.5;
    const ax = row.action.x + row.action.w / 2;
    const ay = row.action.y + row.action.h / 2;
    ctx.beginPath();
    if (ready) {
      ctx.moveTo(ax - 8, ay); ctx.lineTo(ax - 2, ay + 6); ctx.lineTo(ax + 9, ay - 7);
    } else {
      ctx.moveTo(ax - 7, ay - 7); ctx.lineTo(ax + 7, ay + 7);
      ctx.moveTo(ax + 7, ay - 7); ctx.lineTo(ax - 7, ay + 7);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawLeaderboard() {
  const panelW = 220;
  const rowH = 22;
  const pad = 10;
  const titleH = 26;
  const slots = settings?.settings?.LEADERBOARD_SIZE ?? 10;
  const rows = Math.min(slots, Math.max(leaderboardEntries.length, 1));
  const panelH = titleH + pad + rows * rowH + pad;
  const x = canvas.width - panelW - 16;
  const y = 16;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x, y, panelW, panelH);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px Verdana";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Top 10", x + pad, y + titleH / 2 + 2);

  ctx.font = "13px Verdana";
  for (let i = 0; i < slots; i++) {
    const entry = leaderboardEntries[i];
    if (!entry) continue;

    const rowY = y + titleH + pad + i * rowH + rowH / 2;
    const rank = `${i + 1}.`;
    let name = entry.name || "Player";
    const maxNameW = panelW - pad * 2 - 70;
    while (ctx.measureText(name).width > maxNameW && name.length > 1) {
      name = name.slice(0, -1);
    }
    if (name !== (entry.name || "Player") && name.length > 0) {
      name = `${name.slice(0, Math.max(1, name.length - 1))}…`;
    }

    ctx.textAlign = "left";
    ctx.fillStyle = "#cfcfcf";
    ctx.fillText(rank, x + pad, rowY);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(name, x + pad + 28, rowY);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd76a";
    ctx.fillText(String(entry.score ?? 0), x + panelW - pad, rowY);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}
function drawHpBar() {
  const maxHp = application.myPlayer.maxHp || settings?.settings?.MAX_HP || 300;
  const hp = application.myPlayer.hp ?? maxHp;
  const barWidth = 220;
  const barHeight = 18;
  const slotSize = item_img.invEmpty?.naturalWidth || 64;
  // Keep the stat stack lower, close to the inventory/chat baseline.
  const bottomY = canvas.height - slotSize + 6;
  const energyY = bottomY - barHeight;
  const tempY = energyY - barHeight - 10;
  const hpY = tempY - barHeight - 10;
  const satY = hpY - barHeight - 10;
  const xpY = satY - barHeight - 10;
  const x = canvas.width - barWidth - 24;

  ctx.save();

  // XP
  const xpRatio = Math.max(0, Math.min(1, myXp / Math.max(1, myXpNeed)));
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 4, xpY - 4, barWidth + 8, barHeight + 8);
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(x, xpY, barWidth, barHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, xpY, barWidth * xpRatio, barHeight);
  ctx.strokeStyle = "#111";
  ctx.strokeRect(x, xpY, barWidth, barHeight);
  ctx.font = "14px Verdana";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.fillStyle = "#fff";
  const xpLabel = `Lv ${myLevel}  ${Math.floor(myXp)} / ${Math.ceil(myXpNeed)}`;
  ctx.strokeText(xpLabel, x + 8, xpY + 14);
  ctx.fillText(xpLabel, x + 8, xpY + 14);
  ctx.lineWidth = 1;

  // Сытость
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 4, satY - 4, barWidth + 8, barHeight + 8);
  ctx.fillStyle = "#4a3a22";
  ctx.fillRect(x, satY, barWidth, barHeight);
  ctx.fillStyle = "#e0a23a";
  const satRatio = Math.max(0, Math.min(1, satiety / Math.max(1, maxSatiety)));
  ctx.fillRect(x, satY, barWidth * satRatio, barHeight);
  ctx.strokeStyle = "#2a2114";
  ctx.strokeRect(x, satY, barWidth, barHeight);
  ctx.fillStyle = "white";
  ctx.font = "14px Verdana";
  ctx.fillText(`${Math.round(satiety)} / ${maxSatiety}`, x + 8, satY + 14);

  // HP
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 4, hpY - 4, barWidth + 8, barHeight + 8);
  ctx.fillStyle = "#2d4d32";
  ctx.fillRect(x, hpY, barWidth, barHeight);
  ctx.fillStyle = "#3ecf4a";
  ctx.fillRect(x, hpY, barWidth * (hp / maxHp), barHeight);
  ctx.strokeStyle = "#1d2f20";
  ctx.strokeRect(x, hpY, barWidth, barHeight);
  ctx.fillStyle = "white";
  ctx.fillText(`${Math.round(hp)} / ${maxHp}`, x + 8, hpY + 14);

  // Энергия
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 4, energyY - 4, barWidth + 8, barHeight + 8);
  ctx.fillStyle = "#222";
  ctx.fillRect(x, energyY, barWidth, barHeight);
  ctx.fillStyle = "#e7d34d";
  const energyRatio = Math.max(0, Math.min(1, energy / Math.max(1, maxEnergy)));
  ctx.fillRect(x, energyY, barWidth * energyRatio, barHeight);
  ctx.strokeStyle = "#161616";
  ctx.strokeRect(x, energyY, barWidth, barHeight);
  ctx.fillStyle = "white";
  ctx.font = "14px Verdana";
  ctx.fillText(`Energy ${Math.round(energy)} / ${maxEnergy}`, x + 8, energyY + 14);

  // Температура
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 4, tempY - 4, barWidth + 8, barHeight + 8);
  ctx.fillStyle = "#1a2a3a";
  ctx.fillRect(x, tempY, barWidth, barHeight);
  ctx.fillStyle = "#4a9aff";
  const tempRatio = Math.max(0, Math.min(1, temperature / Math.max(1, maxTemperature)));
  ctx.fillRect(x, tempY, barWidth * tempRatio, barHeight);
  ctx.strokeStyle = "#0a1a2a";
  ctx.strokeRect(x, tempY, barWidth, barHeight);
  ctx.fillStyle = "white";
  ctx.font = "14px Verdana";
  ctx.fillText(`Temp ${Math.round(temperature)}°`, x + 8, tempY + 14);

  ctx.restore();
}

function drawInventorySlotContents(slot, x, y, slotSize, faded) {
  if (!slot) return;
  const icon = getInventoryImage(slot.itemId);
  ctx.save();
  if (faded) ctx.globalAlpha = 0.35;

  if (icon && icon.complete && icon.naturalWidth) {
    const pad = 8;
    const iw = icon.naturalWidth;
    const ih = icon.naturalHeight;
    const maxInner = slotSize - pad * 2;
    const scale = Math.min(1, maxInner / Math.max(iw, ih));
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(icon, x + (slotSize - dw) / 2, y + (slotSize - dh) / 2 - 2, dw, dh);
  }

  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px Verdana";
  ctx.textAlign = "right";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 3;
  const label = String(slot.amount);
  ctx.strokeText(label, x + slotSize - 6, y + slotSize - 8);
  ctx.fillText(label, x + slotSize - 6, y + slotSize - 8);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawInventory() {
  const layout = getInventoryLayout();
  const emptyImg = item_img.invEmpty;
  const dragFrom = invDrag && invDrag.dragging ? invDrag.fromIndex : -1;

  ctx.save();
  for (let i = 0; i < layout.slots.length; i++) {
    const s = layout.slots[i];
    const x = s.x;
    const y = s.y;
    const slotSize = s.size;

    if (emptyImg && emptyImg.complete && emptyImg.naturalWidth) {
      ctx.drawImage(emptyImg, x, y, slotSize, slotSize);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, y, slotSize, slotSize);
      ctx.strokeStyle = "#555";
      ctx.strokeRect(x, y, slotSize, slotSize);
    }

    if (heldItemId && i === heldSlotIndex) {
      ctx.strokeStyle = "#ffe08a";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, slotSize - 4, slotSize - 4);
    } else if (actionTimer?.kind === "equip" && actionTimer.slotIndex === i) {
      ctx.strokeStyle = "#9ad0ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, slotSize - 4, slotSize - 4);
    }

    drawInventorySlotContents(inventory[i], x, y, slotSize, i === dragFrom);
  }

  if (invDrag && invDrag.dragging) {
    const ghost = {
      itemId: invDrag.itemId,
      amount: invDrag.amount,
    };
    const size = layout.slotSize;
    drawInventorySlotContents(ghost, invDrag.x - size / 2, invDrag.y - size / 2, size, false);
  }
  ctx.restore();
}

function getNatureDrawLayer(natureType) {
  if (!natureType || natureType === "empty") return 0;
  if (natureDrawLayerById.has(natureType)) {
    return natureDrawLayerById.get(natureType);
  }
  if (natureType === "tree") return 10;
  if (natureType === "stone" || natureType === "ironOre" || natureType === "sulfur" || natureType === "gold") return 20;
  if (natureType === "blueberry" || natureType === "wildberry") return 40;
  return 20;
}

let ghostTintCanvas = null;
let ghostTintCtx = null;
function drawTintedGhostImage(img, drawX, drawY, drawW, drawH, fillCss) {
  if (!img || !img.complete || !img.naturalWidth) return;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!ghostTintCanvas) {
    ghostTintCanvas = document.createElement("canvas");
    ghostTintCtx = ghostTintCanvas.getContext("2d");
  }
  if (ghostTintCanvas.width !== w || ghostTintCanvas.height !== h) {
    ghostTintCanvas.width = w;
    ghostTintCanvas.height = h;
  }
  ghostTintCtx.clearRect(0, 0, w, h);
  ghostTintCtx.globalCompositeOperation = "source-over";
  ghostTintCtx.drawImage(img, 0, 0);
  ghostTintCtx.globalCompositeOperation = "source-in";
  ghostTintCtx.fillStyle = fillCss;
  ghostTintCtx.fillRect(0, 0, w, h);
  ghostTintCtx.globalCompositeOperation = "source-over";
  ctx.drawImage(ghostTintCanvas, drawX, drawY, drawW, drawH);
}

function drawSaplings(visibleCells, cameraX, cameraY) {
  const now = performance.now();
  for (let i = 0; i < visibleCells.length; i++) {
    const cell = visibleCells[i];
    const sap = cell?.sapling;
    if (!sap?.kind || sap.hp <= 0) continue;

    const imgKey = sap.natureImage || (sap.kind === "wildberry" ? `wildberryPlant${sap.stage ?? 0}` : `blueberryPlant${sap.stage ?? 0}`);
    const img = map_img[imgKey];
    if (!img || !img.complete || !img.naturalWidth) continue;

    const offset = getNatureHitOffset(cell.indexX, cell.indexY);
    let phase = cell.indexX * 0.7 + cell.indexY * 1.1;
    const pulse = 1 + Math.sin(now / 520 + phase) * 0.045;
    const imgW = img.naturalWidth * pulse;
    const imgH = img.naturalHeight * pulse;
    const drawX = cell.x - cameraX + cell.w / 2 + offset.x;
    const drawY = cell.y - cameraY + cell.h / 2 + offset.y;
    ctx.save(); ctx.translate(drawX, drawY); ctx.rotate(((sap.rotation ?? 0) % 4) * Math.PI / 2); ctx.drawImage(img, -imgW/2, -imgH/2, imgW, imgH); ctx.restore();

    if (showDebugHitboxes) {
      ctx.strokeStyle = "rgba(80,200,120,0.9)";
      ctx.lineWidth = 2 / scale;
      drawCircle(cell.x - cameraX + cell.w / 2 + offset.x, cell.y - cameraY + cell.h / 2 + offset.y, sap.hitboxRadius ?? settings?.settings?.SAPLING_HITBOX_RADIUS ?? 48);
    }
  }
}

function drawCampfireGlow(cell, cameraX, cameraY, now) {
  const cf = cell.campfire;
  if (!cf || !cf.isBurning) return;
  const cx = cell.x + cell.w/2 - cameraX;
  const cy = cell.y + cell.h/2 - cameraY;
  const radius = 220 + Math.sin(now / 420) * 25; // большой пульсирующий ореол
  const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
  grad.addColorStop(0, 'rgba(255, 240, 100, 0.9)');
  grad.addColorStop(0.3, 'rgba(255, 200, 50, 0.6)');
  grad.addColorStop(0.7, 'rgba(255, 150, 20, 0.3)');
  grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function drawCampfires(visibleCells, cameraX, cameraY, now) {
  const CAMPFIRE_DRAW_SIZE = 250;
  for (const cell of visibleCells) {
    const cf = cell.campfire;
    if (!cf) continue;
    // Исправлено: используем правильные ключи
    const imgKey = cf.type === 'max' ? 'campfire_maxInv' : 'campfireInv';
    const img = item_img[imgKey];
    if (!img || !img.complete) continue;
    const baseCx = cell.x + cell.w/2;
    const baseCy = cell.y + cell.h/2;
    const offset = getNatureHitOffset(cell.indexX, cell.indexY);
    const cx = baseCx - cameraX + offset.x;
    const cy = baseCy - cameraY + offset.y;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(((cell.campfire?.rotation ?? 0) % 4) * Math.PI / 2); ctx.drawImage(img, -CAMPFIRE_DRAW_SIZE/2, -CAMPFIRE_DRAW_SIZE/2, CAMPFIRE_DRAW_SIZE, CAMPFIRE_DRAW_SIZE); ctx.restore();
    if (cf.isBurning) {
      drawCampfireGlow(cell, cameraX, cameraY, now);
    }
    if (showDebugHitboxes) {
      ctx.strokeStyle = 'rgba(255,100,0,0.5)';
      ctx.lineWidth = 2/scale;
      const hitRadius = settings?.settings?.CAMPFIRE_HITBOX_RADIUS || 90;
      const heatRadius = settings?.settings?.CAMPFIRE_NORMAL?.heatRadius || 300;
      ctx.strokeStyle = 'rgba(255,100,0,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, hitRadius, 0, Math.PI*2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,40,0.75)';
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(cx, cy, heatRadius, 0, Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Keep a destroyed campfire visible for the short hit/recoil animation.
  for (const [key, visual] of campfireHitVisuals) {
    const elapsed = now - visual.startedAt;
    const duration = settings?.settings?.NATURE_HIT_ANIM_MS ?? 200;
    if (elapsed >= duration) { campfireHitVisuals.delete(key); continue; }
    const imgKey = visual.type === 'max' ? 'campfire_maxInv' : 'campfireInv';
    const img = item_img[imgKey];
    if (!img?.complete || !img.naturalWidth) continue;
    const offset = getNatureHitOffset(...key.split(':').map(Number));
    const alpha = 1 - elapsed / duration;
    ctx.save();
    ctx.globalAlpha = alpha;
    const cx = visual.x - cameraX + offset.x;
    const cy = visual.y - cameraY + offset.y;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((visual.rotation ?? 0) % 4) * Math.PI / 2);
    ctx.drawImage(img, -CAMPFIRE_DRAW_SIZE/2, -CAMPFIRE_DRAW_SIZE/2, CAMPFIRE_DRAW_SIZE, CAMPFIRE_DRAW_SIZE);
    ctx.restore();
    ctx.restore();
  }
}

function drawBuildModeOverlay(cameraX, cameraY) {
  if (!isInBuildMode(null, true)) return;

  const cellSize = settings?.settings?.CELL_SIDE_LENGTH_PIXEL ?? 200;
  const playerCell = getWorldCellIndex(application.myPlayer.renderX, application.myPlayer.renderY);
  const px = playerCell.indexX;
  const py = playerCell.indexY;
  const playerWorldX = application.myPlayer.renderX;
  const playerWorldY = application.myPlayer.renderY;

  const pad = cellSize * 0.06;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ix = px + dx;
      const iy = py + dy;
      const cx = (ix - 1) * cellSize + cellSize / 2;
      const cy = (iy - 1) * cellSize + cellSize / 2;
      const dist = Math.hypot(cx - playerWorldX, cy - playerWorldY);
      const isCenter = dx === 0 && dy === 0;
      const alpha = isCenter ? 0.42 : Math.max(0.18, 0.48 - dist / (cellSize * 4.5));

      const x = (ix - 1) * cellSize - cameraX - pad;
      const y = (iy - 1) * cellSize - cameraY - pad;
      const s = cellSize + pad * 2;

      ctx.fillStyle = `rgba(30, 150, 255, ${alpha * 0.55})`;
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = `rgba(40, 170, 255, ${Math.min(0.95, alpha + 0.35)})`;
      ctx.lineWidth = (isCenter ? 5 : 4) / scale;
      ctx.strokeRect(x, y, s, s);
    }
  }
}

function drawBuildGhost(cameraX, cameraY) {
  if (!isInBuildMode(null, true)) return;

  const cellSize = settings?.settings?.CELL_SIDE_LENGTH_PIXEL ?? 200;
  const playerCell = getWorldCellIndex(application.myPlayer.renderX, application.myPlayer.renderY);
  const px = playerCell.indexX;
  const py = playerCell.indexY;
  const me = application.playersList.list.find((p) => p.id === socket.id);
  const visible = me?.visibleCells ?? [];

  const world = screenToWorld(pointerClientX, pointerClientY);
  const { indexX, indexY } = getWorldCellIndex(world.x, world.y);
  const adx = Math.abs(indexX - px);
  const ady = Math.abs(indexY - py);
  if (adx > 1 || ady > 1 || (adx === 0 && ady === 0)) return;

  const cell = visible.find((c) => c.indexX === indexX && c.indexY === indexY);
  const ok = canClientBuildOnCell(cell);
  
  let ghostImg = null;
  let drawSize = 0;
  
  if (isBuildSeed(heldItemId)) {
    const ghostKey = getGhostPlantImageKey(heldItemId);
    ghostImg = map_img[ghostKey];
    drawSize = ghostImg?.naturalWidth || 200;
  } else if (heldItemId === 'campfire' || heldItemId === 'campfire_max') {
    const imgKey = heldItemId === 'campfire' ? 'campfireInv' : 'campfire_maxInv';
    ghostImg = item_img[imgKey]; drawSize = 250;
  } else if (heldItemId === 'workbench') {
    ghostImg = item_img.workbenchInv; drawSize = Math.min(cellSize * 0.95, 190);
  } else if (isBuildingItemClient(heldItemId)) {
    ghostImg = item_img[`${heldItemId}Inv`]; drawSize = cellSize;
  }

  if (!ghostImg?.complete || !ghostImg.naturalWidth) return;

  const gx = (indexX - 1) * cellSize + cellSize / 2 - cameraX;
  const gy = (indexY - 1) * cellSize + cellSize / 2 - cameraY;
  const drawX = gx - drawSize / 2;
  const drawY = gy - drawSize / 2;

  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(buildRotation * Math.PI / 2);
  ctx.globalAlpha = 0.25;
  ctx.drawImage(ghostImg, -drawSize/2, -drawSize/2, drawSize, drawSize);
  ctx.restore();

  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(buildRotation * Math.PI / 2);
  ctx.globalAlpha = 0.85;
  drawTintedGhostImage(ghostImg, -drawSize/2, -drawSize/2, drawSize, drawSize, ok ? "rgb(30, 160, 255)" : "rgb(255, 35, 35)");
  ctx.restore();

  // Blue orientation arrow: 0=down, 90=left, 180=up, 270=right.
  const dir = [[0,1],[-1,0],[0,-1],[1,0]][buildRotation % 4];
  const arrowLen = 72;
  const ax = gx + dir[0] * arrowLen, ay = gy + dir[1] * arrowLen;
  ctx.save();
  ctx.translate(gx, gy);
  ctx.strokeStyle = "rgba(60,180,255,0.95)";
  ctx.fillStyle = "rgba(60,180,255,0.95)";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(dir[0]*arrowLen, dir[1]*arrowLen); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(dir[0]*arrowLen, dir[1]*arrowLen);
  ctx.lineTo(dir[0]*arrowLen - dir[1]*18 - dir[0]*12, dir[1]*arrowLen + dir[0]*18 - dir[1]*12);
  ctx.lineTo(dir[0]*arrowLen + dir[1]*18 - dir[0]*12, dir[1]*arrowLen - dir[0]*18 - dir[1]*12);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function getBuildingDrawImage(b) {
  if (!b?.buildingId) return null;
  const stage = b.hp <= b.maxHp / 3 ? 2 : b.hp <= b.maxHp * 2 / 3 ? 1 : 0;
  const key = stage===2 ? `${b.buildingId}Broke2` : stage===1 ? `${b.buildingId}Broke1` : `${b.buildingId}Build`;
  return item_img[key];
}

function getDoorRenderState(b) {
  if (b?.kind !== "door") return { progress:0 };
  const state = String(b.state || "").toUpperCase();
  if (state === "OPEN") return { progress:1 };
  if (state === "CLOSED") return { progress:0 };

  const receivedProgress = Number(b.doorProgress);
  const base = Number.isFinite(receivedProgress) ? Math.max(0, Math.min(1, receivedProgress)) : 0;
  const started = b._animReceivedAt ?? (
    performance.now() - (state === "OPENING" ? base : (1 - base)) * 600
  );
  const elapsed = Math.max(0, performance.now() - started) / 600;
  return {
    progress: state === "OPENING"
      ? Math.min(1, Math.max(0, elapsed))
      : Math.min(1, Math.max(0, 1 - elapsed)),
  };
}

function getDoorTransform(cell, b, progress, cameraX, cameraY) {
  const r = ((b.rotation ?? 0) % 4 + 4) % 4;
  const sign = Number(b.openDirection) < 0 ? -1 : 1;
  const pivot = [-100, 100];
  const baseAngle = r * Math.PI / 2;
  const clamped = Math.max(0, Math.min(1, progress));
  const angle = baseAngle + sign * Math.PI * clamped;
  const rotate = (x, y, a) => ({
    x: x * Math.cos(a) - y * Math.sin(a),
    y: x * Math.sin(a) + y * Math.cos(a),
  });

  const cx = cell.x + cell.w / 2 - cameraX;
  const cy = cell.y + cell.h / 2 - cameraY;
  const hinge = rotate(pivot[0], pivot[1], baseAngle);
  return {
    hingeX: cx + hinge.x,
    hingeY: cy + hinge.y,
    angle,
    pivot,
  };
}

function drawBuildings(visibleCells,cameraX,cameraY,now){
  for(const cell of visibleCells??[]){
    const b=cell?.building; if(!b)continue;
    const img=getBuildingDrawImage(b); if(!img?.complete||!img.naturalWidth)continue;
    const hitOffset = getNatureHitOffset(cell.indexX, cell.indexY);
    if(b.kind==='door'){
      const state=getDoorRenderState(b), tr=getDoorTransform(cell,b,state.progress,cameraX,cameraY);
      ctx.save();
      ctx.translate(tr.hingeX + hitOffset.x, tr.hingeY + hitOffset.y);
      ctx.rotate(tr.angle);
      ctx.translate(-tr.pivot[0], -tr.pivot[1]);
      ctx.drawImage(img, -100, -100, 200, 200);
      ctx.restore();
    } else {
      const cx=cell.x+cell.w/2-cameraX+hitOffset.x,cy=cell.y+cell.h/2-cameraY+hitOffset.y;
      ctx.save();ctx.translate(cx,cy);ctx.rotate(((b.rotation??0)%4)*Math.PI/2);ctx.drawImage(img,-100,-100,200,200);ctx.restore();
    }
    if(showDebugHitboxes){
      if(b.kind === 'door'){
        const state=getDoorRenderState(b);
        const tr=getDoorTransform(cell,b,state.progress,cameraX,cameraY);
        ctx.save();
        ctx.translate(tr.hingeX + hitOffset.x, tr.hingeY + hitOffset.y);
        ctx.rotate(tr.angle);
        ctx.translate(-tr.pivot[0], -tr.pivot[1]);
        ctx.strokeStyle='black';
        ctx.lineWidth=2/scale;
        ctx.strokeRect(-100,-100,200,200);
        ctx.restore();
      } else {
        const cx=cell.x+cell.w/2-cameraX,cy=cell.y+cell.h/2-cameraY;
        ctx.save();ctx.translate(cx,cy);ctx.strokeStyle='black';ctx.lineWidth=2/scale;ctx.strokeRect(-100,-100,200,200);ctx.restore();
      }
    }
  }
}

function findNearestDoorInteractable(){
  const me=application.playersList.list.find(p=>p.id===socket.id); if(!me)return null;
  const visible=me.visibleCells??[];
  const px=Number.isFinite(me.renderX)?me.renderX:me.x;
  const py=Number.isFinite(me.renderY)?me.renderY:me.y;
  if(!Number.isFinite(px)||!Number.isFinite(py))return null;
  let best=null,bestDist=Math.max(300, settings?.settings?.INTERACTION_RADIUS??200)+8;
  for(const cell of visible){
    const b=cell?.building;
    if(b?.kind!=="door")continue;
    const state=String(b.state??"").toUpperCase();
    if(state==="OPENING"||state==="CLOSING")continue;
    const progress=state==="OPEN"?1:0;
    const r=((b.rotation??0)%4+4)%4;
    const sign=Number(b.openDirection)<0?-1:1;
    const deltas=[{"-1":[-1,0],"1":[1,0]},{"-1":[0,-1],"1":[0,1]},{"-1":[1,0],"1":[-1,0]},{"-1":[0,1],"1":[0,-1]}][r][String(sign)];
    const x=cell.x+cell.w/2+deltas[0]*200*progress;
    const y=cell.y+cell.h/2+deltas[1]*200*progress;
    const dist=Math.hypot(x-px,y-py);
    if(dist<=bestDist){bestDist=dist;best={cell,dist};}
  }
  return best;
}

function drawWorkbenches(visibleCells, cameraX, cameraY, now) {
  for (const cell of visibleCells ?? []) {
    const wb = cell?.workbench;
    if (!wb) continue;
    const img = item_img.workbenchInv;
    if (!img?.complete || !img.naturalWidth) continue;
    const size = Math.min(cell.w * 0.95, 190);
    const hitOffset = getNatureHitOffset(cell.indexX, cell.indexY);
    const cx = cell.x + cell.w/2 - cameraX + hitOffset.x, cy = cell.y + cell.h/2 - cameraY + hitOffset.y;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((wb.rotation ?? 0) % 4) * Math.PI / 2);
    ctx.drawImage(img, -size/2, -size/2, size, size);
    ctx.restore();
    if (showDebugHitboxes) {
      const hw = (wb.hitboxWidth ?? settings.settings.WORKBENCH?.hitboxWidth ?? 164) / 2;
      const hh = (wb.hitboxHeight ?? settings.settings.WORKBENCH?.hitboxHeight ?? 116) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((((wb.rotation ?? 0) + 1) % 4) * Math.PI / 2);
      ctx.strokeStyle = "black";
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctx.restore();
    }
  }
}

function drawWorkbenchInteractionHint(cameraX, cameraY, offsetX = 0) {
  const cell = findNearestWorkbench();
  if (!cell) return;
  const img = images.eWorkbench;
  if (!img?.complete || !img.naturalWidth) return;
  // The E hint belongs to the player, not to the workbench. Match the
  // campfire hint positioning and natural image dimensions.
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const drawX = offsetX - w / 2;
  const drawY = -150 - h / 2;
  ctx.drawImage(img, drawX, drawY, w, h);
}

function drawDoorInteractionHint(door, offsetX = 0) {
  if (!door) return;
  const img = door.cell?.building?.state === "open" ? images.eClosedDoor : images.eOpenDoor;
  if (!img?.complete || !img.naturalWidth) return;
  const w = img.naturalWidth, h = img.naturalHeight;
  ctx.drawImage(img, offsetX - w / 2, -150 - h / 2, w, h);
}

function drawNatureObjects(visibleCells, cameraX, cameraY, range = {}) {
  const minLayer = range.minLayerInclusive ?? -Infinity;
  const maxLayer = range.maxLayerExclusive ?? Infinity;

  const list = [];
  for (const cell of visibleCells) {
    if (!cell || cell.natureType === "empty") continue;
    const layer = getNatureDrawLayer(cell.natureType);
    if (layer < minLayer || layer >= maxLayer) continue;
    list.push({ cell, layer });
  }

  list.sort((a, b) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    const ay = a.cell.y + a.cell.h / 2;
    const by = b.cell.y + b.cell.h / 2;
    return ay - by;
  });

  for (let i = 0; i < list.length; i++) {
    const cell = list[i].cell;
    const img = map_img[cell.natureImage];
    if (!img || !img.complete || !img.naturalWidth) continue;

    const natureOffset = getNatureHitOffset(cell.indexX, cell.indexY);
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const drawX = cell.x - cameraX + cell.w / 2 - imgW / 2 + natureOffset.x;
    const drawY = cell.y - cameraY + cell.h / 2 - imgH / 2 + natureOffset.y;

    ctx.drawImage(img, drawX, drawY, imgW, imgH);

    if (showDebugHitboxes) {
      ctx.strokeStyle = "black";
      ctx.lineWidth = 2 / scale;
      drawCircle(cell.x - cameraX + cell.w / 2 + natureOffset.x, cell.y - cameraY + cell.h / 2 + natureOffset.y, cell.hitboxRadius ?? settings.settings.DEFAULT_OBJECT_RADIUS);
    }
  }
}

function drawGroundItems(visibleCells, cameraX, cameraY) {
  const size = settings?.settings?.GROUND_DRAW_SIZE ?? 100;
  const shrinkMs = settings?.settings?.GROUND_ITEM_SHRINK_MS ?? 450;
  const now = performance.now();

  for (const cell of visibleCells) {
    const items = getCellGroundItems(cell);
    for (let i = 0; i < items.length; i++) {
      const ground = items[i];
      if (!ground?.itemId) continue;

      const hideKey = ground.id || getCellKey(cell.indexX, cell.indexY);
      const hideUntil = hiddenGroundUntil.get(hideKey);
      if (hideUntil && now < hideUntil) continue;

      if (ground.itemId === "spear" && spearGroundHideUntil.some((h) => h.until > now && Math.hypot((ground.x ?? cell.x + cell.w / 2) - h.x, (ground.y ?? cell.y + cell.h / 2) - h.y) < 25)) continue;
      const img = getGroundImage(ground.itemId);
      if (!img || !img.complete || !img.naturalWidth) continue;

      const gx = ground.x ?? cell.x + cell.w / 2;
      const gy = ground.y ?? cell.y + cell.h / 2;

      let phase = i * 0.7;
      const id = String(ground.id || "");
      for (let c = 0; c < id.length; c++) phase += id.charCodeAt(c) * 0.01;

      const expiresUntil = ground.expiresUntil;
      const remaining = expiresUntil != null ? expiresUntil - now : Infinity;

      let scaleMul = 1;
      let pulsePeriod = 480;
      if (remaining <= 0) {
        const shrinkT = Math.min(1, -remaining / shrinkMs);
        scaleMul = Math.max(0, 1 - shrinkT);
        if (scaleMul <= 0.01) continue;
        pulsePeriod = 120;
      } else if (remaining <= 2000) {
        pulsePeriod = 160;
      }

      const pulse = 1 + Math.sin(now / pulsePeriod + phase) * 0.1;
      const drawSize = size * getGroundDrawScale(ground.itemId) * pulse * scaleMul;
      const drawX = gx - cameraX - drawSize / 2;
      const drawY = gy - cameraY - drawSize / 2;
      ctx.drawImage(img, drawX, drawY, drawSize, drawSize);

      if (ground.amount > 1 && scaleMul > 0.4) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px Verdana";
        ctx.textAlign = "right";
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 3;
        const label = String(ground.amount);
        ctx.strokeText(label, drawX + drawSize - 4, drawY + drawSize - 4);
        ctx.fillText(label, drawX + drawSize - 4, drawY + drawSize - 4);
        ctx.textAlign = "left";
      }
    }
  }
}

function drawSpearLandAnims(cameraX, cameraY, now) {
  // Landing is a short "fall to ground" animation. It must NOT rotate the
  // spear around its own axis: the ground sprite already represents the
  // final orientation. Use a small vertical drop + scale/alpha easing,
  // similar to the game's other destruction/drop animations.
  const img = images.spearGround;
  if (!img?.complete || !img.naturalWidth) return;

  for (let i = spearLandAnims.length - 1; i >= 0; i--) {
    const a = spearLandAnims[i];
    const t = Math.min(1, Math.max(0, (now - a.startedAt) / a.duration));
    if (t >= 1) {
      spearLandAnims.splice(i, 1);
      continue;
    }

    // Ease-out: the spear drops quickly and settles without spinning.
    const ease = 1 - Math.pow(1 - t, 3);
    const size = 128 * (0.82 + ease * 0.18);
    const lift = (1 - ease) * 18;
    const alpha = 0.55 + ease * 0.45;
    const drawX = a.x - cameraX - size / 2;
    const drawY = a.y - cameraY - size / 2 - lift;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, drawX, drawY, size, size);
    ctx.restore();
  }

  for (let i = spearGroundHideUntil.length - 1; i >= 0; i--) {
    if (spearGroundHideUntil[i].until <= now) spearGroundHideUntil.splice(i, 1);
  }
}

function drawResourceFlyAnims(cameraX, cameraY, now) {
  const baseSize = settings?.settings?.GROUND_DRAW_SIZE ?? 100;

  for (let i = resourceFlyAnims.length - 1; i >= 0; i--) {
    const anim = resourceFlyAnims[i];
    const t = (now - anim.startedAt) / anim.duration;
    if (t < 0) continue;
    if (t >= 1) {
      if (anim.mode === "drop") {
        const hideKey = anim.lootId || getCellKey(anim.indexX, anim.indexY);
        hiddenGroundUntil.delete(hideKey);
      }
      resourceFlyAnims.splice(i, 1);
      continue;
    }

    let toX = anim.toX;
    let toY = anim.toY;
    if (anim.mode === "collect") {
      const followId = anim.followPlayerId ?? socket.id;
      if (followId === socket.id) {
        toX = application.myPlayer.renderX;
        toY = application.myPlayer.renderY;
      } else {
        const picker = application.playersList.list.find((p) => p.id === followId);
        if (picker) {
          toX = picker.renderX ?? picker.x;
          toY = picker.renderY ?? picker.y;
        }
      }
    }

    const ease = anim.mode === "drop" ? t * t : 1 - Math.pow(1 - t, 2);
    const x = anim.fromX + (toX - anim.fromX) * ease;
    const y = anim.fromY + (toY - anim.fromY) * ease;
    const img = getGroundImage(anim.itemId);
    if (!img || !img.complete || !img.naturalWidth) continue;

    const s = anim.mode === "drop" ? 1 : 1 - t * 0.35;
    const scaled = baseSize * getGroundDrawScale(anim.itemId) * s;
    const imgW = scaled;
    const imgH = scaled;
    ctx.globalAlpha = anim.mode === "drop" ? 0.95 : 1 - t * 0.15;
    ctx.drawImage(img, x - cameraX - imgW / 2, y - cameraY - imgH / 2, imgW, imgH);
    ctx.globalAlpha = 1;
  }
}

let lastUpdateTime = performance.now();

function draw() {
  requestAnimationFrame(draw);
  ctx.reset();

  const currentTime = performance.now();
  const deltaTime = currentTime - lastUpdateTime;

  if (application.canvasShow && application.playersList.list.length > 0) {
    const smoothFactor = Math.min(1, deltaTime / 33) * 0.45;

    for (const p of application.playersList.list) {
      ensureRenderPosition(p);
      p.renderX = smoothToward(p.renderX, p.targetX, smoothFactor);
      p.renderY = smoothToward(p.renderY, p.targetY, smoothFactor);
    }

    application.myPlayer.renderX = smoothToward(application.myPlayer.renderX, application.myPlayer.targetX, smoothFactor);
    application.myPlayer.renderY = smoothToward(application.myPlayer.renderY, application.myPlayer.targetY, smoothFactor);

    const cameraX = application.myPlayer.renderX;
    const cameraY = application.myPlayer.renderY;

    checkCampfireDistance();
    checkWorkbenchDistance();

    calculateCellsVisionZone(cameraX, cameraY);
    updateAlerts();
    updateActionTimer(currentTime);
    updateLocalSpear(currentTime);
    cleanupEffectOverlays();

    if (application.myPlayer.mouseIsDown && !isInBuildMode(null, true)) {
      requestAttack();
    }

    const myAttackAnim = updateAttackAnimation(application.myPlayer);

    const targetNightAlpha = isNight ? settings?.settings?.NIGHT_OVERLAY_ALPHA ?? 0.55 : 0;
    nightOverlayAlpha += (targetNightAlpha - nightOverlayAlpha) * Math.min(1, deltaTime / 400);

    ctx.save();
    ctx.translate(metricCentre.x, metricCentre.y);
    ctx.scale(scale, scale);

    const mapW = settings.settings.MAP_SIDE_LENGTH * settings.settings.CELL_SIDE_LENGTH_PIXEL;
    const mapH = settings.settings.MAP_SIDE_LENGTH * settings.settings.CELL_SIDE_LENGTH_PIXEL;

    const viewW = canvas.width / scale + 4;
    const viewH = canvas.height / scale + 4;
    ctx.fillStyle = nightOverlayAlpha > 0.25 ? "#121810" : "#2a3830";
    ctx.fillRect(-viewW / 2, -viewH / 2, viewW, viewH);

    ctx.fillStyle = nightOverlayAlpha > 0.25 ? "#243528" : "#3e6843";
    ctx.fillRect(-cameraX, -cameraY, mapW, mapH);

    const me = application.playersList.list.find((p) => p.id === socket.id);
    const visibleCells = me ? me.visibleCells : [];

    drawBuildModeOverlay(cameraX, cameraY);
    // Particles are deliberately rendered first so the damaged/destroyed
    // object always stays visually above its own particles.
    updateAndDrawHitParticles(cameraX, cameraY, currentTime);
    drawGroundItems(visibleCells, cameraX, cameraY);
    drawSaplings(visibleCells, cameraX, cameraY);
    drawCampfires(visibleCells, cameraX, cameraY, currentTime);
    drawWorkbenches(visibleCells, cameraX, cameraY, currentTime);
    drawNatureObjects(visibleCells, cameraX, cameraY, { maxLayerExclusive: PLAYER_DRAW_LAYER });

    drawResourceFlyAnims(cameraX, cameraY, currentTime);
    drawSpearLandAnims(cameraX, cameraY, currentTime);

    for (let i = corpses.length - 1; i >= 0; i--) {
      if (corpses[i].until <= currentTime) {
        corpses.splice(i, 1);
        continue;
      }
      const cx = corpses[i].x - cameraX;
      const cy = corpses[i].y - cameraY;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(((corpses[i].angle ?? 0) * Math.PI) / 180);
      ctx.drawImage(images.dead, -89, -89, 178, 178);
      ctx.restore();
    }
    
    for (const id in flyingSpears) {
      const spear = flyingSpears[id];
      const spearImg = images.spearHand;
      if (spearImg?.complete && spearImg.naturalWidth) {
        let sw = 80;
        let sh = (spearImg.naturalHeight / spearImg.naturalWidth) * sw;
        const flyScreenX = spear.x - cameraX;
        const flyScreenY = spear.y - cameraY;
        ctx.save();
        ctx.translate(flyScreenX, flyScreenY);
        ctx.rotate((spear.angle + 90) * Math.PI / 180);
        ctx.drawImage(spearImg, -sw / 2, -sh / 2, sw, sh);
        ctx.restore();
        if (showDebugHitboxes) {
          ctx.save();
          ctx.strokeStyle = "black";
          ctx.lineWidth = 2 / scale;
          drawCircle(flyScreenX, flyScreenY, settings?.settings?.SPEAR_HITBOX_RADIUS ?? 20);
          ctx.restore();
        }
      }
    }

    if (localSpear.state === 'flying') {
      const spearImg = images.spearHand;
      if (spearImg?.complete && spearImg.naturalWidth) {
        const sw = 80;
        const sh = (spearImg.naturalHeight / spearImg.naturalWidth) * sw;
        ctx.save();
        ctx.translate(localSpear.worldX - cameraX, localSpear.worldY - cameraY);
        ctx.rotate(((localSpear.angle + 90) * Math.PI) / 180);
        ctx.drawImage(spearImg, -sw / 2, -sh / 2, sw, sh);
        ctx.restore();
        if (showDebugHitboxes) {
          ctx.save();
          ctx.strokeStyle = "black";
          ctx.lineWidth = 2 / scale;
          drawCircle(localSpear.worldX - cameraX, localSpear.worldY - cameraY, settings?.settings?.SPEAR_HITBOX_RADIUS ?? 20);
          ctx.restore();
        }
      }
    }

    for (const player of application.playersList.list) {
      const isMe = player.id === socket.id;
      const attackAnim = isMe ? myAttackAnim : updateAttackAnimation(player);
      drawPlayerEntity(player, cameraX, cameraY, isMe, attackAnim);
    }

    drawBuildings(visibleCells, cameraX, cameraY, currentTime);
    drawNatureObjects(visibleCells, cameraX, cameraY, { minLayerInclusive: PLAYER_DRAW_LAYER });

    drawBuildGhost(cameraX, cameraY);

    if (localSpear.state === 'landed') {
      const groundImg = images.spearGround;
      if (groundImg?.complete && groundImg.naturalWidth) {
        const size = 128;
        const drawX = localSpear.worldX - cameraX - size / 2;
        const drawY = localSpear.worldY - cameraY - size / 2;
        ctx.drawImage(groundImg, drawX, drawY, size, size);
      }
    }

    if (nightOverlayAlpha > 0.01) {
      ctx.fillStyle = `rgba(4, 8, 22, ${nightOverlayAlpha})`;
      ctx.fillRect(-viewW / 2, -viewH / 2, viewW, viewH);
    }

    // E-hints are a top-most world/UI layer. Only one station hint is shown:
    // the station selected by the same contextual E action. Loot may be shown
    // alongside it, but the icons are spaced far enough to never overlap.
    let hasInteractionHints = false;
    if (!workbenchPanelOpen && !campfirePanelOpen) {
      const interactable = findNearestInteractableGround(visibleCells);
      const station = findNearestStationInteractable();
      const door = findNearestDoorInteractable();
      const hints = [];
      if (interactable) hints.push({ kind: "loot", value: interactable.itemId, dist: interactable.dist });
      if (station) hints.push({ kind: station.kind, cell: station.cell, dist: station.dist });
      if (door) hints.push({ kind: "door", cell: door.cell, dist: door.dist });
      hints.sort((a,b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
      const limitedHints = hints.slice(0, 3);
      hasInteractionHints = limitedHints.length > 0;

      // Keep the loot E and station E well separated. The previous 180 px
      // spacing could still make larger hint images touch/overlap.
      const hintStep = limitedHints.length <= 1 ? 0 : 340;
      const hintStart = -hintStep * (limitedHints.length - 1) / 2;
      limitedHints.forEach((hint, index) => {
        const offsetX = hintStart + index * hintStep;
        if (hint.kind === "loot") drawLootInteractionHint(hint.value, cameraX, cameraY, offsetX);
        else if (hint.kind === "campfire") drawCampfireInteractionHint(cameraX, cameraY, offsetX);
        else if (hint.kind === "workbench") drawWorkbenchInteractionHint(cameraX, cameraY, offsetX);
        else if (hint.kind === "door") drawDoorInteractionHint(hint, offsetX);
      });
    }

    // The action clock must remain above every world object and above E-hints.
    // When an E-hint is visible, lift the action clock higher so it never
    // overlaps the interaction images. With no E-hint it keeps its normal position.
    if (actionTimer) drawActionTimerAbove(0, 0, hasInteractionHints ? -100 : 0);

    ctx.restore();

    drawHpBar();
    drawInventory();
    drawLeaderboard();
    drawCraftButton();
    drawCraftPanel();
    ClanUI.draw();
    drawCampfirePanel();
    drawWorkbenchPanel();
  }

  lastUpdateTime = currentTime;
}

draw();