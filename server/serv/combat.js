import settings from "./settings.js";
import { moveWithCollisions, circleIntersectsObstacle } from "./collision.js";
import { clearNatureFromCell } from "./natureObjects.js";
import { hasSapling } from "./saplings.js";
import { getToolProfile } from "./items.js";
import { removeCampfire } from "./campfire.js";
import { removeWorkbench } from "./workbench.js";
import { getBuildingDef } from "./buildings.js";
import { gameObjectManager } from "./gameObjects.js";

/**
 * Сохраняет позицию атаки для игрока.
 */
export function getAttackSnapshot(attacker) {
  return {
    x: attacker.attackX ?? attacker.x,
    y: attacker.attackY ?? attacker.y,
    angle: attacker.attackAngle ?? attacker.angle,
    tool: attacker.attackTool || "hand",
    attackerId: attacker.id,
    attackerClanId: attacker.clanId ?? null,
  };
}

/**
 * Возвращает зону поражения (круг) относительно позиции атакующего.
 */
export function getAttackZone(source) {
  const profile = getToolProfile(source.tool) ?? getToolProfile(null);
  const angleRad = (source.angle * Math.PI) / 180;
  return {
    cx: source.x + Math.cos(angleRad) * profile.zoneDistance,
    cy: source.y + Math.sin(angleRad) * profile.zoneDistance,
    radius: profile.zoneRadius,
  };
}

function getAttackDamage(source) {
  return (getToolProfile(source.tool) ?? getToolProfile(null)).damage;
}

function getPlayerAttackDamage(source) {
  if (source.tool === "hammer") return settings.HAMMER_PLAYER_DAMAGE ?? 30;
  return getAttackDamage(source);
}

export function getObjectAttackDamage(source, ownerId = null, ownerPlayer = null) {
  const base = getAttackDamage(source);
  if (source.tool === "hammer" && ownerId != null) {
    if (ownerId === source.attackerId || (ownerPlayer?.clanId && ownerPlayer.clanId === source.attackerClanId)) return base * 5;
  }
  return base;
}

/**
 * Проверка пересечения двух окружностей.
 */
function circlesOverlap(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy <= (r1 + r2) * (r1 + r2);
}

/**
 * Получение препятствий для игрока (игроки + природные объекты).
 */
function getObstaclesForPlayer(player, players, cellsList, searchRadius) {
  return [
    ...cellsList.getNearbyObstacles(player.x, player.y, searchRadius),
    ...players
      .filter((other) => other.id !== player.id && other.isAlive && other.inGame)
      .map((other) => ({
        cx: other.x,
        cy: other.y,
        radius: other.hitboxRadius,
      })),
  ];
}

/**
 * Отбрасывание жертвы от атакующего.
 */
function applyKnockback(victim, attacker, players, cellsList) {
  const source = getAttackSnapshot(attacker);
  const dx = victim.x - source.x;
  const dy = victim.y - source.y;
  const dist = Math.hypot(dx, dy) || 1;
  const knockDx = (dx / dist) * settings.KNOCKBACK_DISTANCE;
  const knockDy = (dy / dist) * settings.KNOCKBACK_DISTANCE;

  const obstacles = getObstaclesForPlayer(
    victim,
    players,
    cellsList,
    victim.hitboxRadius +
      settings.DEFAULT_OBJECT_RADIUS +
      settings.KNOCKBACK_DISTANCE
  );

  const next = moveWithCollisions(
    victim.x,
    victim.y,
    victim.hitboxRadius,
    knockDx,
    knockDy,
    obstacles
  );

  victim.x = next.x;
  victim.y = next.y;
}

/**
 * Обработка атаки по игрокам.
 */
export function resolveAttackHit(attacker, players, cellsList) {
  if (!attacker.isAlive || !attacker.inGame) {
    return [];
  }

  const source = getAttackSnapshot(attacker);
  const zone = getAttackZone(source);
  const hits = [];

  for (let i = 0; i < players.length; i++) {
    const victim = players[i];

    if (victim.id === attacker.id || !victim.isAlive || !victim.inGame) {
      continue;
    }

    if (
      !circlesOverlap(
        zone.cx,
        zone.cy,
        zone.radius,
        victim.x,
        victim.y,
        victim.hitboxRadius
      )
    ) {
      continue;
    }

    const oldHp = victim.hp;
    victim.hp = Math.max(0, victim.hp - getPlayerAttackDamage(source));
    victim.lastDamageTime = performance.now();
    applyKnockback(victim, attacker, players, cellsList);

    hits.push({
      victim,
      oldHp,
      died: victim.hp <= 0,
    });
  }

  return hits;
}

/**
 * Обработка атаки по объектам природы (деревья, камни, руда) и кострам.
 * Саженцы обрабатываются отдельно.
 */
