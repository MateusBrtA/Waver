import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';

/**
 * Seletor de emoji completo: todos os emojis que a fonte do Windows (Segoe UI Emoji) desenha,
 * em categorias, com busca em português e inglês, recentes e tom de pele.
 * Os dados (client/src/assets/emoji-data.json) são gerados por scripts/emoji/ e carregados sob demanda.
 */

type Row = [string, string, number, 1?]; // [emoji, nome, grupo, aceita tom de pele]

const GROUPS: Array<{ label: string; icon: string }> = [
  { label: 'Carinhas e emoções', icon: '😀' },
  { label: 'Pessoas e corpo', icon: '👋' },
  { label: 'Animais e natureza', icon: '🐻' },
  { label: 'Comidas e bebidas', icon: '🍔' },
  { label: 'Viagens e lugares', icon: '✈️' },
  { label: 'Atividades', icon: '⚽' },
  { label: 'Objetos', icon: '💡' },
  { label: 'Símbolos', icon: '❤️' },
  { label: 'Bandeiras', icon: '🏳️' },
];
const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const TONE_SWATCH = ['#ffc83d', '#f7dece', '#f3d2a2', '#d5ab88', '#af7e57', '#7c533e'];
const RECENT_KEY = 'pc-emoji-recent';
const TONE_KEY = 'pc-emoji-tone';

