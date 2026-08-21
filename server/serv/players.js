import settings from "./settings.js";
import { createEmptyInventory, addItemToInventory } from "./items.js";

export class Player {
  constructor(params) {
    this.type = params.eType;
    this.name = params.name;
    this.id = params.id;
    this.vector = [];
    this.speed = 8;
    this.sprinting = false;
    this.maxEnergy = settings.MAX_ENERGY ?? 300;
    this.energy = this.maxEnergy;
    this.energyRegenReadyAt = 0;
    this._energyDirty = false;
    this._lastEnergySentAt = 0;
    this.hitboxRadius = settings.PLAYER_HITBOX_RADIUS;
    this.interactionRadius = settings.INTERACTION_RADIUS;
    this.angle = 0;
    this.text = [];
    this.visibleCells = [];
    this.playerXCell = 0;
    this.playerYCell = 0;
    this.radius = settings.PLAYER_RADIUS;
    this.hp = settings.MAX_HP;
    this.maxHp = settings.MAX_HP;
    this.temperature = settings.TEMPERATURE_MAX ?? 300;
    this.isAlive = true;
    this.inGame = false;
    this.lastDamageTime = 0;
    this.isAttacking = false;
    this.attackStartTime = 0;
    this.attackHitResolved = false;
    this.attackTool = "hand";
    this.attackDurationMs = settings.ATTACK_DURATION_MS;
    this.attackX = 0;
    this.attackY = 0;
    this.attackAngle = 0;
    this.lastRegenVisualTime = 0;
    this.inventory = createEmptyInventory();
    this.score = 0;
    this.satiety = settings.MAX_SATIETY;
    this.maxSatiety = settings.MAX_SATIETY;
    this.heldItemId = null;
    this.heldSlotIndex = -1;
    this.eatingFood = null;
    this.lootBusyUntil = 0;
    this.craftQueue = [];
    this.x = 0;
    this.y = 0;
    this.knownPlayers = new Set([this.id]);

    // === ДОБАВЛЕНО: Состояния копья ===
    this.spearState = 'none'; // 'none', 'equipping', 'windup', 'idle_hand', 'flying', 'landed'
    this.spearTimer = 0;
    this.throwDirection = { x: 0, y: 0 };
    this.spearProjectileId = null;
    this._deathHandled = false;
  }

  placeAt(x, y) {
    this.x = x;
    this.y = y;
  }

  respawn(cellsList) {
    this.hp = settings.MAX_HP;
    this.isAlive = true;
    this.inGame = true;
    this.vector = [];
    this.sprinting = false;
    this.maxEnergy = settings.MAX_ENERGY ?? 300;
    this.energy = this.maxEnergy;
    this.energyRegenReadyAt = 0;
    this._energyDirty = false;
    this._lastEnergySentAt = 0;
    this.isAttacking = false;
    this.attackHitResolved = false;
    this.attackTool = "hand";
    this.attackDurationMs = settings.ATTACK_DURATION_MS;
    this.lastDamageTime = performance.now();
    this.lastRegenVisualTime = 0;
    this.temperature = settings.TEMPERATURE_MAX ?? 300;
    this._deathHandled = false;
    this.inventory = createEmptyInventory();
    // Every new life starts with five stones in the first available slot.
    addItemToInventory(this.inventory, "stone", 5);
    this.score = 0;
    this.satiety = settings.MAX_SATIETY;
    this.maxSatiety = settings.MAX_SATIETY;
    this.heldItemId = null;
    this.heldSlotIndex = -1;
    this.eatingFood = null;
    this.lootBusyUntil = 0;
    this.craftQueue = [];
    this.knownPlayers = new Set([this.id]);

    // === ДОБАВЛЕНО ===
    this.spearState = 'none';
    this.spearTimer = 0;
    this.throwDirection = { x: 0, y: 0 };
    this.spearProjectileId = null;

    placePlayerOnFreeCell(this, cellsList);
  }
}

