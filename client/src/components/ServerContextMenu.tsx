import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Check,
  ChevronRight,
  FolderPlus,
  Link2,
  LogOut,
  Plus,
  Settings,
  Shield,
  User as UserIcon,
} from 'lucide-react';
import { RolePermissions } from '../types';

interface ServerContextMenuProps {
  x: number;
  y: number;
  isHosting: boolean;
  isMuted: boolean;
  hideMutedChannels: boolean;
  notifyLevel: 'all' | 'mentions' | 'nothing';
  permissions: RolePermissions;
  onMarkAllRead: () => void;
  onInviteToServer: () => void;
  onSetMuted: (muted: boolean) => void;
  onSetNotifyLevel: (level: 'all' | 'mentions' | 'nothing') => void;
  onToggleHideMuted: () => void;
  onOpenServerSettings: (subtab?: 'server' | 'roles' | 'audit' | 'members' | 'bans') => void;
  onOpenPrivacy: () => void;
  onEditServerProfile: () => void;
  onCreateChannel: () => void;
  onCreateCategory: () => void;
  onLeaveServer: () => void;
  onClose: () => void;
}

export const ServerContextMenu: React.FC<ServerContextMenuProps> = ({
  x,
  y,
  isHosting,
  isMuted,
  hideMutedChannels,
  notifyLevel,
  permissions,
  onMarkAllRead,
  onInviteToServer,
  onSetMuted,
  onSetNotifyLevel,
  onToggleHideMuted,
  onOpenServerSettings,
  onOpenPrivacy,
  onEditServerProfile,
  onCreateChannel,
  onCreateCategory,
  onLeaveServer,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<'none' | 'mute' | 'notify' | 'srvcfg'>('none');
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

  const canSeeServerCfg =
    permissions.administrator ||
    permissions.manageServer ||
    permissions.manageRoles ||
    permissions.viewAuditLog ||
    permissions.banMembers ||
    permissions.kickMembers;

  return (
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[115] w-[240px] bg-[#111214] border border-[#2b2d31] rounded-md shadow-[0_14px_34px_rgba(0,0,0,0.8)] py-1.5 px-1.5 text-[13px] font-medium text-[#dbdee1] select-none"
    >
      <button
        type="button"
        onClick={() => {
          onMarkAllRead();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span>Marcar como lida</span>
        <Check className="w-3.5 h-3.5 opacity-70" />
      </button>

      <div className="my-1 border-t border-[#2b2d31]" />

      {permissions.createInvite && (
        <button
          type="button"
          onClick={() => {
            onInviteToServer();
            onClose();
          }}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
        >
          <span>Convidar para o servidor</span>
          <Link2 className="w-3.5 h-3.5 opacity-75" />
        </button>
      )}

      <div className="my-1 border-t border-[#2b2d31]" />

      {/* Silenciar servidor */}
      <div className="relative" onMouseEnter={() => setSub('mute')} onMouseLeave={() => setSub('none')}>
        <button
          type="button"
          onClick={() => setSub((s) => (s === 'mute' ? 'none' : 'mute'))}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
        >
          <span>{isMuted ? 'Reativar servidor' : 'Silenciar servidor'}</span>
          <ChevronRight className="w-4 h-4" />
        </button>
        {sub === 'mute' && (
          <div className="absolute top-0 left-full ml-1 w-44 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl p-1 space-y-0.5 text-xs">
            {isMuted ? (
              <button
                type="button"
                onClick={() => {
                  onSetMuted(false);
                  onClose();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-[3px] hover:bg-[#23a55a] hover:text-white font-bold cursor-pointer"
              >
                Reativar servidor
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

      {/* Config. de notificação */}
      <div className="relative" onMouseEnter={() => setSub('notify')} onMouseLeave={() => setSub('none')}>
        <button
          type="button"
          onClick={() => setSub((s) => (s === 'notify' ? 'none' : 'notify'))}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer text-left"
        >
          <div>
            <div>Config. de notificação</div>
            <div className="text-[10px] text-[#949ba4]">
              {notifyLevel === 'all' ? 'Todas' : notifyLevel === 'mentions' ? 'Apenas @menções' : 'Nada'}
            </div>
          </div>
          <ChevronRight className="w-4 h-4" />
        </button>
        {sub === 'notify' && (
          <div className="absolute top-0 left-full ml-1 w-44 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl p-1 space-y-0.5 text-xs">
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

      <button
        type="button"
        onClick={() => {
          onToggleHideMuted();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span>Ocultar canais silenciados</span>
        <span
          className={`w-4 h-4 rounded-[3px] border flex items-center justify-center ${
            hideMutedChannels ? 'bg-[#5865f2] border-[#5865f2] text-white' : 'border-[#6d6f78]'
          }`}
        >
          {hideMutedChannels && <Check className="w-3 h-3 stroke-[3]" />}
        </span>
      </button>

      <div className="my-1 border-t border-[#2b2d31]" />

      {canSeeServerCfg && (
        <div className="relative" onMouseEnter={() => setSub('srvcfg')} onMouseLeave={() => setSub('none')}>
          <button
            type="button"
            onClick={() => {
              onOpenServerSettings('server');
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5 opacity-75" />
              Config. do servidor
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
          {sub === 'srvcfg' && (
            <div className="absolute top-0 left-full ml-1 w-48 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl p-1 space-y-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  onOpenServerSettings('server');
                  onClose();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
              >
                Perfil do servidor
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenServerSettings('roles');
                  onClose();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
              >
                Cargos & Permissões
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenServerSettings('members');
                  onClose();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
              >
                Membros
              </button>
              {permissions.viewAuditLog && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenServerSettings('audit');
                    onClose();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
                >
                  Registro de auditoria
                </button>
              )}
              {permissions.banMembers && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenServerSettings('bans');
                    onClose();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
                >
                  Banimentos
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          onOpenPrivacy();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 opacity-75" />
          Config. de privacidade
        </span>
      </button>

      <button
        type="button"
        onClick={() => {
          onEditServerProfile();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <UserIcon className="w-3.5 h-3.5 opacity-75" />
          Editar perfil por servidor
        </span>
      </button>

      {permissions.manageChannels && (
        <>
          <div className="my-1 border-t border-[#2b2d31]" />
          <button
            type="button"
            onClick={() => {
              onCreateChannel();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
          >
            <span>Criar canal</span>
            <Plus className="w-3.5 h-3.5 opacity-75" />
          </button>
          <button
            type="button"
            onClick={() => {
              onCreateCategory();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white cursor-pointer"
          >
            <span>Criar categoria</span>
            <FolderPlus className="w-3.5 h-3.5 opacity-75" />
          </button>
        </>
      )}

      <div className="my-1 border-t border-[#2b2d31]" />
      <button
        type="button"
        onClick={() => {
          onLeaveServer();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#f23f42] hover:bg-[#da373c] hover:text-white cursor-pointer font-bold"
      >
        <span>{isHosting ? 'Encerrar e sair do servidor' : 'Sair do servidor'}</span>
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
