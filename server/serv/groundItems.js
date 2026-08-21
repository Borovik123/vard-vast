import settings from "./settings.js"; 
import { getItemDef, getAllItems } from "./items.js"; 
import { ENTITY_TYPES } from "./entityTypes.js"; 

let groundLootSeq = 0; 
function makeGroundLootId() { 
  groundLootSeq += 1; 
  return `g${groundLootSeq}_${Math.floor(performance.now())}`; 
} 

export function getGroundItems(cell) { 
  if (!cell) return []; 
  if (Array.isArray(cell.groundItems) && cell.groundItems.length) { 
    return cell.groundItems; 
  } 
  if (cell.groundItem?.itemId) { 
    return [cell.groundItem]; 
  } 
  return []; 
} 

function syncGroundItemMirror(cell) { 
  const items = getGroundItems(cell); 
  cell.groundItems = items.length ? items : null; 
  cell.groundItem = items[0] ?? null; 
} 

export function clearGroundItem(cell, lootId = null) { 
  if (!cell) return; 
  if (!lootId) { 
    cell.groundItems = null; 
    cell.groundItem = null; 
    return; 
  } 
  const next = getGroundItems(cell).filter((loot) => loot.id !== lootId); 
  cell.groundItems = next.length ? next : null; 
  cell.groundItem = next[0] ?? null; 
} 

function groundLifetimeMs() { 
  return settings.GROUND_ITEM_LIFETIME_MS ?? 10_000; 
} 

function groundShrinkMs() { 
  return settings.GROUND_ITEM_SHRINK_MS ?? 450; 
} 

function stampGroundExpiry(loot, now = performance.now()) { 
  const life = groundLifetimeMs(); 
  loot.expiresAt = now + life; 
  loot.removeAt = loot.expiresAt + groundShrinkMs(); 
  return loot; 
} 

export function setGroundItem(cell, itemId, amount = 1, worldX, worldY) { 
  if (!getItemDef(itemId)) { 
    clearGroundItem(cell); 
    return false; 
  } 
  const x = Number.isFinite(worldX) ? worldX : cell.x + cell.w / 2; 
  const y = Number.isFinite(worldY) ? worldY : cell.y + cell.h / 2; 
  cell.groundItems = [ 
    stampGroundExpiry({ 
      id: makeGroundLootId(), 
      itemId, 
      amount, 
      x, 
      y, 
      pickableAt: 0, 
    }), 
  ]; 
  cell.groundItem = cell.groundItems[0]; 
  return true; 
} 

export function addGroundItem( 
  cell, 
  itemId, 
  amount, 
  worldX, 
  worldY, 
  { pickableDelayMs = 0 } = {} 
) { 
  if (!cell || !getItemDef(itemId) || amount <= 0) return null; 
  const x = Number.isFinite(worldX) ? worldX : cell.x + cell.w / 2; 
  const y = Number.isFinite(worldY) ? worldY : cell.y + cell.h / 2; 
  const delay = Math.max(0, Number(pickableDelayMs) || 0); 
  const now = performance.now(); 
  const loot = stampGroundExpiry( 
    { 
      id: makeGroundLootId(), 
      itemId, 
      amount, 
      x, 
      y, 
      pickableAt: delay > 0 ? now + delay : 0, 
    }, 
    now 
  ); 
  const items = getGroundItems(cell); 
  items.push(loot); 
  cell.groundItems = items; 
  cell.groundItem = items[0]; 
  return loot; 
} 

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function spawnGroundItemsOnMap(cells) { 
  const total = cells.length; 
  const changed = []; 

  for (const item of getAllItems()) { 
    if (item.groundSpawnPercent <= 0) continue; 

    const target = Math.round((total * item.groundSpawnPercent) / 100); 
    let current = 0; 
    for (let i = 0; i < cells.length; i++) { 
      current += getGroundItems(cells[i]).filter((g) => g.itemId === item.id) 
        .length; 
    } 

    const need = target - current; 
    if (need <= 0) continue; 

    const eligible = cells.filter( 
      (c) => c.natureType === "empty" && getGroundItems(c).length === 0 
    ); 
    shuffleInPlace(eligible); 

    const place = Math.min(need, eligible.length); 
    for (let i = 0; i < place; i++) { 
      setGroundItem(eligible[i], item.id, 1); 
      changed.push(eligible[i]); 
    } 
  } 

  return changed; 
} 

export function findNearestGroundItem(cellsList, x, y, radius) { 
  const pickRadius = radius + 8; 
  const now = performance.now(); 
  const nearby = cellsList.getNearbyCells 
    ? cellsList.getNearbyCells( 
        x, 
        y, 
        pickRadius + settings.CELL_SIDE_LENGTH_PIXEL 
      ) 
    : null; 

  const candidates = nearby ?? cellsList.list; 
  let best = null; 
  let bestDist = pickRadius; 

  for (let i = 0; i < candidates.length; i++) { 
    const cell = candidates[i]; 
    const items = getGroundItems(cell); 
    for (let j = 0; j < items.length; j++) { 
      const loot = items[j]; 
      if (!loot?.itemId) continue; 
      if (loot.pickableAt && now < loot.pickableAt) continue; 
      if (loot.expiresAt && now >= loot.expiresAt) continue; 
      const gx = loot.x ?? cell.x + cell.w / 2; 
      const gy = loot.y ?? cell.y + cell.h / 2; 
      const dist = Math.hypot(gx - x, gy - y); 
      if (dist <= bestDist) { 
        bestDist = dist; 
        best = { cell, loot }; 
      } 
    } 
  } 
  return best; 
} 

