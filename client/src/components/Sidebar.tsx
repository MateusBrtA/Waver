import React, { useState } from 'react';
import {
  BellOff,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Copy,
  Hash,
  HeadphoneOff,
  Headphones,
  KanbanSquare,
  Lock,
  LogOut,
  Mic,
  MicOff,
  MonitorPlay,
  Music,
  Phone,
  PhoneOff,
  Pin,
  Plus,
  Radar,
  RefreshCw,
  Server,
  Settings,
  Signal,
  Star,
  Trash2,
  UserCheck,
  Users,
  Volume2,
  Zap,
} from 'lucide-react';
import { resolveMediaUrl } from '../lib/api';
import {
  AppMode,
  AudioSettings,
  Channel,
  ChannelCategory,
  HostStatus,
  LanPeer,
  PrivateGroup,
  RolePermissions,
  ServerInfo,
  User,
  VoiceParticipant,
} from '../types';
import { AudioQuickPopout } from './AudioQuickPopout';
import { Avatar } from './Avatar';
import { SettingsTabId } from './SettingsModal';

interface SidebarProps {
  server: ServerInfo | null;
  serverUrl: string;
  user: User;
  members: User[];
  lanPeers?: LanPeer[];
  appMode: AppMode;
  navArea: 'server' | 'dms';
  activeDmUserId: string | null;
  unreadDmByUser: Record<string, number>;
  dmGroups?: PrivateGroup[];
  activeGroupId?: string | null;
  unreadByGroup?: Record<string, number>;
  hostStatus: HostStatus | null;
  channels: Channel[];
  categories?: ChannelCategory[];
  permissions?: RolePermissions;
  favoriteChannelIds?: Set<string>;
  pinnedChannelIds?: Set<string>;
  mutedChannelIds?: Set<string>;
  hideMutedChannels?: boolean;
  activeTextChannelId: string;
  activeVoiceChannelId: string | null;
  activeVoiceLabel: string;
  viewMode: 'chat' | 'voice';
  voiceRooms: Record<string, VoiceParticipant[]>;
  speakingSocketIds: Set<string>;
  soundboardActiveUserIds?: Set<string>;
  selfSocketId: string;
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  audioSettings: AudioSettings;
  onUpdateAudioSettings: (next: AudioSettings) => void;
  onSelectTextChannel: (channelId: string) => void;
  onSelectDmUser: (userId: string) => void;
  onSelectGroup?: (groupId: string) => void;
  onOpenCreateGroup?: () => void;
  onOpenGroupSettings?: (group: PrivateGroup) => void;
  onStartGroupCall?: (group: PrivateGroup) => void;
  onStartPrivateCall: (targetUser: User) => void;
  onScanLanPeers?: () => void;
  onJoinOrFocusVoiceChannel: (channelId: string) => void;
  onLeaveVoice: () => void;
  onLeaveServer?: () => void;
  onCreateChannel: (type: 'text' | 'voice', categoryId?: string | null) => void;
  onEditChannel?: (channel: Channel) => void;
  onDeleteChannel: (channel: Channel) => void;
  onChannelContextMenu?: (channel: Channel, e: React.MouseEvent) => void;
  onServerContextMenu?: (e: React.MouseEvent) => void;
  onOpenServerTrello?: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  onOpenScreenShare: () => void;
  onOpenVoiceDrawer: (tab: 'soundboard' | 'music' | 'video') => void;
  onOpenModeSwitcher: () => void;
  onOpenServerDirectory?: () => void;
  onOpenSelfProfilePopout: (e: React.MouseEvent) => void;
  onUserClick: (user: User, e: React.MouseEvent) => void;
  onUserContextMenu: (user: User, e: React.MouseEvent, meta?: { socketId?: string; inVoiceChannelId?: string; isSharingScreen?: boolean }) => void;
  onOpenSettings: (tab?: SettingsTabId) => void;
}

function lanPeerToUser(peer: LanPeer): User {
  return {
    id: peer.peerId,
    username: peer.username,
    displayName: peer.displayName,
    avatarColor: peer.avatarColor || '#5865F2',
    avatarUrl: peer.avatarUrl,
    customStatusText: peer.customStatusText,
    customStatusEmoji: peer.customStatusEmoji,
    currentActivity: peer.currentActivity,
    online: true,
    statusType: 'online',
    role: 'member',
    roleIds: [],
    createdAt: Date.now(),
  };
}

