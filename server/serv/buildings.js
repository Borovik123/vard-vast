import settings from "./settings.js";
import { normalizeRotation } from "./entityTypes.js";

export const BUILDINGS = Object.freeze({
  wood_wall: { id:"wood_wall", kind:"wall", material:"wood", maxHp:3000, recipe:{itemId:"wood",amount:20}, craftMs:10000, drop:{itemId:"wood",amount:5}, sprite:"wood-wall", groundSprite:"wood-wall-ground", broke1:"wood-wall-broke1", broke2:"wood-wall-broke2", particle:"wood" },
  wood_door: { id:"wood_door", kind:"door", material:"wood", maxHp:2500, recipe:{itemId:"wood",amount:60}, craftMs:15000, drop:{itemId:"wood",amount:10}, sprite:"wood-door", groundSprite:"wood-door-ground", broke1:"wood-door-broke1", broke2:"wood-door-broke2", particle:"wood" },
  stone_wall: { id:"stone_wall", kind:"wall", material:"stone", maxHp:6000, recipe:{itemId:"stone",amount:20}, craftMs:15000, drop:{itemId:"stone",amount:5}, sprite:"stone-wall", groundSprite:"stone-wall-ground", broke1:"stone-wall-broke1", broke2:"stone-wall-broke2", particle:"stone" },
  stone_door: { id:"stone_door", kind:"door", material:"stone", maxHp:5500, recipe:{itemId:"stone",amount:60}, craftMs:20000, drop:{itemId:"stone",amount:10}, sprite:"stone-door", groundSprite:"stone-door-ground", broke1:"stone-door-broke1", broke2:"stone-door-broke2", particle:"stone" },
  metal_wall: { id:"metal_wall", kind:"wall", material:"metal", maxHp:12000, recipe:{itemId:"metal",amount:3}, craftMs:40000, drop:{itemId:"metal",amount:1}, sprite:"metal-wall", groundSprite:"metal-wall-ground", broke1:"metal-wall-broke1", broke2:"metal-wall-broke2", particle:"steel" },
  metal_door: { id:"metal_door", kind:"door", material:"metal", maxHp:11000, recipe:{itemId:"metal",amount:9}, craftMs:60000, drop:{itemId:"metal",amount:2}, sprite:"metal-door", groundSprite:"metal-door-ground", broke1:"metal-door-broke1", broke2:"metal-door-broke2", particle:"steel" },
});

export const BUILDING_ITEMS = Object.freeze(Object.keys(BUILDINGS));
export const BUILDING_HITBOX_SIZE = 200;
export const BUILDING_EQUIP_MS = 1000;
export const DOOR_ANIM_MS = 600;
export const DEFAULT_DOOR_OPEN_DIRECTION = -1;

export function getBuildingDef(id) { return BUILDINGS[id] ?? null; }
export function isBuildingItem(id) { return !!BUILDINGS[id]; }
export function getDamageStage(hp, maxHp) {
  if (hp <= maxHp / 3) return 2;
  if (hp <= maxHp * 2 / 3) return 1;
  return 0;
}
export function getBuildingSpriteKey(building) {
  const def = getBuildingDef(building?.buildingId);
  if (!def) return null;
  const stage = getDamageStage(building.hp, def.maxHp);
  return stage === 2 ? def.broke2 : stage === 1 ? def.broke1 : def.sprite;
}

// The door sprite is always hinged at its local bottom-left corner.
// After the base rotation this single local pivot becomes:
// r0 -> world bottom-left, r1 -> world top-left,
// r2 -> world top-right, r3 -> world bottom-right.
export const DOOR_PIVOT = Object.freeze([-100, 100]);

// A fully opened door rotates 180 degrees around its fixed hinge corner.
// This puts the door center exactly in the diagonal cell: \n// r0 -> south-west, r1 -> north-west, r2 -> north-east, r3 -> south-east.
// The +1 direction is kept as the opposite angular direction; the endpoint is
// identical because the total turn is 180 degrees.
const DOOR_TARGET_DELTAS = Object.freeze([
  { '-1': [-1, 1], '1': [-1, 1] },
  { '-1': [-1, -1], '1': [-1, -1] },
  { '-1': [1, -1], '1': [1, -1] },
  { '-1': [1, 1], '1': [1, 1] },
]);

export function normalizeDoorOpenDirection(direction) {
  return Number(direction) < 0 ? -1 : 1;
}

export function getDoorTargetCell(indexX, indexY, rotation, openDirection = -1) {
  const r = normalizeRotation(rotation);
  const sign = normalizeDoorOpenDirection(openDirection);
  const d = DOOR_TARGET_DELTAS[r][String(sign)];
  return { indexX:indexX + d[0], indexY:indexY + d[1] };
}

export function getDoorTransformAtProgress(cell, building, progress, cellsGrid = null) {
  const r = normalizeRotation(building?.rotation);
  const sign = normalizeDoorOpenDirection(building?.openDirection);
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  const pivot = DOOR_PIVOT;
  const baseAngle = r * Math.PI / 2;
  const clamped = Math.max(0, Math.min(1, progress));
  const angle = baseAngle + sign * Math.PI * clamped;
  const rotate = (x, y, a) => ({
    x:x * Math.cos(a) - y * Math.sin(a),
    y:x * Math.sin(a) + y * Math.cos(a),
  });

  // The hinge is a fixed world point: the corresponding corner of the
  // original cell. The entire door is then rotated around that point.
  const hinge = rotate(pivot[0], pivot[1], baseAngle);
  const centerOffset = rotate(pivot[0], pivot[1], angle);
  let x = cx + hinge.x - centerOffset.x;
  let y = cy + hinge.y - centerOffset.y;

  if (cellsGrid && clamped >= 0.999999) {
    const target = getDoorTargetCell(cell.indexX, cell.indexY, r, sign);
    const targetCell = cellsGrid[target.indexX]?.[target.indexY];
    if (targetCell) {
      x = targetCell.x + targetCell.w / 2;
      y = targetCell.y + targetCell.h / 2;
    }
  }

  return { x, y, angle, pivot, hingeX: cx + hinge.x, hingeY: cy + hinge.y };
}

