import React from 'react';
import { Crown, Gamepad2, Headphones, Volume2 } from 'lucide-react';
import { Role, User, VoiceParticipant } from '../types';
import { Avatar, NAME_STYLES } from './Avatar';

interface MemberListProps {
  members: User[];
  roles: Role[];
  voiceRooms: Record<string, VoiceParticipant[]>;
  soundboardActiveUserIds?: Set<string>;
  serverUrl: string;
  onMemberClick: (user: User, e: React.MouseEvent) => void;
  onMemberContextMenu: (user: User, e: React.MouseEvent) => void;
}

export const MemberList: React.FC<MemberListProps> = ({
  members,
  roles,
  voiceRooms,
  soundboardActiveUserIds,
  serverUrl,
  onMemberClick,
  onMemberContextMenu,
}) => {
  const voiceUserIds = new Set<string>();
  for (const list of Object.values(voiceRooms)) {
    for (const p of list) voiceUserIds.add(p.userId);
  }

  const online = members.filter((m) => m.online);
  const offline = members.filter((m) => !m.online);

  const getPrimaryRoleColor = (u: User): string | undefined => {
    const rids = u.roleIds || [];
    for (const rid of rids) {
      const role = roles.find((r) => r.id === rid);
      if (role) return role.color;
    }
    return undefined;
  };

  return (
    <aside className="w-60 shrink-0 bg-[#2b2d31] pc-member-list border-l border-white/10 overflow-y-auto px-2.5 py-4 space-y-5 hidden lg:block select-none">
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4] px-2 mb-1.5">
          Disponível — {online.length}
        </h4>
        <div className="space-y-0.5">
          {online.map((m) => {
            const inVoice = voiceUserIds.has(m.id);
            const roleColor = getPrimaryRoleColor(m);
            const nameStyle = m.nameStyle && m.nameStyle !== 'default' ? NAME_STYLES[m.nameStyle]?.className : '';

            return (
              <div
                key={m.id}
                onClick={(e) => onMemberClick(m, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMemberContextMenu(m, e);
                }}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-[#35373c] transition cursor-pointer group"
              >
                <Avatar
                  name={m.displayName}
                  avatarUrl={m.avatarUrl}
                  color={m.avatarColor}
                  decoration={m.avatarDecoration}
                  serverUrl={serverUrl}
                  size="sm"
                  online={true}
                  statusType={m.statusType}
                  soundboardActive={Boolean(soundboardActiveUserIds?.has(m.id))}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span
                      className={`text-sm font-medium truncate ${nameStyle || ''}`}
                      style={!nameStyle && roleColor ? { color: roleColor } : undefined}
                    >
                      {m.displayName}
                    </span>
                    {m.role === 'host' && (
                      <span title="Host do Servidor">
                        <Crown className="w-3.5 h-3.5 text-[#f0b232] shrink-0" />
                      </span>
                    )}
                  </div>

                  {/* Subtitle matching Print 4: Game Activity > Custom Status > In Voice */}
                  {m.currentActivity ? (
                    <div className="flex items-center gap-1 text-[11px] text-[#949ba4] truncate">
                      {m.currentActivity.category === 'music' ? (
                        <Headphones className="w-3 h-3 text-[#23a55a] shrink-0" />
                      ) : (
                        <Gamepad2 className="w-3 h-3 text-[#23a55a] shrink-0" />
                      )}
                      <span className="truncate">{m.currentActivity.name}</span>
                    </div>
                  ) : m.customStatusText || m.customStatusEmoji ? (
                    <div className="text-[11px] text-[#949ba4] truncate">
                      {m.customStatusEmoji ? `${m.customStatusEmoji} ` : ''}
                      {m.customStatusText}
                    </div>
                  ) : inVoice ? (
                    <div className="flex items-center gap-1 text-[11px] text-[#23a55a] font-semibold">
                      <Volume2 className="w-3 h-3" />
                      Em chamada
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {offline.length > 0 && (
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4] px-2 mb-1.5">
            Offline — {offline.length}
          </h4>
          <div className="space-y-0.5 opacity-55">
            {offline.map((m) => (
              <div
                key={m.id}
                onClick={(e) => onMemberClick(m, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMemberContextMenu(m, e);
                }}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-[#35373c] transition cursor-pointer"
              >
                <Avatar
                  name={m.displayName}
                  avatarUrl={m.avatarUrl}
                  color={m.avatarColor}
                  serverUrl={serverUrl}
                  size="sm"
                  online={false}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-[#b5bac1] truncate">{m.displayName}</span>
                    {m.role === 'host' && <Crown className="w-3 h-3 text-[#f0b232] shrink-0" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};
