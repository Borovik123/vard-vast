/*
 * Clan / minimap client UI.
 * Owns clan state, clan DOM input, clan/minimap rendering and their pointer UI.
 * It intentionally does NOT handle craft, inventory, combat or general mouse input.
 */
(function (global) {
    "use strict";
  
    let socket = null;
    let canvas = null;
    let ctx = null;
    let application = null;
    let getSettings = () => undefined;
  
    let clanPanelOpen = false;
    let miniMapOpen = false;
    let clanState = { clan: null, available: [], requestCooldownMs: 0 };
    let clanJoinRequest = null;
    let clanMapMembers = [];
    const clanTagsByPlayerId = new Map();
    let clanInput = null;
    let initialized = false;
  
    function pointInRect(x, y, r) {
      return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }
  
    function getPointer(event) {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width > 0 ? canvas.width / rect.width : 1;
      const sy = rect.height > 0 ? canvas.height / rect.height : 1;
      return {
        x: (event.clientX - rect.left) * sx,
        y: (event.clientY - rect.top) * sy,
      };
    }
  
    function alive() {
      return application?.myPlayer?.isAlive !== false;
    }
  
    function getClanButtonRect() {
      return { x: 92, y: 16, w: 64, h: 64 };
    }
  
    function getMiniMapButtonRect() {
      return { x: 164, y: 16, w: 64, h: 64 };
    }
  
    function getClanPanelRect() {
      const w = Math.min(430, Math.max(340, canvas.width * 0.34));
      const h = Math.min(500, Math.max(390, canvas.height * 0.62));
      return {
        x: Math.round((canvas.width - w) / 2),
        y: Math.round((canvas.height - h) / 2),
        w,
        h,
      };
    }
  
    function createInput() {
      if (clanInput) return;
      clanInput = document.createElement("input");
      clanInput.type = "text";
      clanInput.maxLength = 5;
      clanInput.autocomplete = "off";
      clanInput.inputMode = "text";
      clanInput.spellcheck = false;
      clanInput.setAttribute("aria-label", "Название клана");
      clanInput.style.cssText =
        "position:fixed;z-index:1000;display:none;width:150px;height:34px;" +
        "background:rgba(20,20,20,.90);color:white;border:1px solid #777;" +
        "border-radius:6px;padding:4px 8px;font:bold 18px Verdana;" +
        "text-transform:uppercase;box-sizing:border-box;outline:none;";
  
      clanInput.addEventListener("input", () => {
        // Digits are deliberately allowed: A-Z and 0-9, max 5 characters.
        const value = String(clanInput.value || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 5);
        if (clanInput.value !== value) clanInput.value = value;
      });
  
      clanInput.addEventListener("keydown", (event) => {
        // Prevent the game's global hotkeys from seeing clan-name input.
        event.stopPropagation();
      });
  
      document.body.appendChild(clanInput);
    }
  
    function positionInput() {
      if (!clanInput || !canvas) return;
      const p = getClanPanelRect();
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / canvas.width || 1;
      const sy = rect.height / canvas.height || 1;
      const inputX = rect.left + (p.x + 22) * sx;
      const inputY = rect.top + (p.y + 58) * sy;
      clanInput.style.left = `${inputX}px`;
      clanInput.style.top = `${inputY}px`;
      clanInput.style.width = `${Math.max(150, (p.w - 140) * sx)}px`;
      clanInput.style.height = `${36 * sy}px`;
      clanInput.style.display =
        clanPanelOpen && !clanState.clan && alive() ? "block" : "none";
    }
  
    function drawTopButton(rect, label, active) {
      ctx.save();
      ctx.fillStyle = active ? "rgba(45,82,82,.90)" : "rgba(18,20,20,.84)";
      ctx.strokeStyle = active
        ? "rgba(115,225,210,.80)"
        : "rgba(180,210,205,.38)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? "#b8fff1" : "#e5eeee";
      ctx.font = "bold 12px Verdana";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
      ctx.restore();
    }
  
    function drawClanButton() {
      if (!alive()) return;
      drawTopButton(getClanButtonRect(), "CLAN", clanPanelOpen);
    }
  
    function drawMiniMapButton() {
      if (!alive()) return;
      drawTopButton(getMiniMapButtonRect(), "MAP", miniMapOpen);
    }
  
    function drawClanPanel() {
      if (!clanPanelOpen || !alive()) return;
      const p = getClanPanelRect();
      positionInput();
  
      ctx.save();
      ctx.fillStyle = "rgba(13,17,17,.94)";
      ctx.strokeStyle = "rgba(150,205,198,.42)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, 12);
      ctx.fill();
      ctx.stroke();
  
      ctx.fillStyle = "#e9f7f4";
      ctx.font = "bold 22px Verdana";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("КЛАН", p.x + p.w / 2, p.y + 28);
  
      ctx.strokeStyle = "rgba(150,205,198,.18)";
      ctx.beginPath();
      ctx.moveTo(p.x + 18, p.y + 48);
      ctx.lineTo(p.x + p.w - 18, p.y + 48);
      ctx.stroke();
  
      if (clanState.clan) {
        const c = clanState.clan;
        const owner = c.ownerId === socket.id;
        const members = Array.isArray(c.members) ? c.members : [];
  
        ctx.fillStyle = "#b8fff1";
        ctx.font = "bold 21px Verdana";
        ctx.fillText(c.name, p.x + p.w / 2, p.y + 78);
  
        ctx.fillStyle = "rgba(215,235,232,.72)";
        ctx.font = "12px Verdana";
        ctx.fillText(`${members.length}/9 участников`, p.x + p.w / 2, p.y + 102);
  
        ctx.textAlign = "left";
        ctx.font = "15px Verdana";
        members.forEach((m, i) => {
          const rowY = p.y + 138 + i * 30;
          ctx.fillStyle = m.id === socket.id ? "#b8fff1" : "#e1e9e8";
          ctx.fillText(m.name || "Игрок", p.x + 24, rowY);
          if (owner && m.id !== socket.id) {
            ctx.fillStyle = "rgba(255,105,105,.9)";
            ctx.font = "bold 20px Verdana";
            ctx.textAlign = "center";
            ctx.fillText("×", p.x + p.w - 28, rowY - 2);
            ctx.textAlign = "left";
            ctx.font = "15px Verdana";
          }
        });
  
        const action = { x: p.x + 20, y: p.y + p.h - 52, w: p.w - 40, h: 34 };
        ctx.fillStyle = owner ? "rgba(125,45,45,.65)" : "rgba(55,75,75,.8)";
        ctx.strokeStyle = owner ? "rgba(255,120,120,.5)" : "rgba(150,205,198,.35)";
        ctx.beginPath();
        ctx.roundRect(action.x, action.y, action.w, action.h, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#f0f5f4";
        ctx.font = "bold 13px Verdana";
        ctx.textAlign = "center";
        ctx.fillText(owner ? "УДАЛИТЬ КЛАН" : "ПОКИНУТЬ КЛАН", action.x + action.w / 2, action.y + action.h / 2);
      } else {
        ctx.textAlign = "left";
        ctx.fillStyle = "#bfcfcd";
        ctx.font = "12px Verdana";
        ctx.fillText("Название клана", p.x + 22, p.y + 57);
  
        const create = { x: p.x + p.w - 112, y: p.y + 58, w: 90, h: 36 };
        const value = String(clanInput?.value || "").toUpperCase();
        const valid = /^[A-Z0-9]{1,5}$/.test(value);
        const atLimit = Array.isArray(clanState.available) && clanState.available.length >= 9 && false;
        ctx.fillStyle = valid && !atLimit ? "#b8fff1" : "#7d8b89";
        ctx.font = "bold 13px Verdana";
        ctx.textAlign = "center";
        ctx.fillText("СОЗДАТЬ", create.x + create.w / 2, create.y + create.h / 2);
  
        ctx.fillStyle = "#dce8e6";
        ctx.font = "bold 14px Verdana";
        ctx.textAlign = "left";
        ctx.fillText("Доступные кланы", p.x + 22, p.y + 125);
  
        const available = Array.isArray(clanState.available) ? clanState.available : [];
        if (!available.length) {
          ctx.fillStyle = "rgba(210,225,222,.55)";
          ctx.font = "13px Verdana";
          ctx.fillText("Нет доступных кланов", p.x + 22, p.y + 155);
        } else {
          available.forEach((c, i) => {
            const rowY = p.y + 158 + i * 34;
            ctx.fillStyle = "#e1e9e8";
            ctx.font = "15px Verdana";
            ctx.fillText(`${c.name}  ${c.members}/9`, p.x + 22, rowY);
            const disabled = !!c.full || Number(clanState.requestCooldownMs || 0) > 0;
            ctx.fillStyle = disabled ? "rgba(150,160,158,.45)" : "#9fe8dc";
            ctx.textAlign = "right";
            ctx.font = "bold 12px Verdana";
            ctx.fillText(c.full ? "ПОЛОН" : disabled ? "ПОДОЖДИТЕ" : "ВСТУПИТЬ", p.x + p.w - 22, rowY);
            ctx.textAlign = "left";
          });
        }
      }
  
      ctx.restore();
    }
  
    function drawRequest() {
      if (!clanJoinRequest || !clanState.clan || clanState.clan.ownerId !== socket.id || !alive()) return;
      const bw = 360, bh = 90, bx = (canvas.width - bw) / 2, by = 15;
      ctx.save();
      ctx.fillStyle = "rgba(10,10,10,.92)";
      ctx.strokeStyle = "rgba(150,205,198,.45)";
      ctx.lineWidth = 1.2;
      ctx.roundRect(bx, by, bw, bh, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.font = "bold 16px Verdana";
      ctx.fillText(`${clanJoinRequest.playerName} хочет вступить`, bx + bw / 2, by + 25);
      ctx.font = "14px Verdana";
      ctx.fillText("ПРИНЯТЬ", bx + bw * .25, by + 62);
      ctx.fillText("ОТКЛОНИТЬ", bx + bw * .75, by + 62);
      ctx.restore();
    }
  
    function drawMiniMap() {
      if (!miniMapOpen || !alive()) return;
  
      const size = Math.min(210, canvas.width * 0.26, canvas.height * 0.32);
      const x = 16;
      const y = 90;
      const cell = size / 6;
  
      ctx.save();
      ctx.fillStyle = "rgba(8,13,13,.90)";
      ctx.strokeStyle = "rgba(140,205,196,.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, 9);
      ctx.fill();
      ctx.stroke();
  
      ctx.strokeStyle = "rgba(125,205,195,.25)";
      for (let i = 1; i < 6; i++) {
        ctx.beginPath(); ctx.moveTo(x + i * cell, y); ctx.lineTo(x + i * cell, y + size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y + i * cell); ctx.lineTo(x + size, y + i * cell); ctx.stroke();
      }
  
      ctx.fillStyle = "rgba(125,225,210,.55)";
      ctx.font = "10px Verdana";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 6; col++) {
          ctx.fillText(`${String.fromCharCode(65 + row)}${col + 1}`, x + col * cell + 5, y + row * cell + 5);
        }
      }
  
      const cfg = getSettings()?.settings ?? {};
      const worldW = Math.max(1, Number(cfg.MAP_SIDE_LENGTH ?? 100) * Number(cfg.CELL_SIDE_LENGTH_PIXEL ?? 200));
      const worldH = worldW;
      const marker = (px, py, fill, radius) => {
        const nx = Math.max(0, Math.min(1, Number(px) / worldW));
        const ny = Math.max(0, Math.min(1, Number(py) / worldH));
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(x + nx * size, y + ny * size, radius, 0, Math.PI * 2);
        ctx.fill();
      };
  
      const me = application.myPlayer;
      if (me) marker(me.x, me.y, "#ffffff", 5);
      for (const member of clanMapMembers) {
        if (member.id === socket.id) continue;
        marker(member.x, member.y, "#55d6ff", 4);
      }
      ctx.restore();
    }
  
    function handlePointerDown(event) {
      if (!initialized || !alive() || event.button !== 0) return false;
      const { x, y } = getPointer(event);
      const cb = getClanButtonRect();
      const mb = getMiniMapButtonRect();
  
      if (pointInRect(x, y, cb)) {
        clanPanelOpen = !clanPanelOpen;
        if (clanPanelOpen) {
          miniMapOpen = false;
          positionInput();
          if (!clanState.clan) setTimeout(() => clanInput?.focus(), 0);
        } else if (clanInput) {
          clanInput.style.display = "none";
          clanInput.blur();
        }
        return true;
      }
  
      if (pointInRect(x, y, mb)) {
        miniMapOpen = !miniMapOpen;
        if (miniMapOpen) clanPanelOpen = false;
        if (clanInput) clanInput.style.display = "none";
        return true;
      }
  
      if (clanJoinRequest && clanState.clan?.ownerId === socket.id) {
        const bw = 360, bh = 90, bx = (canvas.width - bw) / 2, by = 15;
        if (pointInRect(x, y, { x: bx, y: by, w: bw, h: bh })) {
          if (x < bx + bw / 2) socket.emit("clanAccept", {});
          else socket.emit("clanReject", {});
          clanJoinRequest = null;
          return true;
        }
      }
  
      if (!clanPanelOpen) return false;
  
      const p = getClanPanelRect();
      if (!pointInRect(x, y, p)) {
        closePanel();
        return true;
      }
  
      if (!clanState.clan) {
        const create = { x: p.x + p.w - 112, y: p.y + 58, w: 90, h: 36 };
        if (pointInRect(x, y, create)) {
          const name = String(clanInput?.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
          if (/^[A-Z0-9]{1,5}$/.test(name)) socket.emit("clanCreate", { name });
          return true;
        }
  
        const rows = Array.isArray(clanState.available) ? clanState.available : [];
        for (let i = 0; i < rows.length; i++) {
          const c = rows[i];
          const rowY = p.y + 158 + i * 34;
          const joinRect = { x: p.x + p.w - 110, y: rowY - 20, w: 90, h: 28 };
          const disabled = !!c.full || Number(clanState.requestCooldownMs || 0) > 0;
          if (!disabled && pointInRect(x, y, joinRect)) {
            socket.emit("clanRequest", { clanId: c.id });
            return true;
          }
        }
        return true;
      }
  
      const c = clanState.clan;
      const owner = c.ownerId === socket.id;
      const members = Array.isArray(c.members) ? c.members : [];
  
      if (owner) {
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          if (m.id === socket.id) continue;
          const kickRect = { x: p.x + p.w - 52, y: p.y + 118 + i * 30, w: 40, h: 28 };
          if (pointInRect(x, y, kickRect)) {
            socket.emit("clanKick", { memberId: m.id });
            return true;
          }
        }
      }
  
      const action = { x: p.x + 20, y: p.y + p.h - 52, w: p.w - 40, h: 34 };
      if (pointInRect(x, y, action)) {
        socket.emit(owner ? "clanDelete" : "clanLeave", {});
        // The server's clanState is authoritative; close the panel immediately
        // so the old member list cannot be mistaken for the current state.
        closePanel();
        return true;
      }
      return true;
    }
  
    function closePanel() {
      clanPanelOpen = false;
      if (clanInput) {
        clanInput.style.display = "none";
        clanInput.blur();
      }
    }
  
    function closeAll() {
      closePanel();
      miniMapOpen = false;
    }
  
    function reset() {
      closeAll();
      clanJoinRequest = null;
      clanMapMembers = [];
      clanState = { clan: null, available: [], requestCooldownMs: 0 };
      clanTagsByPlayerId.clear();
    }
  
    function applyClanState(data) {
      const previousMembers = Array.isArray(clanState?.clan?.members) ? clanState.clan.members : [];
      clanState = data ?? { clan: null, available: [], requestCooldownMs: 0 };

      // Remove tags belonging to the previous clan when the player leaves or
      // the clan is destroyed. Otherwise stale [TAG] labels survive forever.
      if (!clanState.clan) {
        for (const member of previousMembers) {
          if (member?.id) clanTagsByPlayerId.delete(member.id);
          const p = application?.playersList?.list?.find((x) => x.id === member?.id);
          if (p) p.clanName = null;
        }
        if (socket?.id) clanTagsByPlayerId.delete(socket.id);
        if (application?.myPlayer) application.myPlayer.clanName = null;
        clanMapMembers = [];
        closePanelIfNoClan();
        return;
      }

      const clanName = clanState.clan.name || null;
      const currentIds = new Set((clanState.clan.members || []).map((m) => m?.id).filter(Boolean));

      // Clear stale members from the old clan, then apply the authoritative list.
      for (const member of previousMembers) {
        if (member?.id && !currentIds.has(member.id)) {
          clanTagsByPlayerId.delete(member.id);
          const p = application?.playersList?.list?.find((x) => x.id === member.id);
          if (p) p.clanName = null;
        }
      }

      for (const member of clanState.clan.members || []) {
        if (!member?.id) continue;
        clanTagsByPlayerId.set(member.id, clanName);
        const p = application?.playersList?.list?.find((x) => x.id === member.id);
        if (p) p.clanName = clanName;
      }

      if (socket?.id && currentIds.has(socket.id)) clanTagsByPlayerId.set(socket.id, clanName);
      if (application?.myPlayer) application.myPlayer.clanName = currentIds.has(socket?.id) ? clanName : null;

      if (clanInput) clanInput.style.display = "none";
    }

    function closePanelIfNoClan() {
      clanPanelOpen = false;
      if (clanInput) {
        clanInput.style.display = "none";
        clanInput.blur();
      }
    }

    function applyPlayerClanUpdate(data) {
      if (!data?.playerId) return;
      const name = data.clanName || null;

      if (name) clanTagsByPlayerId.set(data.playerId, name);
      else clanTagsByPlayerId.delete(data.playerId);

      const p = application?.playersList?.list?.find((x) => x.id === data.playerId);
      if (p) p.clanName = name;
      if (data.playerId === socket?.id && application?.myPlayer) {
        application.myPlayer.clanName = name;
        if (!name) {
          clanMapMembers = [];
          closePanelIfNoClan();
        }
      }
    }

    function getPlayerDisplayName(player) {
      const clanName = clanTagsByPlayerId.has(player?.id)
        ? clanTagsByPlayerId.get(player.id)
        : (player?.clanName || null);
      return clanName ? `[${clanName}] ${player?.name || ""}` : (player?.name || "");
    }
  
    function init(deps) {
      if (initialized) return;
      socket = deps.socket;
      canvas = deps.canvas;
      ctx = deps.ctx;
      application = deps.application;
      getSettings = deps.getSettings || (() => undefined);
      createInput();
  
      socket.on("clanState", applyClanState);
      socket.on("clanPlayerUpdate", applyPlayerClanUpdate);
      socket.on("clanJoinRequest", (data) => { clanJoinRequest = data || null; });
      socket.on("clanMapUpdate", (data) => {
        clanMapMembers = Array.isArray(data?.members) ? data.members : [];
      });
  
      initialized = true;
    }
  
    global.ClanUI = {
      init,
      draw() {
        if (!initialized) return;
        drawClanButton();
        drawMiniMapButton();
        drawClanPanel();
        drawMiniMap();
        drawRequest();
        positionInput();
      },
      handlePointerDown,
      closeAll,
      reset,
      isInputFocused: () => document.activeElement === clanInput,
      getPlayerDisplayName,
    };
  })(window);