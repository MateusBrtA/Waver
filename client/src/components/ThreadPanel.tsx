import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessagesSquare, Send, Trash2, X } from 'lucide-react';
import { resolveMediaUrl } from '../lib/api';
import { ChatMessage, User } from '../types';
import { Avatar } from './Avatar';
import { MessageExtras, QuickReactButton } from './MessageExtras';

function MessageText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/gi);
  return (
    <div className="text-sm text-[#dbdee1] leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        /^https?:\/\//i.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="text-[#00a8fc] hover:underline break-all">
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </div>
  );
}

/** Painel lateral com as respostas de uma mensagem (thread). */
export const ThreadPanel: React.FC<{
  channelName: string;
  parent: ChatMessage;
  messages: ChatMessage[];
  loading: boolean;
  selfId: string;
  members: User[];
  serverUrl: string;
  canSend: boolean;
  canManage: boolean;
  onSend: (text: string) => Promise<void> | void;
  onReact: (messageId: string, emoji: string, inThread: boolean) => void;
  onDelete: (messageId: string) => void;
  onClose: () => void;
}> = ({ channelName, parent, messages, loading, selfId, members, serverUrl, canSend, canManage, onSend, onReact, onDelete, onClose }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, parent.id]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [parent.id]);

  const author = (m: ChatMessage) => members.find((u) => u.id === m.authorId);

  const renderMsg = (m: ChatMessage, isParent: boolean) => {
    const a = author(m);
    return (
      <div key={m.id} className="group relative flex gap-2.5 px-3 py-1.5 hover:bg-white/[0.03] rounded-md">
        <Avatar
          name={a?.displayName || m.authorName}
          avatarUrl={a?.avatarUrl ?? m.authorAvatar}
          color={a?.avatarColor || m.authorColor}
          serverUrl={serverUrl}
          size="sm"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white">{a?.displayName || m.authorName}</span>
            <span className="text-[10px] text-[#949ba4]">
              {new Date(m.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {m.content && <MessageText text={m.content} />}
          {m.gifUrl && <img src={resolveMediaUrl(serverUrl, m.gifUrl)} alt="GIF" className="mt-1 max-h-48 rounded" loading="lazy" />}
          {(m.attachments || []).map((att) =>
            att.kind === 'image' || att.kind === 'gif' ? (
              <img key={att.id} src={resolveMediaUrl(serverUrl, att.url)} alt={att.name} className="mt-1 max-h-48 rounded" loading="lazy" />
            ) : (
              <a
                key={att.id}
                href={resolveMediaUrl(serverUrl, att.url)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-xs text-[#00a8fc] hover:underline truncate"
              >
                📎 {att.name}
              </a>
            )
          )}
          <MessageExtras
            msg={isParent ? { ...m, thread: null } : m}
            selfId={selfId}
            members={members}
            canManage={canManage}
            onReact={(e) => onReact(m.id, e, !isParent)}
          />
        </div>
        <div className="opacity-0 group-hover:opacity-100 absolute right-2 top-0.5 flex items-center bg-[#2b2d31] border border-[#1e1f22] rounded-md p-0.5">
          <QuickReactButton onPick={(e) => onReact(m.id, e, !isParent)} />
          {!isParent && (m.authorId === selfId || canManage) && (
            <button
              type="button"
              onClick={() => onDelete(m.id)}
              className="p-1.5 text-[#b5bac1] hover:text-[#f23f42] hover:bg-[#383a40] rounded cursor-pointer"
              title="Excluir"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t);
      setText('');
    } catch {
      // erro já mostrado pelo app; o texto fica para tentar de novo
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="w-[380px] max-w-[45vw] shrink-0 flex flex-col bg-[#2b2d31] border-l border-[#1f2023]">
      <div className="h-12 px-3 flex items-center gap-2 border-b border-[#1f2023] shrink-0">
        <MessagesSquare className="w-5 h-5 text-[#80848e]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white truncate">Thread</div>
          <div className="text-[11px] text-[#949ba4] truncate">#{channelName}</div>
        </div>
        <button type="button" onClick={onClose} className="p-1 text-[#b5bac1] hover:text-white cursor-pointer" aria-label="Fechar thread">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {renderMsg(parent, true)}
        <div className="mx-3 my-2 flex items-center gap-2 text-[11px] text-[#949ba4]">
          <span className="h-px flex-1 bg-[#3f4147]" />
          {messages.length} {messages.length === 1 ? 'resposta' : 'respostas'}
          <span className="h-px flex-1 bg-[#3f4147]" />
        </div>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-[#949ba4]" />
          </div>
        ) : (
          messages.map((m) => renderMsg(m, false))
        )}
        <div ref={endRef} />
      </div>
      <div className="p-3 shrink-0">
        <div className="flex items-end gap-2 rounded-lg bg-[#383a40] px-3 py-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            disabled={!canSend}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={canSend ? 'Responder na thread' : 'Você não pode enviar mensagens aqui'}
            className="flex-1 resize-none bg-transparent text-sm text-white outline-none placeholder-[#87898c] max-h-40"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending || !canSend}
            className="p-1 text-[#b5bac1] hover:text-white disabled:opacity-40 cursor-pointer"
            aria-label="Enviar"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
};