export const Sidebar: React.FC<SidebarProps> = ({
  server,
  serverUrl,
  user,
  members,
  lanPeers = [],
  appMode,
  navArea,
  activeDmUserId,
  unreadDmByUser,
  dmGroups = [],
  activeGroupId = null,
  unreadByGroup = {},
  hostStatus,
  channels,
  categories = [],
  permissions,
  favoriteChannelIds,
  pinnedChannelIds,
  mutedChannelIds,
  hideMutedChannels = false,
  activeTextChannelId,
  activeVoiceChannelId,
  activeVoiceLabel,
  viewMode,
  voiceRooms,
  speakingSocketIds,
  soundboardActiveUserIds,
  selfSocketId,
  muted,
  deafened,
  cameraOn,
  screenSharing,
  audioSettings,
  onUpdateAudioSettings,
  onSelectTextChannel,
  onSelectDmUser,
  onSelectGroup,
  onOpenCreateGroup,
  onOpenGroupSettings,
  onStartGroupCall,
  onStartPrivateCall,
  onScanLanPeers,
  onJoinOrFocusVoiceChannel,
  onLeaveVoice,
  onLeaveServer,
  onCreateChannel,
  onEditChannel,
  onDeleteChannel,
  onChannelContextMenu,
  onServerContextMenu,
  onOpenServerTrello,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  onOpenScreenShare,
  onOpenVoiceDrawer,
  onOpenModeSwitcher,
  onOpenServerDirectory,
  onOpenSelfProfilePopout,
  onUserClick,
  onUserContextMenu,
  onOpenSettings,
}) => {
  const [textOpen, setTextOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(true);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => new Set());
  const [copiedIp, setCopiedIp] = useState(false);
  const [audioPopout, setAudioPopout] = useState<'none' | 'mic' | 'output'>('none');

  const canManageChannels = Boolean(server) && (Boolean(permissions?.manageChannels) || user.role === 'host');
  const canCreate = Boolean(server) && (canManageChannels || server?.allowMembersCreateChannels !== false);

  const isChannelVisibleInSidebar = (ch: Channel) => {
    if (!hideMutedChannels || !mutedChannelIds?.has(ch.id)) return true;
    if (activeTextChannelId === ch.id || activeVoiceChannelId === ch.id) return true;
    if (ch.type === 'voice' && (voiceRooms[ch.id]?.length || 0) > 0) return true;
    return false;
  };

  const visibleChannels = channels.filter(isChannelVisibleInSidebar);
  const pinnedOrFavChannels = visibleChannels.filter(
    (c) => favoriteChannelIds?.has(c.id) || pinnedChannelIds?.has(c.id)
  );
  const uncategorizedText = visibleChannels.filter((c) => c.type === 'text' && !c.categoryId);
  const uncategorizedVoice = visibleChannels.filter((c) => c.type === 'voice' && !c.categoryId);
  const sortedCategories = [...categories].sort((a, b) => (a.position || 0) - (b.position || 0));

  const toggleCategory = (catId: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };
  const isHosting = Boolean(server) && appMode === 'host' && Boolean(hostStatus?.running);
  const firstAddr = hostStatus?.addresses?.[0];
  const primaryShareUrl = hostStatus?.tunnelUrl
    ? hostStatus.tunnelUrl
    : firstAddr
    ? hostStatus.port && hostStatus.port !== 3000
      ? `${firstAddr.address}:${hostStatus.port}`
      : firstAddr.address
    : '';

  const otherMembers = server ? members.filter((m) => m.id !== user.id) : [];
  const lanOnlyPeers = server
    ? lanPeers.filter((p) => !otherMembers.some((m) => m.username.toLowerCase() === p.username.toLowerCase()))
    : lanPeers;

  const handleCopyShareUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!primaryShareUrl) return;
    navigator.clipboard.writeText(primaryShareUrl).catch(() => {});
    setCopiedIp(true);
    window.setTimeout(() => setCopiedIp(false), 1800);
  };

  return (
    <aside className="w-60 shrink-0 bg-[#2b2d31] pc-sidebar flex flex-col select-none h-full relative">
      {/* Header */}
      {navArea === 'dms' || !server ? (
        <div className="h-12 px-4 flex items-center justify-between border-b border-[#1f2023] shadow-[0_1px_0_rgba(4,4,5,0.2)] shrink-0">
          <span className="font-bold text-[15px] text-[#f2f3f5]">Mensagens Diretas</span>
          <span title="Conversas Privadas LAN P2P & Cofre AES-256-GCM (sem cargos de servidor)">
            <Lock className="w-3.5 h-3.5 text-[#23a55a]" />
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpenSettings('server')}
          onContextMenu={(e) => {
            if (!onServerContextMenu) return;
            e.preventDefault();
            e.stopPropagation();
            onServerContextMenu(e);
          }}
          className="h-12 px-4 flex items-center justify-between border-b border-[#1f2023] shadow-[0_1px_0_rgba(4,4,5,0.2)] hover:bg-[#35373c] transition text-left cursor-pointer shrink-0"
          title="Configurações do Servidor (clique direito para menu rápido)"
        >
          <span className="font-bold text-[15px] text-[#f2f3f5] truncate">{server.name}</span>
          <ChevronDown className="w-4 h-4 text-[#b5bac1] shrink-0" />
        </button>
      )}

      {/* Automatic Host / Connected Client Status Bar + Trello Shortcut (Only inside a Server) */}
      {navArea === 'server' && server && (
        <div className="px-2.5 pt-2.5 pb-1 space-y-1.5">
          <div
            onClick={isHosting ? onOpenModeSwitcher : undefined}
            className={`rounded-md px-2.5 py-2 border transition flex items-center justify-between gap-1.5 ${
              isHosting
                ? 'bg-[#23a55a]/12 hover:bg-[#23a55a]/20 border-[#23a55a]/35 cursor-pointer'
                : 'bg-[#1e1f22]/70 border-[#3f4147]/60'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {isHosting ? (
                <Server className="w-3.5 h-3.5 text-[#23a55a] shrink-0" />
              ) : (
                <UserCheck className="w-3.5 h-3.5 text-[#5865f2] shrink-0" />
              )}
              <div className="min-w-0">
                <div className={`text-[11px] font-bold ${isHosting ? 'text-[#4ade80]' : 'text-[#dbdee1]'}`}>
                  {isHosting ? 'Hospedando Servidor' : 'Conectado no Servidor'}
                </div>
                <div className="text-[10px] text-[#949ba4] truncate font-mono">
                  {isHosting && primaryShareUrl
                    ? primaryShareUrl.replace(/^https?:\/\//, '')
                    : serverUrl.replace(/^https?:\/\//, '')}
                </div>
              </div>
            </div>

            {isHosting && primaryShareUrl ? (
              <button
                type="button"
                onClick={handleCopyShareUrl}
                className="p-1 rounded bg-[#1e1f22] hover:bg-[#23a55a] text-[#dbdee1] hover:text-white transition cursor-pointer shrink-0"
                title="Copiar IPv4 do servidor"
              >
                {copiedIp ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            ) : onLeaveServer ? (
              <button
                type="button"
                onClick={onLeaveServer}
                className="p-1 rounded bg-[#1e1f22] hover:bg-[#da373c] text-[#b5bac1] hover:text-white transition cursor-pointer shrink-0"
                title="Sair deste servidor"
              >
                <LogOut className="w-3 h-3" />
              </button>
            ) : null}
          </div>

          {onOpenServerTrello && permissions?.useTrello !== false && (
            <button
              type="button"
              onClick={onOpenServerTrello}
              className="w-full px-2.5 py-1.5 rounded-md bg-[#181c26] hover:bg-[#5865f2]/20 border border-[#5865f2]/30 text-xs font-semibold text-[#dbdee1] hover:text-white flex items-center justify-between transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <KanbanSquare className="w-3.5 h-3.5 text-[#5865f2]" />
                Trello & Projetos
              </span>
              <span className="text-[10px] text-[#949ba4]">Abrir</span>
            </button>
          )}
        </div>
      )}

      {/* MIDDLE LIST: Either DMs list (Grupos + LAN P2P + Server Members) OR Server Channels */}
      <div className="flex-1 overflow-y-auto px-2 py-2.5 space-y-4">
        {navArea === 'dms' || !server ? (
          <div className="space-y-3">
            {/* Private Groups Section (with Custom Group Image & Multi-Person Group Calls) */}
            <div className="space-y-1">
              <div className="px-2 pb-1 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4] flex items-center gap-1">
                  <Users className="w-3 h-3 text-[#5865f2]" />
                  Grupos Privados ({dmGroups.length})
                </span>
                {onOpenCreateGroup && (
                  <button
                    type="button"
                    onClick={onOpenCreateGroup}
                    className="p-0.5 text-[#949ba4] hover:text-white cursor-pointer flex items-center gap-0.5 text-[10px] font-semibold"
                    title="Criar Grupo Privado e Chamada em Grupo"
                  >
                    <Plus className="w-3.5 h-3.5" /> Criar
                  </button>
                )}
              </div>

              {dmGroups.map((g) => {
                const selected = activeGroupId === g.id;
                const unread = unreadByGroup[g.id] || 0;
                const gIcon = g.iconUrl ? resolveMediaUrl(g.hostP2pUrl || serverUrl, g.iconUrl) : '';
                return (
                  <div
                    key={g.id}
                    onClick={() => onSelectGroup?.(g.id)}
                    className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer transition ${
                      selected
                        ? 'bg-[#404249] text-white'
                        : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#5865f2] to-[#eb459e] flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden">
                        {gIcon ? <img src={gIcon} alt={g.name} className="w-full h-full object-cover" /> : <Users className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate text-white">{g.name}</div>
                        <div className="text-[10px] text-[#949ba4] truncate">
                          {g.memberIds.length} membros{g.isLanP2p ? ' • LAN' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {unread > 0 && (
                        <span className="min-w-4 h-4 px-1 rounded-full bg-[#f23f42] text-[10px] font-bold text-white flex items-center justify-center">
                          {unread}
                        </span>
                      )}
                      {onStartGroupCall && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartGroupCall(g);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#23a55a] text-[#b5bac1] hover:text-white transition cursor-pointer"
                          title="Chamada em grupo"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onOpenGroupSettings && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenGroupSettings(g);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#4f545c] text-[#b5bac1] hover:text-white transition cursor-pointer"
                          title="Configurar grupo e imagem"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Serverless LAN Direct Peers */}
            <div className="space-y-1">
              <div className="px-2 pb-1 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4] flex items-center gap-1">
                  <Radar className="w-3 h-3 text-[#23a55a]" />
                  Rede Local LAN ({lanOnlyPeers.length})
                </span>
                {onScanLanPeers && (
                  <button
                    type="button"
                    onClick={onScanLanPeers}
                    className="p-0.5 text-[#949ba4] hover:text-white cursor-pointer"
                    title="Procurar amigos na LAN"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
              </div>

              {lanOnlyPeers.length === 0 && otherMembers.length === 0 ? (
                <div className="bg-[#232428]/70 border border-white/5 rounded-lg p-3 space-y-2.5 mx-1">
                  <p className="text-[11px] text-[#949ba4] leading-relaxed">
                    Conversas privadas acontecem direto na <strong>LAN P2P</strong> entre dois PCs — sem precisar hospedar servidor!
                  </p>
                  {onOpenServerDirectory && (
                    <button
                      type="button"
                      onClick={onOpenServerDirectory}
                      className="w-full py-1.5 rounded-md bg-[#23a55a] hover:bg-[#1a8245] text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Criar ou Entrar em Servidor
                    </button>
                  )}
                </div>
              ) : (
                lanOnlyPeers.map((peer) => {
                  const m = lanPeerToUser(peer);
                  const selected = activeDmUserId === peer.peerId;
                  const unread = unreadDmByUser[peer.peerId] || 0;
                  return (
                    <div
                      key={peer.peerId}
                      onClick={() => onSelectDmUser(peer.peerId)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onUserContextMenu(m, e);
                      }}
                      className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer transition ${
                        selected
                          ? 'bg-[#404249] text-white'
                          : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          name={m.displayName}
                          avatarUrl={m.avatarUrl}
                          color={m.avatarColor}
                          serverUrl={peer.p2pUrl}
                          size="sm"
                          online
                          statusType="online"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate text-white">{m.displayName}</div>
                          <div className="text-[10px] text-[#4ade80] truncate">
                            {m.currentActivity ? `${m.currentActivity.icon} ${m.currentActivity.name}` : `LAN P2P • ${peer.ip}`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {unread > 0 && (
                          <span className="min-w-4 h-4 px-1 rounded-full bg-[#f23f42] text-[10px] font-bold text-white flex items-center justify-center">
                            {unread}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartPrivateCall(m);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#23a55a] text-[#b5bac1] hover:text-white transition cursor-pointer"
                          title="Chamada privada P2P"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Server DM Contacts (when connected to a server; strictly DM scope without roles) */}
            {otherMembers.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">
                  Conversas do Servidor ({otherMembers.length})
                </div>
                {otherMembers.map((m) => {
                  const selected = activeDmUserId === m.id;
                  const unread = unreadDmByUser[m.id] || 0;
                  return (
                    <div
                      key={m.id}
                      onClick={() => onSelectDmUser(m.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onUserContextMenu(m, e);
                      }}
                      className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer transition ${
                        selected
                          ? 'bg-[#404249] text-white'
                          : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          name={m.displayName}
                          avatarUrl={m.avatarUrl}
                          color={m.avatarColor}
                          decoration={m.avatarDecoration}
                          serverUrl={serverUrl}
                          size="sm"
                          online={Boolean(m.online)}
                          statusType={m.statusType}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate text-white">{m.displayName}</div>
                          {(m.customStatusText || m.currentActivity) && (
                            <div className="text-[11px] text-[#949ba4] truncate">
                              {m.currentActivity
                                ? `${m.currentActivity.icon} ${m.currentActivity.name}`
                                : `${m.customStatusEmoji || ''} ${m.customStatusText || ''}`}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {unread > 0 && (
                          <span className="min-w-4 h-4 px-1 rounded-full bg-[#f23f42] text-[10px] font-bold text-white flex items-center justify-center">
                            {unread}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartPrivateCall(m);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#23a55a] text-[#b5bac1] hover:text-white transition cursor-pointer"
                          title="Iniciar chamada privada"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <>
            {(() => {
              const renderChannelItem = (ch: Channel) => {
                const isMuted = Boolean(mutedChannelIds?.has(ch.id));
                const isPinned = Boolean(pinnedChannelIds?.has(ch.id));
                if (ch.type === 'text') {
                  const selected = viewMode === 'chat' && activeTextChannelId === ch.id;
                  const canDelete =
                    channels.filter((x) => x.type === 'text').length > 1 &&
                    (canManageChannels || ch.createdBy === user.displayName);
                  return (
                    <div
                      key={ch.id}
                      onClick={() => onSelectTextChannel(ch.id)}
                      onContextMenu={(e) => {
                        if (!onChannelContextMenu) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onChannelContextMenu(ch, e);
                      }}
                      className={`group flex items-center justify-between h-8 px-2 rounded-[4px] cursor-pointer transition ${
                        selected
                          ? 'bg-[#404249] text-white font-medium'
                          : isMuted
                          ? 'text-[#6d6f78] hover:bg-[#35373c] hover:text-[#b5bac1]'
                          : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="relative shrink-0">
                          <Hash className="w-[18px] h-[18px] text-[#80848e]" />
                          {ch.isPrivate && (
                            <Lock className="w-2.5 h-2.5 text-[#f0b232] absolute -bottom-0.5 -right-0.5 bg-[#2b2d31] rounded-full" />
                          )}
                        </span>
                        <span className="text-[15px] truncate leading-none">{ch.name}</span>
                        {isPinned && <Pin className="w-3 h-3 text-[#f0b232] shrink-0" />}
                        {isMuted && <BellOff className="w-3 h-3 text-[#80848e] shrink-0" />}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {canManageChannels && onEditChannel && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditChannel(ch);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#949ba4] hover:text-white cursor-pointer"
                            title="Editar canal"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteChannel(ch);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#949ba4] hover:text-[#f23f42] cursor-pointer"
                            title="Excluir canal"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                const participants = voiceRooms[ch.id] || [];
                const isJoined = activeVoiceChannelId === ch.id;
                const isFocused = viewMode === 'voice' && isJoined;
                const canDelete =
                  channels.filter((x) => x.type === 'voice').length > 1 &&
                  (canManageChannels || ch.createdBy === user.displayName);

                return (
                  <div key={ch.id}>
                    <div
                      onClick={() => onJoinOrFocusVoiceChannel(ch.id)}
                      onContextMenu={(e) => {
                        if (!onChannelContextMenu) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onChannelContextMenu(ch, e);
                      }}
                      className={`group flex items-center justify-between h-8 px-2 rounded-[4px] cursor-pointer transition ${
                        isFocused
                          ? 'bg-[#404249] text-white font-medium'
                          : isJoined
                          ? 'text-white font-medium bg-[#35373c]/60'
                          : isMuted
                          ? 'text-[#6d6f78] hover:bg-[#35373c] hover:text-[#b5bac1]'
                          : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="relative shrink-0">
                          <Volume2
                            className={`w-[18px] h-[18px] ${isJoined ? 'text-[#23a55a]' : 'text-[#80848e]'}`}
                          />
                          {ch.isPrivate && (
                            <Lock className="w-2.5 h-2.5 text-[#f0b232] absolute -bottom-0.5 -right-0.5 bg-[#2b2d31] rounded-full" />
                          )}
                        </span>
                        <span className="text-[15px] truncate leading-none">{ch.name}</span>
                        {isMuted && <BellOff className="w-3 h-3 text-[#80848e] shrink-0" />}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {Boolean(ch.userLimit && ch.userLimit > 0) && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1e1f22] text-[#b5bac1]">
                            {participants.length}/{ch.userLimit}
                          </span>
                        )}
                        {canManageChannels && onEditChannel && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditChannel(ch);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#949ba4] hover:text-white cursor-pointer"
                            title="Editar canal"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteChannel(ch);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#949ba4] hover:text-[#f23f42] cursor-pointer"
                            title="Excluir canal"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {participants.length > 0 && (
                      <div className="ml-6 mt-0.5 mb-1 space-y-0.5">
                        {participants.map((p) => {
                          const isSpeaking = speakingSocketIds.has(p.socketId);
                          const memberObj = members.find((m) => m.id === p.userId);
                          return (
                            <div
                              key={p.socketId}
                              onClick={(e) => {
                                if (memberObj) onUserClick(memberObj, e);
                                else onJoinOrFocusVoiceChannel(ch.id);
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (memberObj) {
                                  onUserContextMenu(memberObj, e, {
                                    socketId: p.socketId,
                                    inVoiceChannelId: ch.id,
                                    isSharingScreen: p.screenSharing,
                                  });
                                }
                              }}
                              className="flex items-center justify-between px-1.5 py-1 rounded-[4px] hover:bg-[#35373c]/70 cursor-pointer"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar
                                  name={p.displayName}
                                  avatarUrl={p.avatarUrl}
                                  color={p.avatarColor}
                                  decoration={p.avatarDecoration}
                                  serverUrl={serverUrl}
                                  size="xs"
                                  speaking={isSpeaking}
                                  soundboardActive={Boolean(soundboardActiveUserIds?.has(p.userId))}
                                />
                                <span
                                  className={`text-[13px] truncate ${
                                    isSpeaking ? 'text-white font-medium' : 'text-[#949ba4]'
                                  }`}
                                >
                                  {p.displayName}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {p.screenSharing && (
                                  <span className="text-[9px] font-bold bg-[#f23f42] text-white px-1.5 py-[1px] rounded-full tracking-wide">
                                    AO VIVO
                                  </span>
                                )}
                                {p.cameraOn && <Camera className="w-3 h-3 text-[#b5bac1]" />}
                                {p.deafened || p.serverDeafened ? (
                                  <HeadphoneOff
                                    className={`w-3.5 h-3.5 ${p.serverDeafened ? 'text-[#f23f42]' : 'text-[#949ba4]'}`}
                                  />
                                ) : p.muted || p.serverMuted ? (
                                  <MicOff
                                    className={`w-3.5 h-3.5 ${p.serverMuted ? 'text-[#f23f42]' : 'text-[#949ba4]'}`}
                                  />
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <>
                  {/* FAVORITES / PINNED CHANNELS */}
                  {pinnedOrFavChannels.length > 0 && (
                    <div>
                      <div className="px-1 mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.02em] text-[#f0b232]">
                        <Star className="w-3 h-3" />
                        <span>Favoritos & Fixados</span>
                      </div>
                      <div className="space-y-[2px]">{pinnedOrFavChannels.map(renderChannelItem)}</div>
                    </div>
                  )}

                  {/* TEXT CHANNELS (Uncategorized) */}
                  <div>
                    <div className="flex items-center justify-between px-1 mb-1">
                      <button
                        type="button"
                        onClick={() => setTextOpen((v) => !v)}
                        className="flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-[0.02em] text-[#949ba4] hover:text-[#dbdee1] cursor-pointer"
                      >
                        {textOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <span>Canais de Texto</span>
                      </button>
                      {canCreate && (
                        <button
                          type="button"
                          onClick={() => onCreateChannel('text', null)}
                          className="p-0.5 text-[#949ba4] hover:text-[#dbdee1] cursor-pointer"
                          title="Criar canal de texto"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {textOpen && <div className="space-y-[2px]">{uncategorizedText.map(renderChannelItem)}</div>}
                  </div>

                  {/* VOICE CHANNELS (Uncategorized) */}
                  <div>
                    <div className="flex items-center justify-between px-1 mb-1">
                      <button
                        type="button"
                        onClick={() => setVoiceOpen((v) => !v)}
                        className="flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-[0.02em] text-[#949ba4] hover:text-[#dbdee1] cursor-pointer"
                      >
                        {voiceOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <span>Canais de Voz</span>
                      </button>
                      {canCreate && (
                        <button
                          type="button"
                          onClick={() => onCreateChannel('voice', null)}
                          className="p-0.5 text-[#949ba4] hover:text-[#dbdee1] cursor-pointer"
                          title="Criar canal de voz"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {voiceOpen && <div className="space-y-0.5">{uncategorizedVoice.map(renderChannelItem)}</div>}
                  </div>

                  {/* CATEGORIES */}
                  {sortedCategories.map((cat) => {
                    const catChannels = visibleChannels.filter((c) => c.categoryId === cat.id);
                    const isCollapsed = collapsedCats.has(cat.id);
                    return (
                      <div key={cat.id}>
                        <div className="flex items-center justify-between px-1 mb-1">
                          <button
                            type="button"
                            onClick={() => toggleCategory(cat.id)}
                            className="flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-[0.02em] text-[#949ba4] hover:text-[#dbdee1] cursor-pointer truncate"
                          >
                            {isCollapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
                            <span className="truncate">{cat.name}</span>
                          </button>
                          {canCreate && (
                            <button
                              type="button"
                              onClick={() => onCreateChannel('text', cat.id)}
                              className="p-0.5 text-[#949ba4] hover:text-[#dbdee1] cursor-pointer shrink-0"
                              title={`Criar canal em ${cat.name}`}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        {!isCollapsed && (
                          <div className="space-y-0.5">
                            {catChannels.length === 0 ? (
                              <div className="px-3 py-1 text-[11px] text-[#6d6f78] italic">Vazio</div>
                            ) : (
                              catChannels.map(renderChannelItem)
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* Active Voice Connection Bar */}
      {activeVoiceChannelId && (
        <div className="bg-[#232428] border-t border-white/10 px-2.5 py-2 space-y-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => onJoinOrFocusVoiceChannel(activeVoiceChannelId)}
              className="text-left min-w-0 cursor-pointer group"
            >
              <div className="flex items-center gap-1 text-[13px] font-bold text-[#23a55a] leading-tight">
                <Signal className="w-4 h-4 shrink-0" />
                <span>Voz conectada</span>
                {audioSettings.inputMode === 'ptt' && (
                  <span className="text-[9px] bg-[#5865f2] text-white px-1 rounded">PTT</span>
                )}
              </div>
              <div className="text-[11px] text-[#949ba4] group-hover:underline truncate">{activeVoiceLabel}</div>
            </button>
            <button
              type="button"
              onClick={onLeaveVoice}
              className="p-1.5 rounded-[4px] text-[#b5bac1] hover:text-white hover:bg-[#35373c] transition cursor-pointer"
              title="Desconectar"
            >
              <PhoneOff className="w-[18px] h-[18px]" />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1">
            <button
              type="button"
              onClick={onToggleCamera}
              className={`h-8 rounded-[4px] flex items-center justify-center transition cursor-pointer ${
                cameraOn ? 'bg-[#23a55a] text-white' : 'bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1]'
              }`}
              title={cameraOn ? 'Desligar vídeo' : 'Ligar vídeo'}
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onOpenScreenShare}
              className={`h-8 rounded-[4px] flex items-center justify-center transition cursor-pointer ${
                screenSharing ? 'bg-[#23a55a] text-white' : 'bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1]'
              }`}
              title={screenSharing ? 'Parar transmissão' : 'Transmitir tela'}
            >
              <MonitorPlay className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onOpenVoiceDrawer('video')}
              className="h-8 rounded-[4px] bg-[#2b2d31] hover:bg-[#404249] text-[#fda4af] flex items-center justify-center transition cursor-pointer"
              title="Tocador de Vídeos"
            >
              <Clapperboard className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onOpenVoiceDrawer('soundboard')}
              className="h-8 rounded-[4px] bg-[#2b2d31] hover:bg-[#404249] text-[#f0b232] flex items-center justify-center transition cursor-pointer"
              title="Soundboard"
            >
              <Zap className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onOpenVoiceDrawer('music')}
              className="h-8 rounded-[4px] bg-[#2b2d31] hover:bg-[#404249] text-[#4ade80] flex items-center justify-center transition cursor-pointer"
              title="Tocador de Músicas"
            >
              <Music className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* EXACT DISCORD BOTTOM USER BAR WITH SPLIT MIC & HEADPHONE QUICK POPOUT ARROWS (Print 3!) */}
      <div className="h-[54px] bg-[#232428] pc-user-dock border-t border-white/10 px-2 flex items-center justify-between gap-1 shrink-0">
        <button
          type="button"
          onClick={onOpenSelfProfilePopout}
          className="flex items-center gap-2 min-w-0 flex-1 px-1 py-1 rounded-[4px] hover:bg-[#35373c] transition text-left cursor-pointer"
          title="Ver e editar seu perfil"
        >
          <Avatar
            name={user.displayName}
            avatarUrl={user.avatarUrl}
            color={user.avatarColor}
            decoration={user.avatarDecoration}
            serverUrl={serverUrl}
            size="sm"
            online={user.statusType !== 'invisible'}
            statusType={user.statusType}
            speaking={speakingSocketIds.has(selfSocketId)}
            soundboardActive={Boolean(soundboardActiveUserIds?.has(user.id))}
            borderBg="#232428"
          />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[#f2f3f5] truncate leading-tight">{user.displayName}</div>
            <div className="text-[11px] text-[#949ba4] truncate leading-tight">
              {user.customStatusText || user.customStatusEmoji
                ? `${user.customStatusEmoji || ''} ${user.customStatusText || ''}`.trim()
                : user.statusType === 'dnd'
                ? 'Não Perturbe'
                : user.statusType === 'idle'
                ? 'Ausente'
                : user.statusType === 'invisible'
                ? 'Invisível'
                : 'Online'}
            </div>
          </div>
        </button>

        {/* Print 3 exact split buttons: [Mic | ^] [Headphones | v] [Settings] */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Split Mic button */}
          <div
            className={`flex items-center rounded-[4px] overflow-hidden ${
              audioPopout === 'mic' ? 'bg-[#35373c]' : ''
            }`}
            onContextMenu={(e) => {
              e.preventDefault();
              setAudioPopout((p) => (p === 'mic' ? 'none' : 'mic'));
            }}
          >
            <button
              type="button"
              onClick={onToggleMute}
              className={`w-7 h-8 flex items-center justify-center transition cursor-pointer ${
                muted || deafened || user.serverMuted
                  ? 'text-[#f23f42] hover:bg-[#35373c]'
                  : 'text-[#b5bac1] hover:text-white hover:bg-[#35373c]'
              }`}
              title={user.serverMuted ? 'Silenciado pelo servidor' : muted ? 'Desmutar microfone' : 'Mutar microfone'}
            >
              {muted || deafened || user.serverMuted ? (
                <MicOff className="w-[17px] h-[17px]" />
              ) : (
                <Mic className="w-[17px] h-[17px]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setAudioPopout((p) => (p === 'mic' ? 'none' : 'mic'))}
              className="w-3.5 h-8 flex items-center justify-center text-[#949ba4] hover:text-white hover:bg-[#35373c] transition cursor-pointer"
              title="Opções rápidas de microfone"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
          </div>

          {/* Split Headphone button */}
          <div
            className={`flex items-center rounded-[4px] overflow-hidden ${
              audioPopout === 'output' ? 'bg-[#35373c]' : ''
            }`}
            onContextMenu={(e) => {
              e.preventDefault();
              setAudioPopout((p) => (p === 'output' ? 'none' : 'output'));
            }}
          >
            <button
              type="button"
              onClick={onToggleDeafen}
              className={`w-7 h-8 flex items-center justify-center transition cursor-pointer ${
                deafened || user.serverDeafened
                  ? 'text-[#f23f42] hover:bg-[#35373c]'
                  : 'text-[#b5bac1] hover:text-white hover:bg-[#35373c]'
              }`}
              title={deafened ? 'Reativar áudio' : 'Desativar áudio'}
            >
              {deafened || user.serverDeafened ? (
                <HeadphoneOff className="w-[17px] h-[17px]" />
              ) : (
                <Headphones className="w-[17px] h-[17px]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setAudioPopout((p) => (p === 'output' ? 'none' : 'output'))}
              className="w-3.5 h-8 flex items-center justify-center text-[#949ba4] hover:text-white hover:bg-[#35373c] transition cursor-pointer"
              title="Opções rápidas de saída de áudio"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenSettings('audio')}
            className="w-7 h-8 rounded-[4px] flex items-center justify-center text-[#b5bac1] hover:text-white hover:bg-[#35373c] transition cursor-pointer"
            title="Configurações"
          >
            <Settings className="w-[17px] h-[17px]" />
          </button>
        </div>
      </div>

      {/* Quick Mic / Headphone Popout (Print 3!) */}
      {audioPopout !== 'none' && (
        <AudioQuickPopout
          kind={audioPopout}
          audioSettings={audioSettings}
          onUpdateAudioSettings={onUpdateAudioSettings}
          onOpenVoiceSettings={() => onOpenSettings('audio')}
          onClose={() => setAudioPopout('none')}
        />
      )}
    </aside>
  );
};
