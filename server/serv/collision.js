import settings from "./settings.js";
import { getNatureHitboxRadius } from "./natureObjects.js";

export function getMapBounds(radius) {
  const mapSize = settings.MAP_SIDE_LENGTH * settings.CELL_SIDE_LENGTH_PIXEL;
  return { minX: radius, minY: radius, maxX: mapSize - radius, maxY: mapSize - radius };
}

export function clampToMap(x, y, radius) {
  const bounds = getMapBounds(radius);
  return { x: Math.max(bounds.minX, Math.min(bounds.maxX, x)), y: Math.max(bounds.minY, Math.min(bounds.maxY, y)) };
}

function resolveCircleCollision(px, py, pr, ox, oy, or, allowInside = false) {
  if (allowInside) return { x: px, y: py };
  const dx = px - ox, dy = py - oy;
  const distSq = dx * dx + dy * dy;
  const minDist = pr + or;
  if (distSq >= minDist * minDist) return { x: px, y: py };
  if (distSq === 0) return { x: px + minDist, y: py };
  const dist = Math.sqrt(distSq), overlap = minDist - dist;
  return { x: px + (dx / dist) * overlap, y: py + (dy / dist) * overlap };
}

function rectLocalPoint(px, py, obstacle) {
  const ox = obstacle.cx, oy = obstacle.cy;
  const angle = Number(obstacle.rotation ?? 0);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = px - ox, dy = py - oy;
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
    cos,
    sin,
  };
}

function resolveCircleRectCollision(px, py, pr, obstacle) {
  if (obstacle.allowInside) return { x: px, y: py };
  const { x: lx, y: ly, cos, sin } = rectLocalPoint(px, py, obstacle);
  const hw = obstacle.width / 2, hh = obstacle.height / 2;
  const nx = Math.max(-hw, Math.min(hw, lx));
  const ny = Math.max(-hh, Math.min(hh, ly));
  const qx = lx - nx, qy = ly - ny;
  const distSq = qx * qx + qy * qy;

  if (distSq > 0 && distSq >= pr * pr) return { x: px, y: py };

  let localX = lx, localY = ly;
  if (distSq > 0) {
    const dist = Math.sqrt(distSq);
    const push = pr - dist;
    localX += (qx / dist) * push;
    localY += (qy / dist) * push;
  } else {
    const candidates = [
      { d: Math.abs(lx + hw), x: -hw - pr, y: localY },
      { d: Math.abs(hw - lx), x: hw + pr, y: localY },
      { d: Math.abs(ly + hh), x: localX, y: -hh - pr },
      { d: Math.abs(hh - ly), x: localX, y: hh + pr },
    ];
    const best = candidates.reduce((a, b) => b.d < a.d ? b : a);
    localX = best.x;
    localY = best.y;
  }

  return {
    x: obstacle.cx + localX * cos - localY * sin,
    y: obstacle.cy + localX * sin + localY * cos,
  };
}

export function circleIntersectsObstacle(cx, cy, radius, obstacle) {
  if (obstacle?.allowInside) return true;
  if (obstacle?.shape === "rect") {
    const { x: lx, y: ly } = rectLocalPoint(cx, cy, obstacle);
    const hw = obstacle.width / 2, hh = obstacle.height / 2;
    const nx = Math.max(-hw, Math.min(hw, lx));
    const ny = Math.max(-hh, Math.min(hh, ly));
    return Math.hypot(lx - nx, ly - ny) <= radius;
  }
  return Math.hypot(cx - obstacle.cx, cy - obstacle.cy) <= radius + (obstacle.radius ?? 0);
}

// Swept collision for a circular projectile/player against one static obstacle.
// Returns the first normalized time t in [0,1], or null when the whole segment is clear.
export function sweepCircleObstacle(x1, y1, x2, y2, radius, obstacle) {
  if (!obstacle || obstacle.allowProjectilePass) return null;
  if (obstacle.shape === "circle" || obstacle.shape == null || obstacle.shape !== "rect") {
    const rr = radius + (obstacle.radius ?? 0);
    const sx = x1 - obstacle.cx, sy = y1 - obstacle.cy;
    const dx = x2 - x1, dy = y2 - y1;
    const a = dx * dx + dy * dy;
    if (a <= 1e-12) return Math.hypot(sx, sy) <= rr ? 0 : null;
    const b = 2 * (sx * dx + sy * dy);
    const c = sx * sx + sy * sy - rr * rr;
    if (c <= 0) return 0;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const t = (-b - root) / (2 * a);
    if (t >= 0 && t <= 1) return t;
    return null;
  }

  const { x: sx, y: sy, cos, sin } = rectLocalPoint(x1, y1, obstacle);
  const end = rectLocalPoint(x2, y2, obstacle);
  const dx = end.x - sx, dy = end.y - sy;
  const minX = -obstacle.width / 2 - radius;
  const maxX = obstacle.width / 2 + radius;
  const minY = -obstacle.height / 2 - radius;
  const maxY = obstacle.height / 2 + radius;

  // Conservative expanded-rectangle sweep. This is exact for the square/rect
  // blockers used by the game and prevents tunnelling through them between ticks.
  let tMin = 0, tMax = 1;
  for (const [p, d, min, max] of [[sx, dx, minX, maxX], [sy, dy, minY, maxY]]) {
    if (Math.abs(d) < 1e-12) {
      if (p < min || p > max) return null;
      continue;
    }
    let t1 = (min - p) / d;
    let t2 = (max - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin >= 0 && tMin <= 1 ? tMin : null;
}

export function findFirstObstacleOnSegment(x1, y1, x2, y2, radius, obstacles) {
  let best = null;
  for (const obstacle of obstacles ?? []) {
    if (!obstacle || obstacle.allowProjectilePass) continue;
    const t = sweepCircleObstacle(x1, y1, x2, y2, radius, obstacle);
    if (t == null || (best && t >= best.t)) continue;
    best = { t, obstacle };
  }
  return best;
}

export function moveWithCollisions(x, y, radius, dx, dy, obstacles) {
  const maxStep = Math.max(8, Math.min(24, radius * 0.35));
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const stepDx = dx / steps;
  const stepDy = dy / steps;

  const resolveAll = (cx, cy) => {
    for (const obstacle of obstacles ?? []) {
      if (obstacle?.allowInside) continue;
      const resolved = obstacle?.shape === "rect"
        ? resolveCircleRectCollision(cx, cy, radius, obstacle)
        : resolveCircleCollision(cx, cy, radius, obstacle.cx, obstacle.cy, obstacle.radius, false);
      cx = resolved.x;
      cy = resolved.y;
    }
    return clampToMap(cx, cy, radius);
  };

  let newX = x;
  let newY = y;

  for (let i = 0; i < steps; i++) {
    let pos = resolveAll(newX + stepDx, newY);
    newX = pos.x;
    newY = pos.y;

    pos = resolveAll(newX, newY + stepDy);
    newX = pos.x;
    newY = pos.y;
  }

  for (let i = 0; i < 3; i++) {
    const pos = resolveAll(newX, newY);
    newX = pos.x;
    newY = pos.y;
  }

  return { x:newX, y:newY };
}

export function getObjectHitboxRadius(natureType) {
  return getNatureHitboxRadius(natureType);
}