// busca em português → palavras dos nomes (em inglês) dos emojis
const PT: Record<string, string> = {
  feliz: 'grinning smiling joy happy', sorriso: 'smiling grinning', sorrindo: 'smiling grinning', rindo: 'joy laughing rolling grinning squinting',
  risada: 'joy laughing rolling', kkk: 'joy rolling', triste: 'crying sad disappointed pensive frowning worried', chorando: 'crying loudly sob tears',
  choro: 'crying tears', bravo: 'angry pouting rage symbols', raiva: 'angry pouting rage', irritado: 'angry steam', amor: 'heart love kiss heart-eyes',
  coracao: 'heart', 'coração': 'heart', beijo: 'kiss kissing', apaixonado: 'heart-eyes hearts', medo: 'fearful scream anxious', susto: 'scream astonished',
  surpreso: 'astonished open mouth hushed', pensando: 'thinking', duvida: 'thinking raised eyebrow', dúvida: 'thinking raised eyebrow', sono: 'sleeping yawning zzz',
  dormindo: 'sleeping zzz', cansado: 'tired weary yawning', doente: 'sick mask thermometer nauseated vomiting', vomito: 'vomiting', vômito: 'vomiting',
  legal: 'sunglasses thumbs ok cool', oculos: 'glasses sunglasses', óculos: 'glasses sunglasses', festa: 'party popper confetti balloon tada',
  parabens: 'party popper confetti clapping birthday', parabéns: 'party popper confetti clapping birthday', aniversario: 'birthday cake gift',
  aniversário: 'birthday cake gift', presente: 'gift wrapped present', fogo: 'fire', estrela: 'star', brilho: 'sparkles glowing', ok: 'ok thumbs check',
  joia: 'thumbs up', joinha: 'thumbs up', positivo: 'thumbs up', negativo: 'thumbs down', mao: 'hand', mão: 'hand', maos: 'hands', mãos: 'hands',
  palmas: 'clapping', aplauso: 'clapping', tchau: 'waving', oi: 'waving', ola: 'waving', olá: 'waving', reza: 'folded hands', obrigado: 'folded hands',
  forca: 'biceps flexed', força: 'biceps flexed', musculo: 'biceps', músculo: 'biceps', dedo: 'finger index', olho: 'eye', olhos: 'eyes', boca: 'mouth lips',
  caveira: 'skull', morto: 'skull dead', fantasma: 'ghost', palhaco: 'clown', palhaço: 'clown', robo: 'robot', robô: 'robot', alien: 'alien extraterrestrial',
  coco: 'pile of poo coconut', cocô: 'pile of poo', diabo: 'devil imp horns', anjo: 'angel halo', pessoa: 'person', homem: 'man', mulher: 'woman',
  menino: 'boy', menina: 'girl', bebe: 'baby', bebê: 'baby', familia: 'family', família: 'family', casal: 'couple', policial: 'police', medico: 'health worker doctor',
  médico: 'health worker doctor', professor: 'teacher', cozinheiro: 'cook', bombeiro: 'firefighter', astronauta: 'astronaut', ninja: 'ninja', rei: 'king crown prince',
  rainha: 'queen crown princess', cachorro: 'dog', cao: 'dog', cão: 'dog', gato: 'cat', rato: 'mouse rat', coelho: 'rabbit', urso: 'bear', panda: 'panda',
  macaco: 'monkey gorilla', leao: 'lion', leão: 'lion', tigre: 'tiger', cavalo: 'horse', vaca: 'cow', porco: 'pig', galinha: 'chicken hen', pinto: 'chick',
  passaro: 'bird', pássaro: 'bird', pato: 'duck', coruja: 'owl', sapo: 'frog', cobra: 'snake', dragao: 'dragon', dragão: 'dragon', peixe: 'fish', tubarao: 'shark',
  tubarão: 'shark', baleia: 'whale', golfinho: 'dolphin', polvo: 'octopus', borboleta: 'butterfly', abelha: 'bee honeybee', aranha: 'spider', flor: 'flower blossom rose tulip',
  rosa: 'rose', arvore: 'tree', árvore: 'tree', planta: 'plant seedling herb', folha: 'leaf', fruta: 'grapes melon tangerine banana apple pear peach cherries strawberry',
  maca: 'apple', maçã: 'apple', banana: 'banana', uva: 'grapes', morango: 'strawberry', melancia: 'watermelon', abacaxi: 'pineapple', limao: 'lemon lime', limão: 'lemon lime',
  pizza: 'pizza', hamburguer: 'hamburger', hambúrguer: 'hamburger', batata: 'potato fries', pao: 'bread', pão: 'bread', queijo: 'cheese', ovo: 'egg', carne: 'meat',
  bolo: 'cake', doce: 'candy lollipop chocolate cake', sorvete: 'ice cream', cafe: 'coffee hot beverage', café: 'coffee hot beverage', cerveja: 'beer', vinho: 'wine',
  agua: 'water droplet', água: 'water droplet', comida: 'food', bebida: 'beverage drink', carro: 'car automobile', onibus: 'bus', ônibus: 'bus', aviao: 'airplane',
  avião: 'airplane', trem: 'train', bicicleta: 'bicycle', moto: 'motorcycle', foguete: 'rocket', navio: 'ship', barco: 'boat', casa: 'house home', predio: 'building',
  prédio: 'building', praia: 'beach', montanha: 'mountain', sol: 'sun', lua: 'moon', nuvem: 'cloud', chuva: 'rain umbrella', neve: 'snow snowflake snowman',
  raio: 'lightning high voltage', arco: 'rainbow bow', 'arco-iris': 'rainbow', relogio: 'clock watch', relógio: 'clock watch', bola: 'ball soccer basketball',
  futebol: 'soccer', jogo: 'video game joystick die', game: 'video game joystick', controle: 'joystick video game', trofeu: 'trophy', troféu: 'trophy', medalha: 'medal',
  musica: 'musical note headphone', música: 'musical note headphone', fone: 'headphone', microfone: 'microphone', violao: 'guitar', violão: 'guitar', guitarra: 'guitar',
  celular: 'mobile phone', telefone: 'telephone', computador: 'computer laptop desktop', livro: 'book', lapis: 'pencil', lápis: 'pencil', dinheiro: 'money dollar banknote coin',
  chave: 'key', cadeado: 'lock', lampada: 'light bulb', lâmpada: 'light bulb', bomba: 'bomb', arma: 'pistol sword', espada: 'sword', escudo: 'shield', ferramenta: 'wrench hammer tool',
  camera: 'camera', câmera: 'camera', filme: 'film movie clapper', tv: 'television', certo: 'check mark', errado: 'cross mark', sim: 'check', nao: 'no prohibited cross',
  não: 'no prohibited cross', aviso: 'warning', perigo: 'warning', proibido: 'prohibited no entry', seta: 'arrow', numero: 'keycap', número: 'keycap', cem: 'hundred',
  bandeira: 'flag bandeira', brasil: 'brasil', paz: 'peace', azul: 'blue', vermelho: 'red', verde: 'green', amarelo: 'yellow', roxo: 'purple', preto: 'black', branco: 'white',
  laranja: 'orange', rosa_cor: 'pink',
};

let dataPromise: Promise<Row[]> | null = null;
function loadData(): Promise<Row[]> {
  if (!dataPromise) dataPromise = import('../assets/emoji-data.json').then((m) => (m.default || m) as unknown as Row[]);
  return dataPromise;
}

