// Roda o servidor do Host num processo separado (Electron utilityProcess).
// Assim o servidor (Socket.IO, yt-dlp, compressão do banco) não disputa CPU com a janela do app,
// e se ele travar ou cair, o app continua aberto.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let server = null;

function reply(id, ok, payload) {
  try {
    process.parentPort.postMessage({ id, ok, ...payload });
  } catch {}
}

process.parentPort.on('message', async (event) => {
  const { id, cmd, args } = event.data || {};
  try {
    if (cmd === 'start') {
      const mod = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href);
      server = mod.createPulseCordServer(args.options || {});
      const info = await server.start(args.port);
      reply(id, true, { result: JSON.parse(JSON.stringify(info || {})) });
    } else if (cmd === 'stop') {
      const s = server;
      server = null;
      if (s) await s.stop();
      reply(id, true, { result: true });
      setTimeout(() => process.exit(0), 50);
    } else if (cmd === 'setServerMeta') {
      const r = server?.setServerMeta?.(args) ?? null;
      reply(id, true, { result: r ? JSON.parse(JSON.stringify(r)) : null });
    } else if (cmd === 'setServerPassword') {
      const r = server?.setServerPassword?.(args) ?? null;
      reply(id, true, { result: r ? JSON.parse(JSON.stringify(r)) : null });
    } else {
      reply(id, false, { error: { message: `Comando desconhecido: ${cmd}` } });
    }
  } catch (err) {
    reply(id, false, { error: { message: err?.message || String(err), code: err?.code } });
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Host] erro não tratado:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[Host] promessa rejeitada:', err);
});
