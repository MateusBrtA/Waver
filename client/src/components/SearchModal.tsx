import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Loader2, Search, X } from 'lucide-react';
import { ApiClient } from '../lib/api';
import { Channel, ChatMessage, SearchFilters } from '../types';
import { useEscapeToClose } from '../lib/useEscapeToClose';

const HAS_ALIASES: Record<string, string> = {
  arquivo: 'file', file: 'file', anexo: 'file',
  imagem: 'image', image: 'image', foto: 'image', gif: 'image',
  video: 'video', vídeo: 'video',
  audio: 'audio', áudio: 'audio', voz: 'audio',
  link: 'link',
  enquete: 'poll', poll: 'poll',
  fixada: 'pinned', pinned: 'pinned', fixado: 'pinned',
};

function parseDate(v: string, endOfDay: boolean) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) || /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return 0;
  const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return dt.getTime() || 0;
}

/** "de:joão tem:imagem em:#geral antes:2026-01-31 bolo" -> filtros do servidor */
export function parseSearchQuery(raw: string, channels: Channel[]): SearchFilters {
  const f: SearchFilters = {};
  const words: string[] = [];
  const re = /(\w+):("[^"]*"|\S+)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[3]) {
      words.push(m[3]);
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2].replace(/^"|"$/g, '');
    if (key === 'de' || key === 'from') f.from = val.replace(/^@/, '');
    else if (key === 'tem' || key === 'has') f.has = HAS_ALIASES[val.toLowerCase()] || val.toLowerCase();
    else if (key === 'em' || key === 'in') {
      const name = val.replace(/^#/, '').toLowerCase();
      const ch = channels.find((c) => c.type === 'text' && c.name.toLowerCase() === name);
      if (ch) f.channelId = ch.id;
    } else if (key === 'antes' || key === 'before') f.before = parseDate(val, false);
    else if (key === 'depois' || key === 'after') f.after = parseDate(val, true);
    else if (key === 'durante' || key === 'during') {
      f.after = parseDate(val, false);
      f.before = parseDate(val, true);
    } else words.push(m[0]);
  }
  const q = words.join(' ').trim();
  if (q) f.q = q;
  return f;
}

function Highlight({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const idx = fold(text).indexOf(fold(term));
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[#f0b232]/40 text-white rounded px-0.5">{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
  );
}

const CHIPS = ['de:', 'tem:imagem', 'tem:arquivo', 'tem:link', 'tem:enquete', 'em:#', 'antes:', 'depois:'];

/** Busca no histórico dos canais do servidor, com filtros. */
export const SearchModal: React.FC<{
  api: ApiClient;
  channels: Channel[];
  currentChannel?: Channel | null;
  onJump: (msg: ChatMessage) => void;
  onClose: () => void;
}> = ({ api, channels, currentChannel, onJump, onClose }) => {
  useEscapeToClose(onClose);
  const [raw, setRaw] = useState('');
  const [onlyHere, setOnlyHere] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const filters = useMemo(() => {
    const f = parseSearchQuery(raw, channels);
    if (onlyHere && currentChannel && !f.channelId) f.channelId = currentChannel.id;
    return f;
  }, [raw, channels, onlyHere, currentChannel]);
  const hasFilters = Boolean(filters.q || filters.from || filters.has || filters.before || filters.after);

  useEffect(() => {
    if (!hasFilters) {
      setResults([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api
        .searchMessages(filters)
        .then((r) => {
          if (cancelled) return;
          setResults(r.results);
          setTotal(r.total);
        })
        .catch((err: Error) => !cancelled && setError(err.message || 'Falha na busca.'))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [api, JSON.stringify(filters), hasFilters]);

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-start justify-center p-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        className="w-full max-w-[620px] max-h-[75vh] flex flex-col rounded-lg bg-[#313338] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-[#1f2023] space-y-2">
          <div className="flex items-center gap-2 rounded bg-[#1e1f22] px-3 h-10">
            <Search className="w-4 h-4 text-[#949ba4]" />
            <input
              ref={inputRef}
              autoFocus
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Buscar mensagens (ex.: de:ana tem:imagem churrasco)"
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder-[#87898c]"
            />
            {loading && <Loader2 className="w-4 h-4 animate-spin text-[#949ba4]" />}
            <button type="button" onClick={onClose} className="text-[#b5bac1] hover:text-white cursor-pointer" aria-label="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setRaw((r) => `${r}${r && !r.endsWith(' ') ? ' ' : ''}${c}`);
                  inputRef.current?.focus();
                }}
                className="h-6 px-2 rounded bg-[#2b2d31] hover:bg-[#404249] text-[11px] text-[#dbdee1] cursor-pointer font-mono"
              >
                {c}
              </button>
            ))}
            {currentChannel && (
              <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[#b5bac1] cursor-pointer">
                <input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} className="accent-[#5865f2]" />
                Só em #{currentChannel.name}
              </label>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {error && <p className="p-3 text-sm text-[#f23f43]">{error}</p>}
          {!hasFilters && (
            <div className="p-4 text-[13px] text-[#949ba4] space-y-1">
              <p>Filtros que dá para combinar:</p>
              <p>
                <code className="text-white">de:nome</code> · <code className="text-white">tem:imagem | arquivo | vídeo | áudio | link | enquete | fixada</code>
              </p>
              <p>
                <code className="text-white">em:#canal</code> · <code className="text-white">antes:2026-01-31</code> ·{' '}
                <code className="text-white">depois:01/12/2025</code> · <code className="text-white">durante:2026-02-14</code>
              </p>
            </div>
          )}
          {hasFilters && !loading && !error && results.length === 0 && (
            <p className="p-6 text-center text-sm text-[#949ba4]">Nada encontrado.</p>
          )}
          {results.length > 0 && (
            <div className="px-2 pb-1 text-[11px] font-bold uppercase text-[#949ba4]">
              {total} {total === 1 ? 'resultado' : 'resultados'}
              {total > results.length ? ` (mostrando os ${results.length} mais recentes)` : ''}
            </div>
          )}
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onJump(m)}
              className="w-full text-left px-3 py-2 rounded hover:bg-[#2b2d31] cursor-pointer"
            >
              <div className="flex items-center gap-2 text-[11px] text-[#949ba4]">
                <span className="flex items-center gap-0.5 text-[#b5bac1]">
                  <Hash className="w-3 h-3" />
                  {m.channelName}
                </span>
                <span className="font-semibold text-white">{m.authorName}</span>
                <span>{new Date(m.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="text-sm text-[#dbdee1] line-clamp-2 break-words">
                {m.content ? (
                  <Highlight text={m.content.slice(0, 300)} term={filters.q} />
                ) : m.poll ? (
                  `📊 ${m.poll.question}`
                ) : m.attachments?.length ? (
                  `📎 ${m.attachments.map((a) => a.name).join(', ')}`
                ) : m.transfer ? (
                  `📦 ${m.transfer.originalName}`
                ) : m.gifUrl ? (
                  'GIF'
                ) : (
                  ''
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
