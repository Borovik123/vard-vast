import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import { CellsList } from "./map.js";
import settings from "./settings.js";
import { PlayersList } from "./players.js";
import { createWsHub } from "./wsHub.js";
import { CorpsesList } from "./corpses.js";
import { ChatHistory } from "./chat.js";
import { getDayNightState, startDayNightCycle } from "./dayNight.js";
import { broadcastLeaderboard } from "./leaderboard.js";
import { spawnGroundItemsOnMap } from "./groundItems.js";
import { createSpearSystem } from "./spear.js";
import { createDeathSystem } from "./deathSystem.js";
import { createWsHandlers } from "./wsHandlers.js";
import { createGameLoop } from "./gameLoop.js";
import { createClanSystem } from "./clans.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const wsHub = createWsHub(server);
const publicDir = path.resolve(__dirname, "../../client/public");

app.use(express.static(publicDir));
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.post("/api/", (req, res) => res.json({ success: true }));

class Application {
  constructor() {
    this.playersList = new PlayersList();
    this.cellsList = new CellsList();
    this.corpsesList = new CorpsesList();
    this.chatHistory = new ChatHistory();
  }
}

export const application = new Application();
export const clanSystem = createClanSystem({ players: application.playersList.list, wsHub });

const deathSystem = createDeathSystem({
  wsHub,
  clanSystem,
  players: application.playersList.list,
  cellsList: application.cellsList,
  corpseList: application.corpsesList,
});

const spearSystem = createSpearSystem({
  application,
  wsHub,
  onPlayerDeath: deathSystem.handlePlayerDeath,
});

createWsHandlers({ application, wsHub, spearSystem, deathSystem, clanSystem });

const gameLoop = createGameLoop({ application, wsHub, deathSystem, spearSystem });
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Express web app on");
  application.cellsList.addParams();
  application.cellsList.addNatureObjects();
  const initialGround = spawnGroundItemsOnMap(application.cellsList.list);
  console.log("[ground] initial spawn:", initialGround.length);
  gameLoop.start();
  gameLoop.startGroundTimers();
  setInterval(() => broadcastLeaderboard(wsHub, application.playersList.list), settings.LEADERBOARD_UPDATE_MS);
  startDayNightCycle(wsHub, () => application.playersList.list);
});

export { gameLoop, wsHub, getDayNightState };