export function placePlayerOnFreeCell(player, cellsList) {
  const free = cellsList?.getFreeSpawnCells?.() ?? [];
  if (free.length === 0) {
    const mapSize = settings.MAP_SIDE_LENGTH * settings.CELL_SIDE_LENGTH_PIXEL;
    const pad = settings.PLAYER_HITBOX_RADIUS + 20;
    player.placeAt(
      pad + Math.random() * (mapSize - pad * 2),
      pad + Math.random() * (mapSize - pad * 2)
    );
    return;
  }

  const cell = free[Math.floor(Math.random() * free.length)];
  player.placeAt(cell.x + cell.w / 2, cell.y + cell.h / 2);
}

export class PlayersList {
  constructor() {
    this.list = [];
  }

  add(params) {
    const obj = new Player(params);
    this.list.push(obj);
    return obj;
  }

  addPlayer(name, id, cellsList) {
    const params = { eType: "player" };
    params.eType = "player";
    params.name = name;
    params.id = id;
    const player = this.add(params);
    player.inGame = true;
    addItemToInventory(player.inventory, "stone", 5);
    placePlayerOnFreeCell(player, cellsList);
    return player;
  }

  findById(id) {
    return this.list.find((player) => player.id === id);
  }

  addVector(id, vector) {
    for (let i = 0; i < this.list.length; i++) {
      if (id === this.list[i].id) {
        if (this.list[i].vector.includes(vector)) return;
        this.list[i].vector.push(vector);
      }
    }
  }

  deleteVector(id, vector) {
    for (let i = 0; i < this.list.length; i++) {
      if (id === this.list[i].id && this.list[i].vector.includes(vector)) {
        this.list[i].vector.splice(this.list[i].vector.indexOf(vector), 1);
        return;
      }
    }
  }

  setSprinting(id, sprinting) {
    for (let i = 0; i < this.list.length; i++) {
      if (id === this.list[i].id) {
        this.list[i].sprinting = !!sprinting && (this.list[i].energy ?? settings.MAX_ENERGY) > 0;
        this.list[i]._energyDirty = true;
        return;
      }
    }
  }

  addVisibleCells(visibleCellsList, id, xCell, yCell) {
    for (let i = 0; i < this.list.length; i++) {
      if (id === this.list[i].id) {
        this.list[i].visibleCells = visibleCellsList;
        this.list[i].playerXCell = xCell;
        this.list[i].playerYCell = yCell;
      }
    }
  }

  getIndexPlayerXCell(id) {
    for (let i = 0; i < this.list.length; i++) {
      if (id === this.list[i].id) {
        return this.list[i].playerXCell;
      }
    }
  }

  getIndexPlayerYCell(id) {
    for (let i = 0; i < this.list.length; i++) {
      if (id === this.list[i].id) {
        return this.list[i].playerYCell;
      }
    }
  }
}

export function sanitizePlayer(player) {
  return {
    type: player.type,
    name: player.name,
    clanName: player.clanName ?? null,
    id: player.id,
    vector: player.vector,
    speed: player.speed,
    sprinting: player.sprinting,
    hitboxRadius: player.hitboxRadius,
    interactionRadius: player.interactionRadius ?? settings.INTERACTION_RADIUS,
    angle: player.angle,
    text: player.text,
    playerXCell: player.playerXCell,
    playerYCell: player.playerYCell,
    radius: player.radius,
    x: player.x,
    y: player.y,
    hp: player.hp,
    maxHp: player.maxHp,
    satiety: Math.round(player.satiety ?? settings.MAX_SATIETY),
    maxSatiety: player.maxSatiety ?? settings.MAX_SATIETY,
    score: Math.floor(player.score ?? 0),
    heldItemId: player.heldItemId ?? null,
    heldSlotIndex: player.heldSlotIndex ?? -1,
    
    // === ДОБАВЛЕНО ДЛЯ СИНХРОНИЗАЦИИ ===
    spearState: player.spearState ?? 'none',
  };
}

export function getActivePlayers(players) {
  return players.filter((player) => player.isAlive && player.inGame);
}
















