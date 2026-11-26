import React, { useMemo, useState } from 'react';
import { FileUp, Hash, Loader2, X } from 'lucide-react';
import { Channel, SharedFileInfo, User } from '../types';
import { useEscapeToClose } from '../lib/useEscapeToClose';

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Destino dos arquivos enviados pelo "Compartilhar no Waver" do Explorer. */
export const ShareTargetModal: React.FC<{
  files: SharedFileInfo[];
  channels: Channel[];
  members: User[];
  selfId: string;
  busy: boolean;
  onPick: (target: { type: 'channel'; id: string } | { type: 'dm'; userId: string }) => void;
  onClose: () => void;
}> = ({ files, channels, members, selfId, busy, onPick, onClose }) => {
  useEscapeToClose(onClose);
  const [q, setQ] = useState('');
  const textChannels = useMemo(
    () => channels.filter((c) => c.type === 'text' && c.name.toLowerCase().includes(q.toLowerCase())),
    [channels, q]
  );
  const people = useMemo(
    () =>
      members
        .filter((m) => m.id !== selfId && (m.displayName || m.username).toLowerCase().includes(q.toLowerCase()))
        .slice(0, 30),
    [members, selfId, q]
  );
  const total = files.reduce((a, f) => a + f.size, 0);

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-[440px] max-h-[80vh] flex flex-col rounded-lg bg-[#313338] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-3 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[#5865f2] grid place-items-center shrink-0">
            <FileUp className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-white font-semibold">Compartilhar no Waver</h2>
            <p className="text-xs text-[#b5bac1] truncate">
              {files.length === 1 ? files[0].name : `${files.length} arquivos`} · {formatSize(total)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[#b5bac1] hover:text-white cursor-pointer" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 pb-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Para onde enviar?"
            className="w-full h-9 rounded bg-[#1e1f22] px-3 text-sm text-white outline-none placeholder-[#87898c]"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {textChannels.length > 0 && <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase text-[#949ba4]">Canais</div>}
          {textChannels.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => onPick({ type: 'channel', id: c.id })}
              className="w-full flex items-center gap-2 px-2 h-9 rounded text-sm text-[#dbdee1] hover:bg-[#404249] cursor-pointer disabled:opacity-50"
            >
              <Hash className="w-4 h-4 text-[#80848e]" />
              {c.name}
            </button>
          ))}
          {people.length > 0 && <div className="px-2 pt-3 pb-1 text-[11px] font-bold uppercase text-[#949ba4]">Mensagem direta</div>}
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() => onPick({ type: 'dm', userId: m.id })}
              className="w-full flex items-center gap-2 px-2 h-9 rounded text-sm text-[#dbdee1] hover:bg-[#404249] cursor-pointer disabled:opacity-50"
            >
              <span className="w-5 h-5 rounded-full grid place-items-center text-[10px] text-white" style={{ background: m.avatarColor }}>
                {(m.displayName || m.username).slice(0, 1).toUpperCase()}
              </span>
              {m.displayName || m.username}
            </button>
          ))}
          {busy && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-[#b5bac1]">
              <Loader2 className="w-4 h-4 animate-spin" /> Preparando os arquivos…
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
