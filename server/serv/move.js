import settings from "./settings.js";
import { moveWithCollisions } from "./collision.js";
import { isPlayerCrafting } from "./craftQueue.js";

function getMovementDelta(player, deltaTime) {
  let dx = 0;
  let dy = 0;

  let speedMultiplier = player.sprinting ? settings.SPRINT_MULTIPLIER : 1;
  if (isPlayerCrafting(player)) {
    speedMultiplier *= settings.CRAFT_SPEED_MULT ?? 0.8;
  }

  if (player.spearState === 'equipping' || player.spearState === 'windup') {
    speedMultiplier *= settings.SPEAR_SLOW_FACTOR;
  }
  
  const distanceToMove = player.speed * speedMultiplier * (deltaTime / 20);

  if (player.vector.includes("up")) dy -= 1;
  if (player.vector.includes("down")) dy += 1;
  if (player.vector.includes("right")) dx += 1;
  if (player.vector.includes("left")) dx -= 1;

  if (dx !== 0 || dy !== 0) {
    const length = Math.hypot(dx, dy);
    dx = (dx / length) * distanceToMove;
    dy = (dy / length) * distanceToMove;
  }

  return { dx, dy };
}

function getPlayerObstacles(application, currentPlayer) {
  const obstacles = [];

  for (let i = 0; i < application.playersList.list.length; i++) {
    const other = application.playersList.list[i];
    if (
      other.id === currentPlayer.id ||
      !other.isAlive ||
      !other.inGame
    ) {
      continue;
    }

    obstacles.push({
      cx: other.x,
      cy: other.y,
      radius: other.hitboxRadius,
    });
  }

  return obstacles;
}

export function move(application, deltaMs = 1000 / 60) {
  const deltaTime = Math.max(0, Math.min(250, Number(deltaMs) || 0));

  for (let i = 0; i < application.playersList.list.length; i++) {
    const player = application.playersList.list[i];
    if (!player.isAlive || !player.inGame) {
      continue;
    }

    if (player.sprinting && (player.energy ?? settings.MAX_ENERGY ?? 300) <= 0) {
      player.sprinting = false;
    }

    const { dx, dy } = getMovementDelta(player, deltaTime);

    if (dx === 0 && dy === 0) {
      continue;
    }

    if (player.sprinting) {
      const drain = (settings.SPRINT_ENERGY_PER_SEC ?? 50) * (deltaTime / 1000);
      player.energy = Math.max(0, (player.energy ?? settings.MAX_ENERGY ?? 300) - drain);
      player.energyRegenReadyAt = performance.now() + (settings.ENERGY_REGEN_DELAY_MS ?? 7000);
      player._energyDirty = true;
      if (player.energy <= 0) player.sprinting = false;
    }

    const searchRadius =
      player.hitboxRadius +
      settings.DEFAULT_OBJECT_RADIUS +
      Math.abs(dx) +
      Math.abs(dy);

    const obstacles = [
      ...application.cellsList.getNearbyObstacles(
        player.x,
        player.y,
        searchRadius
      ),
      ...getPlayerObstacles(application, player),
    ];

    const nextPosition = moveWithCollisions(
      player.x,
      player.y,
      player.hitboxRadius,
      dx,
      dy,
      obstacles
    );

    player.x = nextPosition.x;
    player.y = nextPosition.y;
  }

}