export function getDoorOffset(rotation, openProgress, openDirection = -1) {
  const r = normalizeRotation(rotation);
  const sign = normalizeDoorOpenDirection(openDirection);
  const baseAngle = r * Math.PI / 2;
  const clamped = Math.max(0, Math.min(1, openProgress));
  const angle = baseAngle + sign * Math.PI * clamped;
  const rotate = (x, y, a) => ({
    x:x * Math.cos(a) - y * Math.sin(a),
    y:x * Math.sin(a) + y * Math.cos(a),
  });
  const hinge = rotate(DOOR_PIVOT[0], DOOR_PIVOT[1], baseAngle);
  const centerOffset = rotate(DOOR_PIVOT[0], DOOR_PIVOT[1], angle);
  return {
    x: hinge.x - centerOffset.x,
    y: hinge.y - centerOffset.y,
    angle: sign * Math.PI * clamped,
  };
}

export function getDoorProgress(building, now = performance.now()) {
  if (!building || building.kind !== "door") return 0;
  const state = normalizeDoorState(building.state);
  if (state === "OPEN") return 1;
  if (state === "CLOSED") return 0;
  if (state === "OPENING") return Math.min(1, Math.max(0, (now - building.doorStartedAt) / DOOR_ANIM_MS));
  if (state === "CLOSING") return Math.max(0, Math.min(1, 1 - (now - building.doorStartedAt) / DOOR_ANIM_MS));
  return Number(building.doorProgress) || 0;
}

export function getDoorWorldCenter(cell, building, now = performance.now()) {
  if (!cell) return { x:0, y:0 };
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  if (!building || building.kind !== "door") return { x:cx, y:cy };

  const progress = getDoorProgress(building, now);
  const offset = getDoorOffset(building.rotation, progress, building.openDirection);
  return { x:cx + offset.x, y:cy + offset.y };
}

export class Building {
  constructor(buildingId, x, y, ownerId = null, rotation = 0) {
    const def = getBuildingDef(buildingId);
    this.id = buildingId;
    this.buildingId = buildingId;
    this.kind = def.kind;
    this.entityType = "building";
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.hp = def.maxHp;
    this.maxHp = def.maxHp;
    this.rotation = normalizeRotation(rotation);
    this.hitboxWidth = BUILDING_HITBOX_SIZE;
    this.hitboxHeight = BUILDING_HITBOX_SIZE;
    this.state = def.kind === "door" ? "CLOSED" : null;
    this.projectileBlocks = def.kind === "wall" || def.kind === "door";
    this.openDirection = DEFAULT_DOOR_OPEN_DIRECTION;
    this.reservationCells = [];
    this.playerCollisionCells = [];
    this.hitReaction = 0;
    this.doorStartedAt = 0;
    this.doorProgress = 0;
  }
  serialize() {
    return {
      id:this.id,
      buildingId:this.buildingId,
      kind:this.kind,
      ownerId:this.ownerId,
      hp:this.hp,
      maxHp:this.maxHp,
      rotation:this.rotation,
      hitboxWidth:this.hitboxWidth,
      hitboxHeight:this.hitboxHeight,
      state:this.state,
      doorProgress:this.doorProgress,
      doorStartedAt:this.doorStartedAt,
      openDirection:this.openDirection,
      projectileBlocks:this.projectileBlocks,
      reservationCells:this.reservationCells,
      playerCollisionCells:this.playerCollisionCells,
    };
  }
}

export function getBuildingClientManifest() {
  const out = {};
  for (const def of Object.values(BUILDINGS)) {
    out[`${def.id}Inv`] = `${def.sprite}.png`;
    out[`${def.id}Ground`] = `${def.groundSprite}.png`;
    out[`${def.id}Broke1`] = `${def.broke1}.png`;
    out[`${def.id}Broke2`] = `${def.broke2}.png`;
  }
  return out;
}

export function getBuildingRecipes() {
  return Object.values(BUILDINGS).map(def => ({
    id:`build_${def.id}`,
    station:"workbench",
    label:def.id.replaceAll("_", " "),
    description:`${def.material} ${def.kind}`,
    info:`HP: ${def.maxHp}`,
    result:{itemId:def.id, amount:1},
    ingredients:[{...def.recipe}],
    durationMs:def.craftMs,
  }));
}

export function normalizeDoorState(state) {
  if (!state) return "CLOSED";
  const s = String(state).toUpperCase();
  return ["CLOSED","OPENING","OPEN","CLOSING","DESTROYED"].includes(s) ? s : "CLOSED";
}

export function getDoorStateAtProgress(building, now = performance.now()) {
  if (!building || building.kind !== "door") return { progress:0, opening:false };
  building.state = normalizeDoorState(building.state);
  const progress = getDoorProgress(building, now);
  return {
    progress,
    opening: building.state === "OPEN" || building.state === "OPENING",
  };
}