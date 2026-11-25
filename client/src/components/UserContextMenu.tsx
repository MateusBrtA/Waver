import React, { useEffect, useRef, useState } from 'react';
import {
  AtSign,
  Ban,
  Check,
  ChevronRight,
  HeadphoneOff,
  Link2,
  MessageSquare,
  MicOff,
  MonitorCog,
  Phone,
  Shield,
  ShieldAlert,
  User as UserIcon,
  UserMinus,
  Volume2,
} from 'lucide-react';
import { Channel, Role, RolePermissions, User } from '../types';

export interface ContextMenuTarget {
  user: User;
  socketId?: string;
  inVoiceChannelId?: string | null;
  isSharingScreen?: boolean;
  x: number;
  y: number;
}

interface UserContextMenuProps {
  target: ContextMenuTarget;
  selfUser: User;
  roles: Role[];
  permissions?: RolePermissions;
  voiceChannels: Channel[];
  contextScope?: 'dm' | 'server';
  hasServer?: boolean;
  userVolume: number; // 0 - 2
  isLocallyMuted: boolean;
  isBlocked: boolean;
  canInviteRemoteControl: boolean; // true when self is sharing screen & target is in same call
  canRequestRemoteControl: boolean; // true when target is sharing screen & self is in same call
  onVolumeChange: (val: number) => void;
  onViewProfile: () => void;
  onMention: () => void;
  onOpenDm: () => void;
  onStartPrivateCall: () => void;
  onToggleLocalMute: () => void;
  onToggleBlock: () => void;
  onCopyInvite: () => void;
  onInviteRemoteControl: () => void;
  onRequestRemoteControl: () => void;
  onToggleRole: (roleId: string, hasRole: boolean) => void;
  onMoveToVoice: (channelId: string) => void;
  onToggleServerMute: () => void;
  onToggleServerDeafen: () => void;
  onKickUser?: () => void;
  onBanUser: () => void;
  onClose: () => void;
}

