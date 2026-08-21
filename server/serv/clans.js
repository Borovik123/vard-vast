const NAME_RE = /^[A-Z0-9]{1,5}$/;
const MAX_CLANS = 9;
const MAX_MEMBERS = 9;
const REQUEST_TTL = 15_000;
const REQUEST_COOLDOWN = 60_000;

export function createClanSystem({ players, wsHub }) {
  const clans = new Map();
  let nextId = 1;

  function validName(name) { return typeof name === 'string' && NAME_RE.test(name); }
  function normalizeName(name) { return String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); }
  function getClanByPlayer(player) { return player?.clanId ? clans.get(player.clanId) ?? null : null; }
  function refreshNames(clan) { for (const id of clan.members) { const p=players.find(x=>x.id===id); if(p) p.clanName=clan.name; } }
  function serializeClan(clan) {
    return { id: clan.id, name: clan.name, ownerId: clan.ownerId, members: clan.members.map(id => { const p=players.find(x=>x.id===id); return { id, name:p?.name ?? 'Unknown', ownerId: clan.ownerId===id }; }) };
  }
  function sendState(player) {
    if (!player) return;
    const clan=getClanByPlayer(player);
    const available=[...clans.values()].map(c=>({id:c.id,name:c.name,members:c.members.length,full:c.members.length>=MAX_MEMBERS}));
    wsHub.sendToClientId(player.id,'clanState',{ clan: clan ? serializeClan(clan) : null, available, requestCooldownMs: Math.max(0,(player.clanRequestCooldownUntil??0)-performance.now()) });
  }
  function broadcastClan(clan) {
    if (!clan || !clans.has(clan.id)) return;

    refreshNames(clan);

    // Every member receives the complete authoritative member list.
    // Do not rely on incremental clanPlayerUpdate for the clan panel.
    for (const memberId of clan.members) {
      const member = players.find((p) => p?.id === memberId);
      if (member) sendState(member);
    }

    // Everyone who can currently render a player receives the tag state.
    // Send an event for EVERY member, never playerId:null.
    for (const memberId of clan.members) {
      const member = players.find((p) => p?.id === memberId);
      if (!member) continue;

      for (const observer of players) {
        if (!observer?.inGame) continue;
        wsHub.sendToClientId(observer.id, "clanPlayerUpdate", {
          playerId: member.id,
          clanName: clan.name,
        });
      }
    }

    broadcastAvailable();
  }

  function broadcastPlayerClanTag(player) {
    if (!player?.inGame) return;
    for (const observer of players) {
      if (observer?.inGame) wsHub.sendToClientId(observer.id, 'clanPlayerUpdate', { playerId: player.id, clanName: player.clanName || null });
    }
  }
  function broadcastAvailable() {
    const available=[...clans.values()].map(c=>({id:c.id,name:c.name,members:c.members.length,full:c.members.length>=MAX_MEMBERS}));
    for(const p of players){
      if(!p?.inGame || p.clanId) continue;
      wsHub.sendToClientId(p.id,'clanState',{clan:null,available,requestCooldownMs:Math.max(0,(p.clanRequestCooldownUntil??0)-performance.now())});
    }
  }
  function broadcastMap(clan) {
    const members=clan.members.map(id=>players.find(p=>p.id===id)).filter(p=>p?.inGame&&p.isAlive).map(p=>({id:p.id,x:p.x,y:p.y,name:p.name}));
    for(const id of clan.members) wsHub.sendToClientId(id,'clanMapUpdate',{members});
  }
  function destroyClan(clan) {
    if (!clan || !clans.has(clan.id)) return;

    const ids = [...clan.members];
    clans.delete(clan.id);

    for (const id of ids) {
      const p = players.find((x) => x?.id === id);
      if (!p) continue;
      p.clanId = null;
      p.clanName = null;
      wsHub.sendToClientId(p.id, "clanState", {
        clan: null,
        available: [...clans.values()].map((c) => ({
          id: c.id,
          name: c.name,
          members: c.members.length,
          full: c.members.length >= MAX_MEMBERS,
        })),
        requestCooldownMs: Math.max(0, (p.clanRequestCooldownUntil ?? 0) - performance.now()),
      });
      wsHub.sendToClientId(p.id, "clanPlayerUpdate", {
        playerId: id,
        clanName: null,
      });
      wsHub.sendToClientId(p.id, "clanMapUpdate", { members: [] });
    }

    // Explicitly clear stale tags on every observer for every former member.
    for (const observer of players) {
      if (!observer?.inGame) continue;
      for (const id of ids) {
        wsHub.sendToClientId(observer.id, "clanPlayerUpdate", {
          playerId: id,
          clanName: null,
        });
      }
    }

    broadcastAvailable();
  }

  function onOwnerGone(player) { const clan=getClanByPlayer(player); if(clan && clan.ownerId===player.id) destroyClan(clan); }
  function create(player, rawName) {
    const name=normalizeName(rawName); if(!validName(name)) return {ok:false,reason:'invalid-name'};
    if(player.clanId) return {ok:false,reason:'already-in-clan'};
    if(clans.size>=MAX_CLANS) return {ok:false,reason:'limit'};
    if([...clans.values()].some(c=>c.name===name)) return {ok:false,reason:'exists'};
    const clan={id:`clan_${nextId++}`,name,ownerId:player.id,members:[player.id],requests:[]}; clans.set(clan.id,clan); player.clanId=clan.id; player.clanName=name; broadcastClan(clan); return {ok:true};
  }
  function request(player, clanId) {
    if(player.clanId) return {ok:false,reason:'already-in-clan'};
    const now=performance.now(); if(now < (player.clanRequestCooldownUntil??0)) return {ok:false,reason:'cooldown'};
    const clan=clans.get(clanId); if(!clan) return {ok:false,reason:'not-found'};
    if(clan.members.length>=MAX_MEMBERS) return {ok:false,reason:'full'};
    clan.requests=clan.requests.filter(r=>r.expiresAt>now);
    if(clan.requests.some(r=>r.playerId===player.id)) return {ok:false,reason:'pending'};
    player.clanRequestCooldownUntil=now+REQUEST_COOLDOWN;
    clan.requests.push({playerId:player.id,expiresAt:now+REQUEST_TTL});
    notifyNext(clan); sendState(player); return {ok:true};
  }
  function notifyNext(clan){
    const now=performance.now(); clan.requests=clan.requests.filter(r=>r.expiresAt>now);
    const r=clan.requests[0]; const owner=players.find(p=>p.id===clan.ownerId); if(owner) wsHub.sendToClientId(owner.id,'clanJoinRequest',r?{clanId:clan.id,playerId:r.playerId,playerName:players.find(p=>p.id===r.playerId)?.name??'Unknown',expiresAt:r.expiresAt}:null);
  }
  function decide(player, accept) {
    const clan = getClanByPlayer(player);
    if (!clan || clan.ownerId !== player.id) return { ok: false };

    const now = performance.now();
    clan.requests = clan.requests.filter((r) => r.expiresAt > now);
    const request = clan.requests.shift();
    if (!request) {
      notifyNext(clan);
      return { ok: false, reason: "empty" };
    }

    const applicant = players.find((p) => p?.id === request.playerId);

    if (
      accept &&
      applicant &&
      !applicant.clanId &&
      clan.members.length < MAX_MEMBERS
    ) {
      applicant.clanId = clan.id;
      applicant.clanName = clan.name;
      if (!clan.members.includes(applicant.id)) clan.members.push(applicant.id);

      // The accepted player and owner must receive the full member list now.
      refreshNames(clan);
      sendState(applicant);
      sendState(player);
      broadcastClan(clan);
    } else {
      if (applicant) sendState(applicant);
      sendState(player);
      broadcastClan(clan);
    }

    notifyNext(clan);
    return { ok: true };
  }
  function leave(player) {
    const clan = getClanByPlayer(player);
    if (!clan) return { ok: false };

    if (clan.ownerId === player.id) {
      destroyClan(clan);
      return { ok: true, deleted: true };
    }

    clan.members = clan.members.filter((id) => id !== player.id);
    player.clanId = null;
    player.clanName = null;

    wsHub.sendToClientId(player.id, "clanPlayerUpdate", {
      playerId: player.id,
      clanName: null,
    });
    sendState(player);
    broadcastClan(clan);
    return { ok: true };
  }
  function kick(owner, memberId){ const clan=getClanByPlayer(owner); if(!clan||clan.ownerId!==owner.id)return {ok:false}; if(memberId===owner.id)return {ok:false}; const p=players.find(x=>x.id===memberId); clan.members=clan.members.filter(id=>id!==memberId); if(p){p.clanId=null; p.clanName=null; broadcastPlayerClanTag(p); sendState(p);} broadcastClan(clan); return {ok:true}; }
  function remove(player){ const clan=getClanByPlayer(player); if(clan&&clan.ownerId===player.id) destroyClan(clan); }
  function sameClan(a,b){ return !!a?.clanId && a.clanId===b?.clanId; }
  setInterval(()=>{ for(const clan of clans.values()){ notifyNext(clan); } },500);
  setInterval(()=>{ for(const clan of clans.values()) broadcastMap(clan); },3000);
  return { create, request, decide, leave, kick, remove, onOwnerGone, sameClan, sendState, getClanByPlayer, normalizeName };
}