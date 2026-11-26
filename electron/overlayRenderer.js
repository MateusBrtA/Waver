// Desenha a lista de quem está na chamada (janela transparente sobre o jogo). Sem framework: leve.
(function () {
  const root = document.getElementById('root');

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(state) {
    const cfg = (state && state.config) || {};
    document.body.className = [
      String(cfg.corner || 'top-left').startsWith('bottom') ? 'bottom' : '',
      String(cfg.corner || '').endsWith('right') ? 'right' : '',
    ].join(' ');
    root.textContent = '';
    if (!state || !state.channelName) return;
    let people = Array.isArray(state.participants) ? state.participants : [];
    if (cfg.onlySpeaking) people = people.filter((p) => p.speaking);
    root.appendChild(el('div', 'head', state.channelName));
    for (const p of people.slice(0, 12)) {
      const row = el('div', 'row ' + (p.speaking ? 'speaking' : 'idle'));
      const av = el('div', 'av');
      if (p.avatarUrl && /^(https?:|data:image\/)/.test(p.avatarUrl)) {
        av.style.backgroundImage = 'url("' + String(p.avatarUrl).replace(/["\\]/g, '') + '")';
      } else {
        av.style.backgroundColor = /^#[0-9a-f]{3,8}$/i.test(p.avatarColor || '') ? p.avatarColor : '#5865f2';
        av.textContent = String(p.name || '?').slice(0, 1).toUpperCase();
      }
      row.appendChild(av);
      row.appendChild(el('span', 'name', p.name || ''));
      if (p.deafened) row.appendChild(el('span', 'ico', '🎧✖'));
      else if (p.muted) row.appendChild(el('span', 'ico', '🔇'));
      root.appendChild(row);
    }
  }

  if (window.overlayAPI) window.overlayAPI.onState(render);
})();
