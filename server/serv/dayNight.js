import settings from "./settings.js";

let isNight = false;
let phaseStartedAt = Date.now();

export function getDayNightState() {
  const phaseMs = settings.DAY_NIGHT_PHASE_MS ?? 60_000;
  return {
    isNight,
    phaseMs,
    phaseStartedAt,
    phaseEndsAt: phaseStartedAt + phaseMs,
  };
}

export function toggleDayNight() {
  isNight = !isNight;
  phaseStartedAt = Date.now();
  return getDayNightState();
}

export function broadcastDayNight(wsHub, players) {
  const state = getDayNightState();
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player.inGame) continue;
    wsHub.sendToClientId(player.id, "dayNightUpdate", state);
  }
}

export function startDayNightCycle(wsHub, getPlayers) {
  const phaseMs = settings.DAY_NIGHT_PHASE_MS ?? 60_000;
  setInterval(() => {
    const state = toggleDayNight();
    console.log(`[dayNight] ${state.isNight ? "night" : "day"}`);
    broadcastDayNight(wsHub, getPlayers());
  }, phaseMs);
}