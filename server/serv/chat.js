import settings from "./settings.js";

export class ChatHistory {
  constructor() {
    this.messages = [];
    this.nextId = 1;
  }

  add(name, text, playerId) {
    const message = {
      id: this.nextId++,
      name: name || "",
      text,
      playerId: playerId ?? null,
      at: Date.now(),
    };

    this.messages.push(message);

    while (this.messages.length > settings.CHAT_MAX_MESSAGES) {
      this.messages.shift();
    }

    return message;
  }

  getAll() {
    return this.messages;
  }
}

export function sendChatHistory(wsHub, clientId, chatHistory) {
  wsHub.sendToClientId(clientId, "chatHistory", {
    messages: chatHistory.getAll(),
  });
}

export function broadcastChatMessage(wsHub, players, message) {
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player.inGame) continue;
    wsHub.sendToClientId(player.id, "chatMessage", message);
  }
}