export const UserContextMenu: React.FC<UserContextMenuProps> = ({
  target,
  selfUser,
  roles,
  permissions,
  voiceChannels,
  contextScope = 'server',
  hasServer = true,
  userVolume,
  isLocallyMuted,
  isBlocked,
  canInviteRemoteControl,
  canRequestRemoteControl,
  onVolumeChange,
  onViewProfile,
  onMention,
  onOpenDm,
  onStartPrivateCall,
  onToggleLocalMute,
  onToggleBlock,
  onCopyInvite,
  onInviteRemoteControl,
  onRequestRemoteControl,
  onToggleRole,
  onMoveToVoice,
  onToggleServerMute,
  onToggleServerDeafen,
  onKickUser,
  onBanUser,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<'none' | 'roles' | 'move'>('none');
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  const isSelf = target.user.id === selfUser.id;
  const inServerScope = contextScope === 'server' && hasServer;
  const isMod = inServerScope && (selfUser.role === 'host' || Boolean(selfUser.roleIds?.includes('role-mod')));
  const permManageRoles = inServerScope && (permissions ? permissions.manageRoles : isMod);
  const permMove = inServerScope && (permissions ? permissions.moveMembers : isMod);
  const permMute = inServerScope && (permissions ? permissions.muteMembers : isMod);
  const permDeafen = inServerScope && (permissions ? permissions.deafenMembers : isMod);
  const permKick = inServerScope && (permissions ? permissions.kickMembers : isMod);
  const permBan = inServerScope && (permissions ? permissions.banMembers : isMod);
  const targetRoleIds = target.user.roleIds || [];

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 12;
    const maxTop = window.innerHeight - rect.height - 12;
    setPos({
      left: Math.max(8, Math.min(target.x, maxLeft)),
      top: Math.max(8, Math.min(target.y, maxTop)),
    });
  }, [target.x, target.y]);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const submenuOnLeft = pos.left > window.innerWidth - 460;

  return (
    <div
      ref={menuRef}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[100] w-[238px] bg-[#111214] border border-[#2b2d31] rounded-md shadow-[0_12px_32px_rgba(0,0,0,0.75)] py-1.5 px-1.5 text-[13px] font-medium text-[#dbdee1] select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Basic actions (Print 1 top block) */}
      <button
        type="button"
        onClick={() => {
          onViewProfile();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white transition cursor-pointer"
      >
        <span>Perfil</span>
        <UserIcon className="w-3.5 h-3.5 opacity-75" />
      </button>

      <button
        type="button"
        onClick={() => {
          onMention();
          onClose();
        }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white transition cursor-pointer"
      >
        <span>Mencionar</span>
        <AtSign className="w-3.5 h-3.5 opacity-75" />
      </button>

      {!isSelf && (
        <>
          <button
            type="button"
            onClick={() => {
              onOpenDm();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white transition cursor-pointer"
          >
            <span>Mensagem Privada</span>
            <MessageSquare className="w-3.5 h-3.5 opacity-75" />
          </button>

          <button
            type="button"
            onClick={() => {
              onStartPrivateCall();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#23a55a] hover:text-white transition cursor-pointer"
          >
            <span>Chamada Privada</span>
            <Phone className="w-3.5 h-3.5 opacity-75" />
          </button>
        </>
      )}

      {/* Remote Control (AnyDesk / TeamViewer) Options */}
      {!isSelf && (canInviteRemoteControl || canRequestRemoteControl) && (
        <>
          <div className="my-1 border-t border-[#2b2d31]" />
          {canInviteRemoteControl && (
            <button
              type="button"
              onClick={() => {
                onInviteRemoteControl();
                onClose();
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#4ade80] hover:bg-[#23a55a] hover:text-white transition cursor-pointer"
            >
              <span>Convidar Controle (AnyDesk)</span>
              <MonitorCog className="w-4 h-4 shrink-0" />
            </button>
          )}
          {canRequestRemoteControl && (
            <button
              type="button"
              onClick={() => {
                onRequestRemoteControl();
                onClose();
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#a5b4fc] hover:bg-[#5865f2] hover:text-white transition cursor-pointer"
            >
              <span>Pedir Controle da Tela</span>
              <MonitorCog className="w-4 h-4 shrink-0" />
            </button>
          )}
        </>
      )}

      {/* Local Audio Volume & Mute */}
      {!isSelf && (
        <>
          <div className="my-1 border-t border-[#2b2d31]" />
          <div className="px-2.5 py-1.5 space-y-1">
            <div className="flex items-center justify-between text-[12px] text-[#b5bac1]">
              <span className="flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5" />
                Volume do usuário
              </span>
              <span className="font-mono text-[11px] text-white">{Math.round(userVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={userVolume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-full accent-[#5865f2] cursor-pointer h-1.5"
            />
          </div>

          <button
            type="button"
            onClick={onToggleLocalMute}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white transition cursor-pointer"
          >
            <span>Silenciar</span>
            <span
              className={`w-4 h-4 rounded-[3px] border flex items-center justify-center ${
                isLocallyMuted ? 'bg-[#5865f2] border-[#5865f2] text-white' : 'border-[#80848e]'
              }`}
            >
              {isLocallyMuted && <Check className="w-3 h-3 stroke-[3]" />}
            </span>
          </button>
        </>
      )}

      {hasServer && (
        <button
          type="button"
          onClick={() => {
            onCopyInvite();
            onClose();
          }}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white transition cursor-pointer"
        >
          <span>Convidar para o servidor</span>
          <Link2 className="w-3.5 h-3.5 opacity-75" />
        </button>
      )}

      {/* Roles & Move To Voice Submenus (Strictly Server Scope only!) */}
      {(permManageRoles || (permMove && target.inVoiceChannelId)) && (
        <>
          <div className="my-1 border-t border-[#2b2d31]" />

          {/* Cargos > */}
          {permManageRoles && (
            <div
              className="relative"
              onMouseEnter={() => setSubmenu('roles')}
              onMouseLeave={() => setSubmenu('none')}
            >
              <button
                type="button"
                onClick={() => setSubmenu((s) => (s === 'roles' ? 'none' : 'roles'))}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white transition cursor-pointer"
              >
                <span>Cargos</span>
                <ChevronRight className="w-4 h-4" />
              </button>

              {submenu === 'roles' && (
                <div
                  className={`absolute top-0 ${
                    submenuOnLeft ? 'right-full mr-1' : 'left-full ml-1'
                  } w-48 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl p-1.5 space-y-0.5`}
                >
                  {roles
                    .filter((r) => r.id !== 'role-host' && !r.isEveryone)
                    .map((role) => {
                      const active = targetRoleIds.includes(role.id);
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => onToggleRole(role.id, active)}
                          className="w-full flex items-center justify-between px-2 py-1.5 rounded-[3px] hover:bg-[#35373c] text-xs cursor-pointer"
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                            <span className="truncate">{role.name}</span>
                          </span>
                          <span
                            className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 ${
                              active ? 'bg-[#5865f2] border-[#5865f2] text-white' : 'border-[#6d6f78]'
                            }`}
                          >
                            {active && <Check className="w-3 h-3 stroke-[3]" />}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* Mover para > */}
          {permMove && target.inVoiceChannelId && (
            <div
              className="relative"
              onMouseEnter={() => setSubmenu('move')}
              onMouseLeave={() => setSubmenu('none')}
            >
              <button
                type="button"
                onClick={() => setSubmenu((s) => (s === 'move' ? 'none' : 'move'))}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white transition cursor-pointer"
              >
                <span>Mover para</span>
                <ChevronRight className="w-4 h-4" />
              </button>

              {submenu === 'move' && (
                <div
                  className={`absolute top-0 ${
                    submenuOnLeft ? 'right-full mr-1' : 'left-full ml-1'
                  } w-48 bg-[#111214] border border-[#2b2d31] rounded-md shadow-2xl p-1.5 space-y-0.5`}
                >
                  {voiceChannels.map((vc) => {
                    const isCurrent = vc.id === target.inVoiceChannelId;
                    return (
                      <button
                        key={vc.id}
                        type="button"
                        disabled={isCurrent}
                        onClick={() => {
                          onMoveToVoice(vc.id);
                          onClose();
                        }}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded-[3px] hover:bg-[#4752c4] hover:text-white disabled:opacity-45 text-xs cursor-pointer"
                      >
                        <span className="truncate">🔊 {vc.name}</span>
                        {isCurrent && <span className="text-[10px]">Atual</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Block + Server Moderation Red Block (Print 1 bottom block!) */}
      {!isSelf && (
        <>
          <div className="my-1 border-t border-[#2b2d31]" />
          <button
            type="button"
            onClick={() => {
              onToggleBlock();
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#f23f42] hover:bg-[#da373c] hover:text-white transition cursor-pointer"
          >
            <span>{isBlocked ? 'Desbloquear' : 'Bloquear'}</span>
            <ShieldAlert className="w-3.5 h-3.5" />
          </button>

          {inServerScope && (
            <>
              {permMute && (
                <button
                  type="button"
                  onClick={onToggleServerMute}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#e87a7a] hover:bg-[#da373c] hover:text-white transition cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <MicOff className="w-3.5 h-3.5" />
                    Silenciar voz no servidor
                  </span>
                  <span
                    className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 ${
                      target.user.serverMuted ? 'bg-[#da373c] border-[#da373c] text-white' : 'border-[#80848e]'
                    }`}
                  >
                    {target.user.serverMuted && <Check className="w-3 h-3 stroke-[3]" />}
                  </span>
                </button>
              )}

              {permDeafen && (
                <button
                  type="button"
                  onClick={onToggleServerDeafen}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#e87a7a] hover:bg-[#da373c] hover:text-white transition cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <HeadphoneOff className="w-3.5 h-3.5" />
                    Desativar áudio no servidor
                  </span>
                  <span
                    className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 ${
                      target.user.serverDeafened ? 'bg-[#da373c] border-[#da373c] text-white' : 'border-[#80848e]'
                    }`}
                  >
                    {target.user.serverDeafened && <Check className="w-3 h-3 stroke-[3]" />}
                  </span>
                </button>
              )}

              {permKick && target.user.role !== 'host' && onKickUser && (
                <button
                  type="button"
                  onClick={() => {
                    onKickUser();
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#f0b232] font-semibold hover:bg-[#f0b232] hover:text-black transition cursor-pointer"
                >
                  <span>Expulsar do servidor</span>
                  <UserMinus className="w-3.5 h-3.5" />
                </button>
              )}

              {permBan && target.user.role !== 'host' && (
                <button
                  type="button"
                  onClick={() => {
                    onBanUser();
                    onClose();
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[3px] text-[#f23f42] font-bold hover:bg-[#da373c] hover:text-white transition cursor-pointer"
                >
                  <span>Banir do servidor</span>
                  <Ban className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </>
      )}

      {isSelf && isMod && inServerScope && (
        <>
          <div className="my-1 border-t border-[#2b2d31]" />
          <div className="px-2.5 py-1 text-[11px] text-[#949ba4] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-[#f0b232]" />
            Você é {selfUser.role === 'host' ? 'Host' : 'Moderador'}
          </div>
        </>
      )}
    </div>
  );
};
