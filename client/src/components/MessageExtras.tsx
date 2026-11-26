import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, Check, MessagesSquare, Plus, SmilePlus } from 'lucide-react';
import { EmojiPickerPopover, pushRecentEmoji } from './EmojiPicker';
import { ChatMessage, User } from '../types';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀', '✅', '❌', '💯', '🙏'];

/** Botão "Reagir" com uma paleta pequena (renderizada no body para não ser cortada pela lista). */
export const QuickReactButton: React.FC<{ onPick: (emoji: string) => void; className?: string }> = ({ onPick, className }) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [full, setFull] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Adicionar reação"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (!r) return;
          setPos(pos ? null : { x: Math.max(8, Math.min(window.innerWidth - 248, r.right - 240)), y: r.top - 8 });
        }}
        className={className || 'p-1.5 text-[#b5bac1] hover:text-white hover:bg-[#383a40] rounded cursor-pointer'}
      >
        <SmilePlus className="w-3.5 h-3.5" />
      </button>
      {pos &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{ left: pos.x, top: pos.y, transform: 'translateY(-100%)' }}
            className="fixed z-[200] w-[240px] grid grid-cols-6 gap-1 p-2 rounded-lg bg-[#2b2d31] border border-[#1e1f22] shadow-2xl"
          >
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onPick(e);
                  pushRecentEmoji(e);
                  setPos(null);
                }}
                className="h-8 rounded hover:bg-[#404249] text-lg cursor-pointer"
              >
                {e}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const r = btnRef.current?.getBoundingClientRect();
                setPos(null);
                if (r) setFull(r);
              }}
              className="col-span-6 h-7 rounded bg-[#1e1f22] hover:bg-[#404249] text-xs text-[#dbdee1] flex items-center justify-center gap-1 cursor-pointer"
              title="Todos os emojis"
            >
              <Plus className="w-3.5 h-3.5" /> Mais emojis
            </button>
          </div>,
          document.body
        )}
      {full && <EmojiPickerPopover anchor={full} onPick={onPick} onClose={() => setFull(null)} />}
    </>
  );
};

