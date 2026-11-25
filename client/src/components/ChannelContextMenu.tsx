import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  ChevronRight,
  Copy,
  CopyPlus,
  FolderInput,
  Link2,
  Pin,
  Plus,
  Settings,
  Star,
  Trash2,
} from 'lucide-react';
import { Channel, ChannelCategory } from '../types';

interface ChannelContextMenuProps {
  channel: Channel;
  x: number;
  y: number;
  categories: ChannelCategory[];
  isFavorite: boolean;
  isPinnedTop: boolean;
  isMuted: boolean;
  notifyLevel: 'all' | 'mentions' | 'nothing';
  canManageChannels: boolean;
  onMarkRead: () => void;
  onToggleFavorite: () => void;
  onTogglePinTop: () => void;
  onCopyInvite: () => void;
  onCopyLink: () => void;
  onSetMuted: (muted: boolean) => void;
  onSetNotifyLevel: (level: 'all' | 'mentions' | 'nothing') => void;
  onMoveToCategory: (categoryId: string | null) => void;
  onEditChannel: () => void;
  onDuplicateChannel: () => void;
  onCreateSameTypeChannel: () => void;
  onDeleteChannel: () => void;
  onClose: () => void;
}

export const ChannelContextMenu: React.FC<ChannelContextMenuProps> = ({
  channel,
  x,
  y,
  categories,
  isFavorite,
  isPinnedTop,
  isMuted,
  notifyLevel,
  canManageChannels,
  onMarkRead,
  onToggleFavorite,
  onTogglePinTop,
  onCopyInvite,
  onCopyLink,
  onSetMuted,
  onSetNotifyLevel,
  onMoveToCategory,
  onEditChannel,
  onDuplicateChannel,
  onCreateSameTypeChannel,
  onDeleteChannel,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<'none' | 'mute' | 'notify' | 'move'>('none');
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 12)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 12)),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const openLeft = pos.left > window.innerWidth - 440;

  return (
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[115] w-[238px] bg-[#111214] border border-[#2b2d31] rounded-md shadow-[0_14px_34px_rgba(0,0,0,0.8)] py-1.5 px-1.5 text-[13px] font-medium text-[#dbdee1] select-none"
    >
      <button
        type="button"
        onClick={() => {
          onMarkRead();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span>Marcar como lida</span>
        <Check className="w-3.5 h-3.5 opacity-70" />
      </button>

      <div className="my-1 border-t border-[#2b2d31]" />

      <button
        type="button"
        onClick={() => {
          onToggleFavorite();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span>{isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</span>
        <Star className={`w-3.5 h-3.5 ${isFavorite ? 'text-[#f0b232] fill-[#f0b232]' : 'opacity-80'}`} />
      </button>

      <div className="my-1 border-t border-[#2b2d31]" />

      <button
        type="button"
        onClick={() => {
          onCopyInvite();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span>Convite para o canal</span>
        <Link2 className="w-3.5 h-3.5 opacity-75" />
      </button>

      <button
        type="button"
        onClick={() => {
          onTogglePinTop();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span>{isPinnedTop ? 'Desafixar do topo' : 'Fixe o Canal no Topo'}</span>
        <Pin className={`w-3.5 h-3.5 ${isPinnedTop ? 'text-[#4ade80]' : 'opacity-75'}`} />
      </button>

      <button
        type="button"
        onClick={() => {
          onCopyLink();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span>Copiar link</span>
        <Copy className="w-3.5 h-3.5 opacity-75" />
      </button>

      <div className="my-1 border-t border-[#2b2d31]" />

      {/* Silenciar canal */}
      <div className="relative" onMouseEnter={() => setSub('mute')} onMouseLeave={() => setSub('none')}>
        <button
          type="button"
          onClick={() => setSub((s) => (s === 'mute' ? 'none' : 'mute'))}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            {isMuted ? <BellOff className="w-3.5 h-3.5 text-[#f0b232]" /> : null}
            <span>{isMuted ? 'Reativar canal' : 'Silenciar canal'}</span>
          </span>
          <ChevronRight className="w-4 h-4" />
        </button>
        {sub === 'mute' && (
          <div
            className={`absolute top-0 ${openLeft ? 'right-full mr-1' : 'left-full ml-1'} w-44 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl p-1 space-y-0.5 text-xs`}
          >
            {isMuted ? (
              <button
                type="button"
                onClick={() => {
                  onSetMuted(false);
                  onClose();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-[3px] hover:bg-[#23a55a] hover:text-white font-bold cursor-pointer"
              >
                Reativar notificações
              </button>
            ) : (
              ['Por 15 minutos', 'Por 1 hora', 'Por 24 horas', 'Até eu reativar'].map((lbl) => (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => {
                    onSetMuted(true);
                    onClose();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
                >
                  {lbl}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Config de notificação */}
      <div className="relative" onMouseEnter={() => setSub('notify')} onMouseLeave={() => setSub('none')}>
        <button
          type="button"
          onClick={() => setSub((s) => (s === 'notify' ? 'none' : 'notify'))}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer text-left"
        >
          <div>
            <div>Config. de notificação</div>
            <div className="text-[10px] text-[#949ba4]">
              {notifyLevel === 'all' ? 'Todas as mensagens' : notifyLevel === 'mentions' ? 'Apenas @menções' : 'Nada'}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 shrink-0" />
        </button>
        {sub === 'notify' && (
          <div
            className={`absolute top-0 ${openLeft ? 'right-full mr-1' : 'left-full ml-1'} w-48 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl p-1 space-y-0.5 text-xs`}
          >
            {(
              [
                ['all', 'Todas as mensagens'],
                ['mentions', 'Apenas @menções'],
                ['nothing', 'Nada'],
              ] as const
            ).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  onSetNotifyLevel(val);
                  onClose();
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Bell className="w-3 h-3" />
                  {lbl}
                </span>
                {notifyLevel === val && <Check className="w-3 h-3" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mover para categoria */}
      {canManageChannels && (
        <>
          <div className="my-1 border-t border-[#2b2d31]" />
          <div className="relative" onMouseEnter={() => setSub('move')} onMouseLeave={() => setSub('none')}>
            <button
              type="button"
              onClick={() => setSub((s) => (s === 'move' ? 'none' : 'move'))}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <FolderInput className="w-3.5 h-3.5 opacity-75" />
                Mover para...
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
            {sub === 'move' && (
              <div
                className={`absolute top-0 ${openLeft ? 'right-full mr-1' : 'left-full ml-1'} w-48 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl p-1 space-y-0.5 text-xs`}
              >
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      onMoveToCategory(cat.id);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
                  >
                    <span className="truncate">{cat.name}</span>
                    {channel.categoryId === cat.id && <Check className="w-3 h-3" />}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    onMoveToCategory(null);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer text-[#949ba4]"
                >
                  <span>Sem categoria</span>
                  {!channel.categoryId && <Check className="w-3 h-3" />}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              onEditChannel();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
          >
            <span>Editar canal</span>
            <Settings className="w-3.5 h-3.5 opacity-75" />
          </button>

          <button
            type="button"
            onClick={() => {
              onDuplicateChannel();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
          >
            <span>Duplicar canal</span>
            <CopyPlus className="w-3.5 h-3.5 opacity-75" />
          </button>

          <button
            type="button"
            onClick={() => {
              onCreateSameTypeChannel();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
          >
            <span>{channel.type === 'voice' ? 'Criar canal de voz' : 'Criar canal de texto'}</span>
            <Plus className="w-3.5 h-3.5 opacity-75" />
          </button>

          <button
            type="button"
            onClick={() => {
              onDeleteChannel();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#f23f42] hover:bg-[#da373c] hover:text-white cursor-pointer"
          >
            <span>Excluir canal</span>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
};
