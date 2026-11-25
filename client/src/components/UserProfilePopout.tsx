import React, { useEffect, useRef, useState } from 'react';
import {
  Crown,
  Edit3,
  MessageSquare,
  MoreHorizontal,
  Phone,
} from 'lucide-react';
import { resolveMediaUrl } from '../lib/api';
import { Role, User } from '../types';
import { Avatar, NAME_STYLES } from './Avatar';
import { ConnectionIcon, getConnectionInfo } from './ConnectionBadge';
import { ProfileEffectLayer } from './ProfileEffect';

interface UserProfilePopoutProps {
  user: User;
  selfUser: User;
  roles: Role[];
  serverUrl: string;
  contextScope?: 'dm' | 'server';
  anchor: { x: number; y: number };
  onClose: () => void;
  onOpenFullProfile: (editMode?: boolean) => void;
  onOpenDm: () => void;
  onStartPrivateCall: () => void;
}

export const UserProfilePopout: React.FC<UserProfilePopoutProps> = ({
  user,
  selfUser,
  roles,
  serverUrl,
  contextScope = 'server',
  anchor,
  onClose,
  onOpenFullProfile,
  onOpenDm,
  onStartPrivateCall,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  const isSelf = user.id === selfUser.id;
  const bannerFullUrl = user.bannerUrl ? resolveMediaUrl(serverUrl, user.bannerUrl) : '';
  const userRoles = contextScope === 'server' ? roles.filter((r) => (user.roleIds || []).includes(r.id)) : [];
  const nameStyleObj = NAME_STYLES[user.nameStyle || 'default'] || NAME_STYLES.default;
  const recentGames = (user.recentActivities || []).filter((a) => a.category === 'game').slice(0, 4);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = anchor.x - rect.width - 14;
    if (left < 12) left = Math.min(anchor.x + 14, window.innerWidth - rect.width - 12);
    const top = Math.max(12, Math.min(anchor.y - 20, window.innerHeight - rect.height - 12));
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={cardRef}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[95] w-[312px] bg-[#111214] border border-[#2b2d31] rounded-lg shadow-[0_16px_42px_rgba(0,0,0,0.75)] overflow-hidden select-none animate-fade-up *:relative *:z-[1]"
    >
      <ProfileEffectLayer effect={user.profileEffect} bgUrl={user.profileBgUrl} serverUrl={serverUrl} />
      {/* Top Banner (Print 4 style!) */}
      <div
        className="h-24 w-full relative bg-cover bg-center"
        style={{
          backgroundColor: user.bannerColor || user.avatarColor || '#5865F2',
          backgroundImage: bannerFullUrl ? `url(${bannerFullUrl})` : undefined,
        }}
      >
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenFullProfile(false);
          }}
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center transition cursor-pointer"
          title="Ver perfil completo"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Avatar + Floating Thought-Bubble Status (Print 4 iconic detail!) */}
      <div className="px-4 relative">
        <div className="flex items-end gap-2 -mt-10">
          <div
            onClick={() => {
              onClose();
              onOpenFullProfile(false);
            }}
            className="rounded-full p-[5px] bg-[#111214] cursor-pointer hover:opacity-95 transition"
          >
            <Avatar
              name={user.displayName}
              avatarUrl={user.avatarUrl}
              color={user.avatarColor}
              decoration={user.avatarDecoration}
              serverUrl={serverUrl}
              size="xl"
              online={Boolean(user.online)}
              statusType={user.statusType}
              borderBg="#111214"
            />
          </div>

          {/* Thought Bubble Floating Out of Avatar! */}
          {(user.customStatusText || user.customStatusEmoji) && (
            <div className="relative mb-2 max-w-[175px]">
              {/* Two tiny thought dots leading from avatar */}
              <span className="absolute -left-2.5 top-1.5 w-2 h-2 rounded-full bg-[#232428] border border-[#35373c]" />
              <span className="absolute -left-1 top-3 w-3 h-3 rounded-full bg-[#232428] border border-[#35373c]" />
              <div className="relative bg-[#232428] border border-[#35373c] rounded-lg px-3 py-1.5 shadow-lg text-xs text-white font-medium flex items-center gap-1.5">
                {user.customStatusEmoji && <span className="shrink-0">{user.customStatusEmoji}</span>}
                <span className="truncate">{user.customStatusText}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Profile Content */}
      <div className="p-4 pt-2.5 space-y-3">
        {/* Display Name, @username, pronouns & Badges */}
        <div>
          <h3 className={`text-lg font-bold leading-tight truncate ${nameStyleObj.className}`}>
            {user.displayName}
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-[#b5bac1] mt-0.5">
            <span>@{user.username}</span>
            {user.pronouns && (
              <>
                <span>•</span>
                <span className="truncate">{user.pronouns}</span>
              </>
            )}
          </div>

          {user.bio && <p className="text-xs text-[#dbdee1] mt-1.5 leading-snug line-clamp-2">{user.bio}</p>}

          {user.role === 'host' && contextScope === 'server' && (
            <div className="inline-flex items-center mt-2 bg-[#1e1f22] px-1.5 py-1 rounded-md" title="Dono do servidor">
              <Crown className="w-4 h-4 text-[#f0b232]" />
            </div>
          )}

          {(user.connections || []).length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              {(user.connections || []).slice(0, 8).map((c, i) => {
                const info = getConnectionInfo(c);
                return (
                  <button
                    key={i}
                    type="button"
                    title={`${info.meta.name}: ${info.label}`}
                    onClick={() => info.href && window.open(info.href, '_blank', 'noopener,noreferrer')}
                    className="p-1 rounded hover:bg-[#2b2d31] cursor-pointer"
                  >
                    <ConnectionIcon connection={c} className="w-5 h-5" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Current Activity OR Game Collection Strip (Print 4!) */}
        {user.currentActivity ? (
          <div className="bg-[#1e1f22] rounded-lg p-2.5 border border-[#2b2d31] flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
              style={{ backgroundColor: `${user.currentActivity.color}25` }}
            >
              {user.currentActivity.icon}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#23a55a]">
                {user.currentActivity.category === 'music' ? 'Ouvindo agora' : 'Jogando agora'}
              </div>
              <div className="text-xs font-bold text-white truncate">{user.currentActivity.name}</div>
            </div>
          </div>
        ) : recentGames.length > 0 ? (
          <div
            onClick={() => {
              onClose();
              onOpenFullProfile(false);
            }}
            className="bg-[#1e1f22] hover:bg-[#232428] rounded-lg px-3 py-2 border border-[#2b2d31] flex items-center justify-between cursor-pointer transition"
          >
            <span className="text-xs font-semibold text-[#dbdee1]">Coleção de jogos</span>
            <div className="flex items-center gap-1">
              {recentGames.map((g) => (
                <span
                  key={g.name}
                  title={g.name}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-sm"
                  style={{ backgroundColor: `${g.color}30` }}
                >
                  {g.icon}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Roles Pills (Print 4!) */}
        {userRoles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {userRoles.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#1e1f22] border border-[#2b2d31] text-[11px] font-semibold text-[#dbdee1]"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                {r.name}
              </span>
            ))}
          </div>
        )}

        {/* Bottom Action Buttons */}
        {isSelf ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFullProfile(true);
            }}
            className="w-full py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Editar perfil
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenDm();
              }}
              className="flex-1 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Mensagem
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onStartPrivateCall();
              }}
              className="p-2 bg-[#23a55a] hover:bg-[#1e8e4c] text-white rounded-md transition cursor-pointer"
              title="Iniciar chamada privada"
            >
              <Phone className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFullProfile(false);
              }}
              className="px-2.5 py-2 bg-[#2b2d31] hover:bg-[#383a40] text-[#dbdee1] text-xs font-semibold rounded-md transition cursor-pointer"
            >
              Perfil
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