const ReactionBar: React.FC<{
  reactions: Record<string, string[]>;
  selfId: string;
  members: User[];
  onReact: (emoji: string) => void;
}> = ({ reactions, selfId, members, onReact }) => {
  const entries = Object.entries(reactions).filter(([, ids]) => Array.isArray(ids) && ids.length > 0);
  if (!entries.length) return null;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName || 'Alguém';
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(selfId);
        const who = ids.slice(0, 8).map(nameOf).join(', ') + (ids.length > 8 ? ` e mais ${ids.length - 8}` : '');
        return (
          <button
            key={emoji}
            type="button"
            title={`${who} reagiu com ${emoji}`}
            onClick={() => onReact(emoji)}
            className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[13px] border cursor-pointer transition ${
              mine ? 'bg-[#5865f2]/25 border-[#5865f2] text-white' : 'bg-[#2b2d31] border-transparent text-[#dbdee1] hover:border-[#4e5058]'
            }`}
          >
            <span>{emoji}</span>
            <span className="text-[11px] font-bold">{ids.length}</span>
          </button>
        );
      })}
      <QuickReactButton
        onPick={onReact}
        className="h-6 px-1.5 rounded-md bg-[#2b2d31] text-[#b5bac1] hover:text-white border border-transparent hover:border-[#4e5058] cursor-pointer"
      />
    </div>
  );
};

function useNow(enabled: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return now;
}

function formatRemaining(ms: number) {
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

const PollCard: React.FC<{
  msg: ChatMessage;
  selfId: string;
  onVote: (optionIds: string[]) => void;
  onClose?: () => void;
}> = ({ msg, selfId, onVote, onClose }) => {
  const poll = msg.poll!;
  const now = useNow(Boolean(poll.endsAt && !poll.closed));
  const ended = Boolean(poll.closed || (poll.endsAt && now > poll.endsAt));
  const myVotes = poll.options.filter((o) => o.votes.includes(selfId)).map((o) => o.id);
  const [draft, setDraft] = useState<string[]>(myVotes);
  useLayoutEffect(() => setDraft(myVotes), [myVotes.join(',')]);
  const totalVoters = new Set(poll.options.flatMap((o) => o.votes)).size;
  const showResults = ended || myVotes.length > 0;
  const maxVotes = Math.max(1, ...poll.options.map((o) => o.votes.length));

  const toggle = (id: string) => {
    if (ended) return;
    if (!poll.multi) {
      onVote(myVotes.includes(id) ? [] : [id]);
      return;
    }
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  };

  return (
    <div className="mt-2 max-w-md rounded-lg bg-[#2b2d31] border border-[#3f4147] p-3.5 space-y-2.5">
      <div className="flex items-start gap-2">
        <BarChart3 className="w-4 h-4 text-[#5865f2] mt-0.5 shrink-0" />
        <div className="text-sm font-bold text-white break-words">{poll.question}</div>
      </div>
      <div className="text-[11px] text-[#949ba4]">{poll.multi ? 'Escolha uma ou mais opções' : 'Escolha uma opção'}</div>
      <div className="space-y-1.5">
        {poll.options.map((o) => {
          const selected = poll.multi ? draft.includes(o.id) : myVotes.includes(o.id);
          const pct = totalVoters ? Math.round((o.votes.length / totalVoters) * 100) : 0;
          const leading = showResults && o.votes.length === maxVotes && o.votes.length > 0;
          return (
            <button
              key={o.id}
              type="button"
              disabled={ended}
              onClick={() => toggle(o.id)}
              className={`relative w-full overflow-hidden rounded-md border text-left px-3 py-2 text-[13px] cursor-pointer disabled:cursor-default ${
                selected ? 'border-[#5865f2]' : 'border-[#3f4147] hover:border-[#4e5058]'
              }`}
            >
              {showResults && (
                <span
                  className={`absolute inset-y-0 left-0 ${leading ? 'bg-[#5865f2]/35' : 'bg-[#4e5058]/40'}`}
                  style={{ width: `${pct}%` }}
                />
              )}
              <span className="relative flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0 text-[#dbdee1]">
                  <span
                    className={`w-4 h-4 shrink-0 border-2 grid place-items-center ${poll.multi ? 'rounded' : 'rounded-full'} ${
                      selected ? 'border-[#5865f2] bg-[#5865f2]' : 'border-[#80848e]'
                    }`}
                  >
                    {selected && <Check className="w-2.5 h-2.5 text-white" />}
                  </span>
                  <span className="truncate">{o.text}</span>
                </span>
                {showResults && (
                  <span className="text-[11px] font-bold text-white shrink-0">
                    {pct}% · {o.votes.length}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-[#949ba4]">
        <span>
          {totalVoters} {totalVoters === 1 ? 'voto' : 'votos'} ·{' '}
          {ended ? 'Encerrada' : poll.endsAt ? `Termina em ${formatRemaining(poll.endsAt - now)}` : 'Sem prazo'}
        </span>
        <span className="flex items-center gap-2">
          {poll.multi && !ended && [...draft].sort().join(',') !== [...myVotes].sort().join(',') && (
            <button
              type="button"
              onClick={() => onVote(draft)}
              className="px-2.5 py-1 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white font-bold cursor-pointer"
            >
              Votar
            </button>
          )}
          {onClose && !ended && (
            <button type="button" onClick={onClose} className="hover:text-white hover:underline cursor-pointer">
              Encerrar
            </button>
          )}
        </span>
      </div>
    </div>
  );
};

function timeAgo(ts: number) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

/** Enquete, reações e resumo da thread de uma mensagem de canal. */
export const MessageExtras: React.FC<{
  msg: ChatMessage;
  selfId: string;
  members: User[];
  canManage: boolean;
  onReact?: (emoji: string) => void;
  onVotePoll?: (optionIds: string[]) => void;
  onClosePoll?: () => void;
  onOpenThread?: () => void;
}> = ({ msg, selfId, members, canManage, onReact, onVotePoll, onClosePoll, onOpenThread }) => {
  return (
    <>
      {msg.poll && onVotePoll && (
        <PollCard
          msg={msg}
          selfId={selfId}
          onVote={onVotePoll}
          onClose={onClosePoll && (msg.authorId === selfId || canManage) ? onClosePoll : undefined}
        />
      )}
      {msg.reactions && onReact && <ReactionBar reactions={msg.reactions} selfId={selfId} members={members} onReact={onReact} />}
      {msg.thread && msg.thread.count > 0 && onOpenThread && (
        <button
          type="button"
          onClick={onOpenThread}
          className="mt-1.5 flex items-center gap-2 max-w-md px-2.5 py-1.5 rounded-md bg-[#2b2d31] hover:bg-[#383a40] border border-[#3f4147] text-left cursor-pointer"
        >
          <MessagesSquare className="w-4 h-4 text-[#5865f2] shrink-0" />
          <span className="text-[13px] font-bold text-[#00a8fc]">
            {msg.thread.count} {msg.thread.count === 1 ? 'resposta' : 'respostas'}
          </span>
          <span className="text-[11px] text-[#949ba4] truncate">
            {msg.thread.lastAuthorName ? `${msg.thread.lastAuthorName} · ` : ''}
            {timeAgo(msg.thread.lastAt)}
          </span>
        </button>
      )}
    </>
  );
};