function circleOverlapsObject(cx, cy, radius, objectCx, objectCy, object) {
  const obstacle = object?.hitboxWidth && object?.hitboxHeight
    ? { shape: "rect", cx: objectCx, cy: objectCy, width: object.hitboxWidth, height: object.hitboxHeight, rotation: Number(object.hitboxRotation ?? (((object.rotation ?? 0) + 1) % 4)) * Math.PI / 2 }
    : { shape: "circle", cx: objectCx, cy: objectCy, radius: object?.hitboxRadius ?? settings.DEFAULT_OBJECT_RADIUS };
  return circleIntersectsObstacle(cx, cy, radius, obstacle);
}

export function resolveNatureAttackHit(attacker, cellsList, players = []) {
  if (!attacker.isAlive || !attacker.inGame) {
    return [];
  }

  const source = getAttackSnapshot(attacker);
  const zone = getAttackZone(source);
  const searchRadius =
    Math.max(
      settings.ATTACK_ZONE_DISTANCE + settings.ATTACK_ZONE_RADIUS,
      ...( ["hatchet", "pickaxe_stone", "hammer"].map((tool) => { const p = getToolProfile(tool); return p.zoneDistance + p.zoneRadius; }) )
    ) + settings.DEFAULT_OBJECT_RADIUS;

  // Получаем все атакуемые клетки (природа, саженцы, костры)
  const cells = cellsList.getNearbyAttackableCells(source.x, source.y, searchRadius);
  const hits = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];

    // Саженцы пропускаем – они обрабатываются в resolveSaplingAttackTargets
    if (hasSapling(cell) && (cell.natureType === "empty" || cell.hp <= 0)) {
      continue;
    }

    // ---- Workbench (also mirrored through cell.building for collision purposes) ----
    if (cell.workbench && cell.building === cell.workbench) {
      const wb = cell.workbench;
      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      if (!circleOverlapsObject(zone.cx, zone.cy, zone.radius, cx, cy, wb)) continue;

      const oldHp = wb.hp;
      wb.hp = Math.max(0, wb.hp - getObjectAttackDamage(source, wb.ownerId, players.find(p=>p.id===wb.ownerId)));
      const destroyed = wb.hp <= 0;
      const dx = cx - source.x;
      const dy = cy - source.y;
      const dist = Math.hypot(dx, dy) || 1;
      const knockDx = (dx / dist) * settings.NATURE_HIT_KNOCKBACK;
      const knockDy = (dy / dist) * settings.NATURE_HIT_KNOCKBACK;
      const destroyedWorkbench = destroyed ? removeWorkbench(cell) : null;
      hits.push({ cell, oldHp, destroyed, knockDx, knockDy, natureTypeBefore: "workbench", destroyedWorkbench, hitX: cx, hitY: cy });
      continue;
    }

    // ---- Player-built blocks / doors ----
    if (cell.building) {
      const b = cell.building;
      if (cell.workbench && b === cell.workbench) continue;
      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      let bcx = cx;
      let bcy = cy;
      let progress = 0;
      if (b.kind === "door") {
        const state = String(b.state ?? "CLOSED").toUpperCase();
        progress = state === "OPEN" ? 1 : state === "CLOSED" ? 0 : Math.max(0, Math.min(1, Number(b.doorProgress) || 0));
        const dirs = [[-1,1],[-1,-1],[1,-1],[1,1]];
        const d = dirs[(b.rotation ?? 0) % 4];
        bcx += d[0] * settings.CELL_SIDE_LENGTH_PIXEL * progress;
        bcy += d[1] * settings.CELL_SIDE_LENGTH_PIXEL * progress;
      }
      const obstacle = { shape:"rect", cx:bcx, cy:bcy, width:200, height:200, rotation:0 };
      if (!circleIntersectsObstacle(zone.cx, zone.cy, zone.radius, obstacle)) continue;

      const oldHp = b.hp;
      b.hp = Math.max(0, b.hp - getObjectAttackDamage(source, b.ownerId, players.find(p=>p.id===b.ownerId)));
      const destroyed = b.hp <= 0;
      const dx = bcx - source.x;
      const dy = bcy - source.y;
      const dist = Math.hypot(dx, dy) || 1;
      const knockDx = (dx / dist) * settings.NATURE_HIT_KNOCKBACK;
      const knockDy = (dy / dist) * settings.NATURE_HIT_KNOCKBACK;
      const destroyedBuilding = destroyed ? b : null;

      hits.push({
        cell, oldHp, destroyed, knockDx, knockDy,
        hitX: bcx, hitY: bcy,
        natureTypeBefore:"building",
        buildingId:b.buildingId,
        destroyedBuilding,
      });
      if (destroyed) {
        cell.building = null;
        gameObjectManager.unregister("building", cell, b);
      }
      continue;
    }

    // ---- Природные объекты ----
    if (cell.natureType !== "empty" && cell.hp > 0) {
      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      const radius = cell.hitboxRadius || settings.DEFAULT_OBJECT_RADIUS;
      if (!circlesOverlap(zone.cx, zone.cy, zone.radius, cx, cy, radius)) {
        continue;
      }

      const oldHp = cell.hp;
      const natureTypeBefore = cell.natureType;
      cell.hp = Math.max(0, cell.hp - getAttackDamage(source));
      const destroyed = cell.hp <= 0;

      const dx = cx - source.x;
      const dy = cy - source.y;
      const dist = Math.hypot(dx, dy) || 1;
      const knockDx = (dx / dist) * settings.NATURE_HIT_KNOCKBACK;
      const knockDy = (dy / dist) * settings.NATURE_HIT_KNOCKBACK;

      if (destroyed) {
        clearNatureFromCell(cell);
      }

      hits.push({
        cell,
        oldHp,
        destroyed,
        knockDx,
        knockDy,
        natureTypeBefore,
      });
      continue;
    }

    // ---- Костёр ----
    if (cell.campfire) {
      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      const radius = settings.CAMPFIRE_HITBOX_RADIUS || 90;
      if (!circlesOverlap(zone.cx, zone.cy, zone.radius, cx, cy, radius)) {
        continue;
      }

      const oldHp = cell.campfire.hp;
      cell.campfire.hp = Math.max(0, cell.campfire.hp - getObjectAttackDamage(source, cell.campfire.ownerId, players.find(p=>p.id===cell.campfire.ownerId)));
      const destroyed = cell.campfire.hp <= 0;

      const dx = cx - source.x;
      const dy = cy - source.y;
      const dist = Math.hypot(dx, dy) || 1;
      const knockDx = (dx / dist) * settings.NATURE_HIT_KNOCKBACK;
      const knockDy = (dy / dist) * settings.NATURE_HIT_KNOCKBACK;

      if (destroyed) {
        removeCampfire(cell);
        // сбрасываем состояние горения, топливо и очередь
        // но это уже делает removeCampfire
      }

      hits.push({
        cell,
        oldHp,
        destroyed,
        knockDx,
        knockDy,
        natureTypeBefore: 'campfire', // для частиц
      });
      continue;
    }

    // ---- Верстак ----
    if (cell.workbench) {
      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      if (!circleOverlapsObject(zone.cx, zone.cy, zone.radius, cx, cy, cell.workbench)) continue;

      const oldHp = cell.workbench.hp;
      cell.workbench.hp = Math.max(0, cell.workbench.hp - getObjectAttackDamage(source, cell.workbench.ownerId, players.find(p=>p.id===cell.workbench.ownerId)));
      const destroyed = cell.workbench.hp <= 0;
      const dx = cx - source.x;
      const dy = cy - source.y;
      const dist = Math.hypot(dx, dy) || 1;
      const knockDx = (dx / dist) * settings.NATURE_HIT_KNOCKBACK;
      const knockDy = (dy / dist) * settings.NATURE_HIT_KNOCKBACK;
      const destroyedWorkbench = destroyed ? removeWorkbench(cell) : null;

      hits.push({
        cell, oldHp, destroyed, knockDx, knockDy,
        natureTypeBefore: 'workbench', destroyedWorkbench,
      });
    }
  }

  return hits;
}

/**
 * Поиск саженцев, попавших в зону атаки (для отдельной обработки).
 */
export function resolveSaplingAttackTargets(attacker, cellsList) {
  if (!attacker.isAlive || !attacker.inGame) return [];

  const source = getAttackSnapshot(attacker);
  const zone = getAttackZone(source);
  const searchRadius =
    Math.max(
      settings.ATTACK_ZONE_DISTANCE + settings.ATTACK_ZONE_RADIUS,
      ...( ["hatchet", "pickaxe_stone", "hammer"].map((tool) => { const p = getToolProfile(tool); return p.zoneDistance + p.zoneRadius; }) )
    ) + settings.DEFAULT_OBJECT_RADIUS;
  const cells = cellsList.getNearbyAttackableCells(source.x, source.y, searchRadius);
  const hits = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const s = cell.sapling;
    if (!s?.kind || s.hp <= 0) continue;

    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    if (
      !circlesOverlap(
        zone.cx,
        zone.cy,
        zone.radius,
        cx,
        cy,
        s.hitboxRadius ?? settings.SAPLING_HITBOX_RADIUS ?? 48
      )
    ) {
      continue;
    }

    hits.push(cell);
  }

  return hits;
}