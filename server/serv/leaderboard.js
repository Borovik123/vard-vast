import settings from "./settings.js";

/**
 * Score for harvested resources that actually entered the inventory.
 * wood  → amount * SCORE_WOOD_PER_UNIT
 * stone → amount * SCORE_STONE_PER_UNIT
 */
export function scoreForHarvest(itemId, amount) {
  if (!amount || amount <= 0) return 0;
  if (itemId === "wood") return amount * (settings.SCORE_WOOD_PER_UNIT ?? 1);
  if (itemId === "stone") return amount * (settings.SCORE_STONE_PER_UNIT ?? 2);
  if (itemId === "blueberry" || itemId === "wildberry") {
    return amount * (settings.SCORE_BERRY_PER_UNIT ?? 10);
  }
  return 0;
}

/**
 * Level progress from lifetime score.
 * 0→1 needs XP_BASE (100). Each next level needs XP_GROWTH (1.2×) more.
 * Bar fills within the current level only (resets on level-up).
 */
export function getLevelProgress(totalScore) {
  let remaining = Math.max(0, Number(totalScore) || 0);
  let level = 0;
  const base = settings.XP_BASE ?? 100;
  const growth = settings.XP_GROWTH ?? 1.2;
  let need = base;

  while (remaining >= need) {
    remaining -= need;
    level += 1;
    need = base * Math.pow(growth, level);
  }

  return {
    level,
    xp: remaining,
    xpNeed: need,
    ratio: need > 0 ? remaining / need : 0,
  };
}

export function sendScoreUpdate(wsHub, player) {
  if (!wsHub || !player?.id) return;
  const score = Math.floor(player.score ?? 0);
  const progress = getLevelProgress(score);
  wsHub.sendToClientId(player.id, "scoreUpdate", {
    score,
    level: progress.level,
    xp: progress.xp,
    xpNeed: progress.xpNeed,
  });
}

export function addPlayerScore(player, points, wsHub = null) {
  if (!player || !points) return;
  player.score = (player.score ?? 0) + points;
  if (wsHub) sendScoreUpdate(wsHub, player);
}

/** Killer gets SCORE_KILL_PERCENT of victim's score at death. */
export function awardKillScore(killer, victim, wsHub = null) {
  if (!killer || !victim || killer.id === victim.id) return 0;
  const victimScore = Math.floor(victim.score ?? 0);
  if (victimScore <= 0) return 0;
  const gained = Math.floor(victimScore * (settings.SCORE_KILL_PERCENT ?? 0.1));
  if (gained <= 0) return 0;
  addPlayerScore(killer, gained, wsHub);
  return gained;
}

export function addHarvestScore(player, itemId, amount, wsHub = null) {
  addPlayerScore(player, scoreForHarvest(itemId, amount), wsHub);
}

export function resetPlayerScore(player, wsHub = null) {
  if (!player) return;
  player.score = 0;
  if (wsHub) sendScoreUpdate(wsHub, player);
}

/**
 * Top N alive in-game players by score (desc).
 * Places 11+ are omitted.
 * @returns {{ id: string, name: string, score: number }[]}
 */
export function getLeaderboardEntries(players, limit = settings.LEADERBOARD_SIZE) {
  return players
    .filter((p) => p.isAlive && p.inGame)
    .map((p) => ({
      id: p.id,
      name: p.name || "Player",
      score: Math.floor(p.score ?? 0),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function broadcastLeaderboard(wsHub, players) {
  const entries = getLeaderboardEntries(players);
  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (!observer.inGame) continue;
    wsHub.sendToClientId(observer.id, "leaderboardUpdate", { entries });
  }
}