function isDropPointTooClose(cellsList, x, y, minDist) { 
  const nearby = cellsList.getNearbyCells 
    ? cellsList.getNearbyCells(x, y, minDist + settings.CELL_SIDE_LENGTH_PIXEL) 
    : cellsList.list; 
  for (let i = 0; i < nearby.length; i++) { 
    const items = getGroundItems(nearby[i]); 
    for (let j = 0; j < items.length; j++) { 
      const loot = items[j]; 
      const gx = loot.x ?? nearby[i].x + nearby[i].w / 2; 
      const gy = loot.y ?? nearby[i].y + nearby[i].h / 2; 
      if (Math.hypot(gx - x, gy - y) < minDist) return true; 
    } 
  } 
  return false; 
} 

export function findDropPlacement( 
  cellsList, 
  playerX, 
  playerY, 
  dirX, 
  dirY, 
  interactionRadius = settings.INTERACTION_RADIUS 
) { 
  let nx = Number(dirX) || 0; 
  let ny = Number(dirY) || 0; 
  let len = Math.hypot(nx, ny); 
  let baseAngle; 
  if (len < 0.001) { 
    baseAngle = Math.random() * Math.PI * 2; 
  } else { 
    baseAngle = Math.atan2(ny, nx); 
  } 

  const interactR = interactionRadius || settings.INTERACTION_RADIUS || 200; 
  const inset = settings.DROP_RADIUS_INSET ?? 28; 
  const r = Math.max(40, interactR - inset); 
  const minSep = 36; 
  const steps = 48; 

  let fallback = null; 

  for (let i = 0; i < steps; i++) { 
    const sign = i === 0 ? 0 : i % 2 === 1 ? 1 : -1; 
    const step = i === 0 ? 0 : Math.ceil(i / 2); 
    const angle = baseAngle + sign * step * ((Math.PI * 2) / steps); 
    const x = playerX + Math.cos(angle) * r; 
    const y = playerY + Math.sin(angle) * r; 

    const cell = cellsList.getCellAtWorld 
      ? cellsList.getCellAtWorld(x, y) 
      : null; 
    if (!cell) continue; 

    if (!fallback) fallback = { cell, x, y }; 
    if (isDropPointTooClose(cellsList, x, y, minSep)) continue; 

    return { cell, x, y }; 
  } 

  return fallback; 
} 

export function placeItemOnGround( 
  cell, 
  itemId, 
  amount, 
  { allowStack = true, x, y, pickableDelayMs = 0 } = {} 
) { 
  if (!cell || !getItemDef(itemId) || amount <= 0) return null; 

  if (allowStack) { 
    const items = getGroundItems(cell); 
    const existing = items.find((loot) => loot.itemId === itemId); 
    if (existing) { 
      existing.amount += amount; 
      stampGroundExpiry(existing); 
      syncGroundItemMirror(cell); 
      return existing; 
    } 
  } 

  return addGroundItem(cell, itemId, amount, x, y, { pickableDelayMs }); 
} 

export function expireGroundItemsOnMap(cells) { 
  const now = performance.now(); 
  const changed = []; 

  for (let i = 0; i < cells.length; i++) { 
    const cell = cells[i]; 
    const items = getGroundItems(cell); 
    if (!items.length) continue; 

    const kept = []; 
    let removed = false; 
    for (let j = 0; j < items.length; j++) { 
      const loot = items[j]; 
      const removeAt = 
        loot.removeAt ?? 
        (loot.expiresAt != null 
          ? loot.expiresAt + groundShrinkMs() 
          : Infinity); 
      if (now >= removeAt) { 
        removed = true; 
        continue; 
      } 
      kept.push(loot); 
    } 

    if (removed) { 
      cell.groundItems = kept.length ? kept : null; 
      cell.groundItem = kept[0] ?? null; 
      changed.push(cell); 
    } 
  } 

  return changed; 
} 

export function stampGroundItemsForNetwork(cells) { 
  const now = performance.now(); 
  for (let i = 0; i < cells.length; i++) { 
    const items = getGroundItems(cells[i]); 
    for (let j = 0; j < items.length; j++) { 
      const loot = items[j]; 
      loot.pickableInMs = loot.pickableAt 
        ? Math.max(0, Math.ceil(loot.pickableAt - now)) 
        : 0; 
      loot.expiresInMs = loot.expiresAt 
        ? Math.ceil(loot.expiresAt - now) 
        : 0; 
    } 
  } 
  return cells; 
} 

export function serializeGroundItems(cell) { 
  const now = performance.now(); 
  return getGroundItems(cell).map((loot) => ({ 
    id: loot.id, 
    entityType: ENTITY_TYPES.GROUND_ITEM, 
    itemId: loot.itemId, 
    amount: loot.amount, 
    x: loot.x, 
    y: loot.y, 
    pickableInMs: loot.pickableAt 
      ? Math.max(0, Math.ceil(loot.pickableAt - now)) 
      : 0, 
    expiresInMs: loot.expiresAt 
      ? Math.ceil(loot.expiresAt - now) 
      : 0, 
  })); 
} 