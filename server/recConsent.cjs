'use strict';
// Consentimento para gravar a chamada, compartilhado entre o servidor (server/index.js) e as chamadas
// diretas da rede local (electron/lanPeerMessenger.js).
// Quem quer gravar pede; todos os outros na chamada precisam permitir. Uma recusa (ou 60 s sem resposta)
// cancela. Quem entra numa chamada que está sendo gravada já confirmou no app antes de entrar.
const crypto = require('node:crypto');

function createRecConsent({ io, getRoom, getChannelOf, timeoutMs = 60_000 }) {
  const pending = new Map(); // channelId -> { id, requester, name, pending:Set<socketId>, timer }
  const approved = new Map(); // socketId -> channelId (pode gravar nesta chamada)

  function finish(channelId, ok, byName = null, reason = null) {
    const req = pending.get(channelId);
    if (!req) return;
    clearTimeout(req.timer);
    pending.delete(channelId);
    if (ok) approved.set(req.requester, channelId);
    io.to(req.requester).emit('voice:record-consent-result', { channelId, ok, by: byName, reason });
    io.to(`voice:${channelId}`).emit('voice:record-consent-closed', { requestId: req.id, ok, by: byName });
  }

  function ask(channelId, sid) {
    const req = pending.get(channelId);
    if (!req || sid === req.requester || req.pending.has(sid)) return;
    req.pending.add(sid);
    io.to(sid).emit('voice:record-consent-ask', { requestId: req.id, channelId, from: req.name });
  }

  // Chamar depois de colocar a pessoa na sala.
  function onJoin(channelId, sid) {
    ask(channelId, sid);
    // permissão dada antes desta pessoa entrar (e que ainda não virou gravação) não vale para ela
    const room = getRoom(channelId);
    for (const [other, chId] of approved) {
      if (chId === channelId && other !== sid && room?.get(other)?.recording !== 'record') approved.delete(other);
    }
  }

  // Chamar quando a pessoa sai da chamada (ou desconecta).
  function onLeave(sid, channelId) {
    approved.delete(sid);
    const req = pending.get(channelId);
    if (!req) return;
    if (req.requester === sid) return finish(channelId, false, null, 'cancelled');
    if (req.pending.delete(sid) && req.pending.size === 0) finish(channelId, true);
  }

  function request(socket, cb) {
    const reply = typeof cb === 'function' ? cb : () => {};
    const channelId = getChannelOf(socket.id);
    const room = channelId ? getRoom(channelId) : null;
    if (!channelId || !room || !room.has(socket.id)) return reply({ error: 'Entre numa chamada para gravar.' });
    if (approved.get(socket.id) === channelId) return reply({ ok: true, approved: true });
    if (pending.has(channelId)) return reply({ error: 'Já há um pedido de gravação esperando resposta nesta chamada.' });
    const others = [...room.keys()].filter((sid) => sid !== socket.id);
    if (!others.length) {
      approved.set(socket.id, channelId);
      return reply({ ok: true, approved: true });
    }
    const req = {
      id: crypto.randomUUID(),
      requester: socket.id,
      name: room.get(socket.id)?.displayName || 'Alguém',
      pending: new Set(),
      timer: setTimeout(() => finish(channelId, false, null, 'timeout'), timeoutMs),
    };
    pending.set(channelId, req);
    for (const sid of others) ask(channelId, sid);
    reply({ ok: true, approved: false, waiting: others.length });
  }

  function consent(socket, payload) {
    const channelId = getChannelOf(socket.id);
    const req = channelId ? pending.get(channelId) : null;
    if (!req || req.id !== payload?.requestId || !req.pending.has(socket.id)) return;
    if (payload?.accept !== true) {
      const name = getRoom(channelId)?.get(socket.id)?.displayName || 'Alguém';
      return finish(channelId, false, name, 'declined');
    }
    req.pending.delete(socket.id);
    if (req.pending.size === 0) finish(channelId, true);
  }

  // Aplica o campo "recording" de voice:media-state no participante. "record" só com permissão;
  // "clips" (buffer local de clipes) é só um aviso. Devolve true se mudou.
  function applyRecording(socket, channelId, participant, state) {
    if (!state || typeof state !== 'object' || !('recording' in state)) return false;
    const prevRec = participant.recording || null;
    let wantRec = state.recording === 'record' || state.recording === 'clips' ? state.recording : null;
    if (wantRec === 'record' && approved.get(socket.id) !== channelId) {
      wantRec = prevRec === 'clips' ? 'clips' : null;
      socket.emit('voice:record-consent-result', { channelId, ok: false, reason: 'not-approved' });
    }
    if (prevRec === 'record' && wantRec !== 'record') approved.delete(socket.id);
    participant.recording = wantRec;
    if (participant.recording === prevRec) return false;
    io.to(`voice:${channelId}`).emit('voice:recording-changed', {
      channelId,
      socketId: socket.id,
      displayName: participant.displayName,
      recording: participant.recording,
    });
    return true;
  }

  return { request, consent, onJoin, onLeave, applyRecording, _pending: pending, _approved: approved };
}

module.exports = { createRecConsent };