function applyTone(e: string, toneIdx: number) {
  if (!toneIdx) return e;
  const cps = Array.from(e);
  const rest = cps.slice(1);
  if (rest[0] === '️') rest.shift();
  return cps[0] + TONES[toneIdx] + rest.join('');
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 32) : [];
  } catch {
    return [];
  }
}
export function pushRecentEmoji(e: string) {
  try {
    const next = [e, ...readRecent().filter((x) => x !== e)].slice(0, 32);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose?: () => void;
  className?: string;
  autoFocus?: boolean;
}

/** O painel em si (o lugar onde ele aparece é decidido por quem usa, ou pelo EmojiPickerPopover). */
export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onPick, onClose, className, autoFocus = true }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState(() => {
    try {
      return Math.max(0, Math.min(5, Number(localStorage.getItem(TONE_KEY)) || 0));
    } catch {
      return 0;
    }
  });
  const [toneOpen, setToneOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [hover, setHover] = useState<Row | null>(null);
  const [activeGroup, setActiveGroup] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    loadData()
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const byGroup = useMemo(() => {
    const g: Row[][] = GROUPS.map(() => []);
    for (const r of rows || []) g[r[2]]?.push(r);
    return g;
  }, [rows]);
  const byEmoji = useMemo(() => new Map((rows || []).map((r) => [r[0], r])), [rows]);

  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q || !rows) return null;
    const words = q.split(/\s+/).filter(Boolean);
    return rows
      .filter((r) => {
        const name = norm(r[1]);
        return words.every((w) => {
          if (name.includes(w)) return true;
          const extra = PT[w];
          return Boolean(extra && extra.split(' ').some((x) => name.includes(x)));
        });
      })
      .slice(0, 400);
  }, [query, rows]);

  const pick = (r: Row | string) => {
    const base = typeof r === 'string' ? r : r[0];
    const row = typeof r === 'string' ? byEmoji.get(r) : r;
    const e = row && row[3] && typeof r !== 'string' ? applyTone(base, tone) : base;
    pushRecentEmoji(e);
    setRecent(readRecent());
    onPick(e);
  };

  const cell = (r: Row, key?: string) => {
    const shown = r[3] ? applyTone(r[0], tone) : r[0];
    return (
      <button
        key={key || r[0]}
        type="button"
        onClick={() => pick(r)}
        onMouseEnter={() => setHover(r)}
        className="w-9 h-9 rounded-md text-[24px] leading-none flex items-center justify-center hover:bg-[#404249] cursor-pointer"
        style={{ fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif' }}
        title={r[1]}
      >
        {shown}
      </button>
    );
  };

  const jump = (g: number) => {
    setQuery('');
    setActiveGroup(g);
    requestAnimationFrame(() => {
      const el = g < 0 ? scrollRef.current?.querySelector('[data-recent]') : sectionRefs.current[g];
      if (el && scrollRef.current) scrollRef.current.scrollTop = (el as HTMLElement).offsetTop - 4;
    });
  };

  const onScroll = () => {
    const sc = scrollRef.current;
    if (!sc || results) return;
    let cur = -1;
    sectionRefs.current.forEach((el, i) => {
      if (el && el.offsetTop - 8 <= sc.scrollTop) cur = i;
    });
    setActiveGroup(cur);
  };

  return (
    <div
      data-emoji-picker
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose?.();
        }
      }}
      className={`w-[372px] h-[430px] max-w-[calc(100vw-16px)] flex flex-col bg-[#2b2d31] border border-[#1e1f22] rounded-lg shadow-2xl text-[#dbdee1] overflow-hidden ${className || ''}`}
    >
      <div className="p-2 flex items-center gap-2 border-b border-[#1e1f22]">
        <div className="flex-1 flex items-center gap-1.5 h-8 px-2 rounded bg-[#1e1f22]">
          <Search className="w-4 h-4 text-[#949ba4] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results && results[0]) {
                e.preventDefault();
                pick(results[0]);
              }
            }}
            placeholder="Buscar emoji (ex.: rindo, gato, coração)"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-white placeholder:text-[#6d6f78]"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-[#949ba4] hover:text-white cursor-pointer" title="Limpar">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setToneOpen((v) => !v)}
            className="w-8 h-8 rounded flex items-center justify-center hover:bg-[#404249] cursor-pointer"
            title="Tom de pele"
          >
            <span className="w-5 h-5 rounded-full border border-black/40" style={{ backgroundColor: TONE_SWATCH[tone] }} />
          </button>
          {toneOpen && (
            <div className="absolute right-0 top-9 z-10 flex gap-1 p-1.5 rounded-md bg-[#111214] border border-[#1e1f22] shadow-xl">
              {TONE_SWATCH.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setTone(i);
                    setToneOpen(false);
                    try {
                      localStorage.setItem(TONE_KEY, String(i));
                    } catch {}
                  }}
                  className={`w-6 h-6 rounded-full border-2 cursor-pointer ${tone === i ? 'border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  title={['Padrão', 'Clara', 'Média-clara', 'Média', 'Média-escura', 'Escura'][i]}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <nav className="w-11 shrink-0 bg-[#232428] flex flex-col items-center gap-0.5 py-1.5 overflow-y-auto">
          {recent.length > 0 && (
            <button
              type="button"
              onClick={() => jump(-1)}
              className={`w-8 h-8 rounded text-lg cursor-pointer ${activeGroup === -1 && !results ? 'bg-[#404249]' : 'hover:bg-[#35373c] opacity-70 hover:opacity-100'}`}
              title="Usados recentemente"
            >
              🕘
            </button>
          )}
          {GROUPS.map((g, i) => (
            <button
              key={g.label}
              type="button"
              onClick={() => jump(i)}
              className={`w-8 h-8 rounded text-lg cursor-pointer ${activeGroup === i && !results ? 'bg-[#404249]' : 'hover:bg-[#35373c] opacity-70 hover:opacity-100'}`}
              title={g.label}
            >
              {g.icon}
            </button>
          ))}
        </nav>

        <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 min-w-0 overflow-y-auto px-2 pb-2">
          {!rows ? (
            <div className="h-full flex items-center justify-center text-xs text-[#949ba4]">Carregando emojis…</div>
          ) : results ? (
            results.length ? (
              <>
                <div className="sticky top-0 bg-[#2b2d31] py-1.5 text-[11px] font-semibold uppercase text-[#949ba4]">Resultados</div>
                <div className="grid grid-cols-8 gap-0.5">{results.map((r) => cell(r))}</div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-[#949ba4]">Nenhum emoji encontrado.</div>
            )
          ) : (
            <>
              {recent.length > 0 && (
                <div data-recent>
                  <div className="sticky top-0 z-[1] bg-[#2b2d31] py-1.5 text-[11px] font-semibold uppercase text-[#949ba4]">Usados recentemente</div>
                  <div className="grid grid-cols-8 gap-0.5">
                    {recent.map((e) => {
                      const r = byEmoji.get(e) || ([e, e, 0] as Row);
                      return (
                        <button
                          key={`r-${e}`}
                          type="button"
                          onClick={() => pick(e)}
                          onMouseEnter={() => setHover(r)}
                          className="w-9 h-9 rounded-md text-[24px] leading-none flex items-center justify-center hover:bg-[#404249] cursor-pointer"
                          style={{ fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif' }}
                        >
                          {e}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {byGroup.map((list, i) => (
                <div
                  key={GROUPS[i].label}
                  ref={(el) => {
                    sectionRefs.current[i] = el;
                  }}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.ceil(list.length / 8) * 38 + 30}px` }}
                >
                  <div className="sticky top-0 z-[1] bg-[#2b2d31] py-1.5 text-[11px] font-semibold uppercase text-[#949ba4]">{GROUPS[i].label}</div>
                  <div className="grid grid-cols-8 gap-0.5">{list.map((r) => cell(r))}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="h-11 shrink-0 border-t border-[#1e1f22] bg-[#232428] px-3 flex items-center gap-2.5">
        {hover ? (
          <>
            <span className="text-2xl leading-none" style={{ fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif' }}>
              {hover[3] ? applyTone(hover[0], tone) : hover[0]}
            </span>
            <span className="text-xs text-[#dbdee1] truncate">{hover[1]}</span>
          </>
        ) : (
          <span className="text-[11px] text-[#949ba4]">{rows ? `${rows.length} emojis do Windows` : ''}</span>
        )}
      </div>
    </div>
  );
};

/**
 * Seletor flutuante ancorado num retângulo (botão que abriu). Fica no body: não é cortado por listas com overflow.
 * Fecha ao clicar fora, com Esc ou ao escolher (closeOnPick).
 */
export const EmojiPickerPopover: React.FC<{
  anchor: DOMRect | { left: number; top: number; right: number; bottom: number };
  onPick: (emoji: string) => void;
  onClose: () => void;
  closeOnPick?: boolean;
  placement?: 'above' | 'below';
}> = ({ anchor, onPick, onClose, closeOnPick = true, placement = 'above' }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor.right - w;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = placement === 'above' ? anchor.top - h - 6 : anchor.bottom + 6;
    if (top < 8) top = anchor.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.top - h - 6);
    setPos({ left, top });
  }, [anchor.left, anchor.top, anchor.right, anchor.bottom, placement]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="fixed z-[210]" style={pos}>
      <EmojiPicker
        onClose={onClose}
        onPick={(e) => {
          onPick(e);
          if (closeOnPick) onClose();
        }}
      />
    </div>,
    document.body
  );
};
