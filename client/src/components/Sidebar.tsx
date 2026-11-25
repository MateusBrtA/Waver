import React, { useEffect, useMemo, useState } from 'react';
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
import { useIsSpeaking } from '../lib/speakingStore';
import { Avatar } from './Avatar';
import { PanelResizer, usePersistentWidth } from './PanelResizer';
import { SettingsTabId } from './SettingsModal';


/** Nome do participante na lista de voz: fica branco enquanto a pessoa fala (lido do speakingStore) */
const SpeakingName: React.FC<{ socketId: string; name: string }> = React.memo(({ socketId, name }) => {
  const speaking = useIsSpeaking(socketId);
  return (
    <span className={`text-[14px] truncate ${speaking ? 'text-[#f2f3f5]' : 'text-[#949ba4]'}`}>{name}</span>
  );
});

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
  /** arrastar e soltar: nova ordem/categoria dos canais */
  onReorderChannels?: (layout: Array<{ id: string; categoryId: string | null; position: number }>) => void;
  onReorderCategories?: (ids: string[]) => void;
  /** arrastar alguém para outro canal de voz */
  onMoveVoiceMember?: (userId: string, channelId: string) => void;
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
  onReorderChannels,
  onReorderCategories,
  onMoveVoiceMember,
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
  const [sidebarWidth, setSidebarWidth] = usePersistentWidth('pc.sidebarWidth', 240, 200, 440);
  const [textOpen, setTextOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(true);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => new Set());
  const [copiedIp, setCopiedIp] = useState(false);
  const [audioPopout, setAudioPopout] = useState<'none' | 'mic' | 'output'>('none');

  const canManageChannels = Boolean(server) && (Boolean(permissions?.manageChannels) || user.role === 'host');
  const canMoveMembers = Boolean(server) && (Boolean(permissions?.moveMembers) || user.role === 'host');

  // ----- arrastar e soltar (canais, categorias e pessoas), estilo Discord
  type DragItem =
    | { kind: 'channel'; id: string }
    | { kind: 'category'; id: string }
    | { kind: 'member'; id: string; userId: string; fromChannelId: string };
  type DropTarget =
    | { kind: 'channel'; id: string; pos: 'before' | 'after' }
    | { kind: 'voice'; id: string }
    | { kind: 'category'; id: string | null; pos: 'into' | 'before' | 'after' };
  const [dragItem, setDragItemState] = useState<DragItem | null>(null);
  // ref: o drop pode chegar antes do React re-renderizar o estado do dragstart/dragover
  const dragItemRef = React.useRef<DragItem | null>(null);
  const setDragItem = (d: DragItem | null) => {
    dragItemRef.current = d;
    setDragItemState(d);
  };
  const halfOf = (e: React.DragEvent): 'before' | 'after' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [orderOverride, setOrderOverride] = useState<Record<string, { categoryId: string | null; position: number }>>({});
  const [categoryOrderOverride, setCategoryOrderOverride] = useState<string[] | null>(null);
  useEffect(() => setOrderOverride({}), [channels]);
  useEffect(() => setCategoryOrderOverride(null), [categories]);
  const endDrag = () => {
    setDragItem(null);
    setDropTarget(null);
  };
  const canCreate = Boolean(server) && (canManageChannels || server?.allowMembersCreateChannels !== false);

  const isChannelVisibleInSidebar = (ch: Channel) => {
    if (!hideMutedChannels || !mutedChannelIds?.has(ch.id)) return true;
    if (activeTextChannelId === ch.id || activeVoiceChannelId === ch.id) return true;
    if (ch.type === 'voice' && (voiceRooms[ch.id]?.length || 0) > 0) return true;
    return false;
  };

  const visibleChannels = useMemo(() => {
    const indexed = channels.map((c, i) => {
      const o = orderOverride[c.id];
      return { ch: o ? { ...c, categoryId: o.categoryId, position: o.position } : c, i };
    });
    indexed.sort((a, b) => (a.ch.position ?? a.i) - (b.ch.position ?? b.i) || a.i - b.i);
    return indexed.map((x) => x.ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, orderOverride]).filter(isChannelVisibleInSidebar);
  /** canais de um grupo na ordem de exibição (texto primeiro, depois voz, como no Discord) */
  const channelsInGroup = (catId: string | null, list: Channel[] = visibleChannels) => {
    const g = list.filter((c) => (c.categoryId || null) === catId);
    return [...g.filter((c) => c.type === 'text'), ...g.filter((c) => c.type !== 'text')];
  };
  const moveChannel = (draggedId: string, targetCatId: string | null, beforeId: string | null) => {
    const dragged = visibleChannels.find((c) => c.id === draggedId);
    if (!dragged) return;
    const srcCat = dragged.categoryId || null;
    const group = channelsInGroup(targetCatId).filter((c) => c.id !== draggedId);
    let idx = beforeId ? group.findIndex((c) => c.id === beforeId) : group.length;
    if (idx < 0) idx = group.length;
    group.splice(idx, 0, { ...dragged, categoryId: targetCatId });
    const layout = group.map((c, i) => ({ id: c.id, categoryId: targetCatId, position: i }));
    if (srcCat !== targetCatId) {
      channelsInGroup(srcCat)
        .filter((c) => c.id !== draggedId)
        .forEach((c, i) => layout.push({ id: c.id, categoryId: srcCat, position: i }));
    }
    const prevPos = new Map(visibleChannels.map((c) => [c.id, `${c.categoryId || ''}|${c.position}`]));
    if (layout.every((l) => prevPos.get(l.id) === `${l.categoryId || ''}|${l.position}`)) return;
    setOrderOverride((prev) => {
      const next = { ...prev };
      for (const l of layout) next[l.id] = { categoryId: l.categoryId, position: l.position };
      return next;
    });
    onReorderChannels?.(layout);
  };
  const dropOnChannel = (target: Channel, pos: 'before' | 'after') => {
    const d = dragItemRef.current;
    if (!d || d.kind !== 'channel' || d.id === target.id) return;
    const catId = target.categoryId || null;
    const group = channelsInGroup(catId).filter((c) => c.id !== d.id);
    const ti = group.findIndex((c) => c.id === target.id);
    const beforeId = pos === 'before' ? target.id : group[ti + 1]?.id || null;
    moveChannel(d.id, catId, beforeId);
  };
  const channelDragProps = (ch: Channel) =>
    canManageChannels && onReorderChannels
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', ch.id);
            setDragItem({ kind: 'channel', id: ch.id });
          },
          onDragEnd: endDrag,
        }
      : {};
  const channelDropProps = (ch: Channel) => ({
    onDragOver: (e: React.DragEvent) => {
      const dragItem = dragItemRef.current;
      if (!dragItem) return;
      if (dragItem.kind === 'member') {
        if (ch.type !== 'voice' || dragItem.fromChannelId === ch.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropTarget?.kind !== 'voice' || dropTarget.id !== ch.id) setDropTarget({ kind: 'voice', id: ch.id });
        return;
      }
      if (dragItem.kind !== 'channel' || dragItem.id === ch.id) return;
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      if (dropTarget?.kind !== 'channel' || dropTarget.id !== ch.id || dropTarget.pos !== pos) {
        setDropTarget({ kind: 'channel', id: ch.id, pos });
      }
    },
    onDrop: (e: React.DragEvent) => {
      const d = dragItemRef.current;
      if (!d) return;
      e.preventDefault();
      if (d.kind === 'member') {
        if (ch.type === 'voice' && d.fromChannelId !== ch.id) {
          if (d.userId === user.id) onJoinOrFocusVoiceChannel(ch.id);
          else onMoveVoiceMember?.(d.userId, ch.id);
        }
      } else if (d.kind === 'channel' && d.id !== ch.id) {
        dropOnChannel(ch, halfOf(e));
      }
      endDrag();
    },
  });
  const dropLine = (ch: Channel) =>
    dropTarget?.kind === 'channel' && dropTarget.id === ch.id ? (
      <div
        className={`absolute left-1 right-1 h-[2px] rounded bg-[#5865f2] pointer-events-none ${
          dropTarget.pos === 'before' ? '-top-[1px]' : '-bottom-[1px]'
        }`}
      />
    ) : null;
  const categoryHeaderDnd = (catId: string | null) => ({
    draggable: Boolean(catId && canManageChannels && onReorderCategories),
    onDragStart: (e: React.DragEvent) => {
      if (!catId) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', catId);
      setDragItem({ kind: 'category', id: catId });
    },
    onDragEnd: endDrag,
    onDragOver: (e: React.DragEvent) => {
      const dragItem = dragItemRef.current;
      if (!dragItem) return;
      if (dragItem.kind === 'channel') {
        e.preventDefault();
        if (dropTarget?.kind !== 'category' || dropTarget.id !== catId || dropTarget.pos !== 'into') {
          setDropTarget({ kind: 'category', id: catId, pos: 'into' });
        }
      } else if (dragItem.kind === 'category' && catId && dragItem.id !== catId) {
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
        if (dropTarget?.kind !== 'category' || dropTarget.id !== catId || dropTarget.pos !== pos) {
          setDropTarget({ kind: 'category', id: catId, pos });
        }
      }
    },
    onDrop: (e: React.DragEvent) => {
      const d = dragItemRef.current;
      if (!d) return;
      e.preventDefault();
      if (d.kind === 'channel') {
        moveChannel(d.id, catId, null);
      } else if (d.kind === 'category' && catId && d.id !== catId) {
        const ids = orderedCategories.map((c) => c.id).filter((id) => id !== d.id);
        let idx = ids.indexOf(catId);
        if (halfOf(e) === 'after') idx += 1;
        ids.splice(idx, 0, d.id);
        setCategoryOrderOverride(ids);
        onReorderCategories?.(ids);
      }
      endDrag();
    },
  });
  const pinnedOrFavChannels = visibleChannels.filter(
    (c) => favoriteChannelIds?.has(c.id) || pinnedChannelIds?.has(c.id)
  );
  const uncategorizedText = visibleChannels.filter((c) => c.type === 'text' && !c.categoryId);
  const uncategorizedVoice = visibleChannels.filter((c) => c.type === 'voice' && !c.categoryId);
  const sortedCategories = [...categories].sort((a, b) => (a.position || 0) - (b.position || 0));
  const orderedCategories = categoryOrderOverride
    ? (categoryOrderOverride.map((id) => categories.find((c) => c.id === id)).filter(Boolean) as ChannelCategory[])
    : sortedCategories;

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
    <aside className="shrink-0 bg-[#2b2d31] pc-sidebar flex flex-col select-none h-full relative" style={{ width: sidebarWidth }}>
      <PanelResizer side="right" width={sidebarWidth} defaultWidth={240} onResize={setSidebarWidth} />
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

      {/* Host: linha discreta com o endereço para convidar (o resto fica no menu do servidor) */}
      {navArea === 'server' && server && isHosting && primaryShareUrl && (
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={handleCopyShareUrl}
            className="w-full h-8 px-2 rounded-[4px] flex items-center gap-2 text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1] cursor-pointer transition"
            title="Copiar endereço para convidar amigos"
          >
            <Server className="w-[18px] h-[18px] text-[#23a55a] shrink-0" />
            <span className="text-[14px] font-medium truncate">Convidar: {primaryShareUrl.replace(/^https?:\/\//, '')}</span>
            <span className="ml-auto shrink-0">{copiedIp ? <Check className="w-4 h-4 text-[#23a55a]" /> : <Copy className="w-4 h-4" />}</span>
          </button>
          <div className="h-px bg-[#3f4147] mx-1 mt-2" />
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
                      <div className="w-8 h-8 rounded-full bg-[#5865f2] flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden">
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
                      {...channelDragProps(ch)}
                      {...channelDropProps(ch)}
                      onClick={() => onSelectTextChannel(ch.id)}
                      onContextMenu={(e) => {
                        if (!onChannelContextMenu) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onChannelContextMenu(ch, e);
                      }}
                      className={`relative group flex items-center justify-between h-8 px-2 rounded-[4px] cursor-pointer transition ${
                        dragItem?.kind === 'channel' && dragItem.id === ch.id ? 'opacity-40' : ''
                      } ${
                        selected
                          ? 'bg-[#404249] text-white font-medium'
                          : isMuted
                          ? 'text-[#6d6f78] hover:bg-[#35373c] hover:text-[#b5bac1]'
                          : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
                      }`}
                    >
                      {dropLine(ch)}
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
                      {...channelDragProps(ch)}
                      {...channelDropProps(ch)}
                      onClick={() => onJoinOrFocusVoiceChannel(ch.id)}
                      onContextMenu={(e) => {
                        if (!onChannelContextMenu) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onChannelContextMenu(ch, e);
                      }}
                      className={`relative group flex items-center justify-between h-8 px-2 rounded-[4px] cursor-pointer transition ${
                        dragItem?.kind === 'channel' && dragItem.id === ch.id ? 'opacity-40' : ''
                      } ${
                        dropTarget?.kind === 'voice' && dropTarget.id === ch.id ? 'ring-2 ring-inset ring-[#5865f2] bg-[#5865f2]/15 ' : ''
                      }${
                        isFocused
                          ? 'bg-[#404249] text-white font-medium'
                          : isJoined
                          ? 'text-white font-medium bg-[#35373c]/60'
                          : isMuted
                          ? 'text-[#6d6f78] hover:bg-[#35373c] hover:text-[#b5bac1]'
                          : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
                      }`}
                    >
                      {dropLine(ch)}
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
                          const memberObj = members.find((m) => m.id === p.userId);
                          return (
                            <div
                              key={p.socketId}
                              draggable={p.userId === user.id || (canMoveMembers && Boolean(onMoveVoiceMember))}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', p.userId);
                                setDragItem({ kind: 'member', id: p.socketId, userId: p.userId, fromChannelId: ch.id });
                              }}
                              onDragEnd={endDrag}
                              title={
                                p.userId === user.id
                                  ? 'Arraste para outro canal de voz para trocar de sala'
                                  : canMoveMembers
                                  ? 'Arraste para outro canal de voz para mover'
                                  : undefined
                              }
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
                              className={`flex items-center justify-between px-1.5 py-1 rounded-[4px] hover:bg-[#35373c]/70 cursor-pointer ${
                                dragItem?.kind === 'member' && dragItem.id === p.socketId ? 'opacity-40' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar
                                  name={p.displayName}
                                  avatarUrl={p.avatarUrl}
                                  color={p.avatarColor}
                                  decoration={p.avatarDecoration}
                                  serverUrl={serverUrl}
                                  size="xs"
                                  speakingId={p.socketId}
                                  soundboardActive={Boolean(soundboardActiveUserIds?.has(p.userId))}
                                />
                                <SpeakingName socketId={p.socketId} name={p.displayName} />
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

                  {/* Canais sem categoria: no Discord ficam no topo, sem cabeçalho */}
                  {orderedCategories.length > 0 ? (
                    <div
                      className={`space-y-[2px] ${
                        dragItem?.kind === 'channel' && uncategorizedText.length + uncategorizedVoice.length === 0
                          ? `min-h-8 rounded-[4px] border border-dashed ${
                              dropTarget?.kind === 'category' && dropTarget.id === null ? 'border-[#5865f2] bg-[#5865f2]/10' : 'border-[#4e5058]'
                            } flex items-center justify-center`
                          : ''
                      }`}
                      {...(uncategorizedText.length + uncategorizedVoice.length === 0 ? categoryHeaderDnd(null) : {})}
                    >
                      {dragItem?.kind === 'channel' && uncategorizedText.length + uncategorizedVoice.length === 0 ? (
                        <span className="text-[11px] text-[#949ba4] pointer-events-none">Soltar aqui: sem categoria</span>
                      ) : (
                        channelsInGroup(null).map(renderChannelItem)
                      )}
                    </div>
                  ) : (
                    <>
                  {/* TEXT CHANNELS (Uncategorized) */}
                  <div>
                    <div className="flex items-center justify-between px-1 mb-1" {...categoryHeaderDnd(null)}>
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
                    <div className="flex items-center justify-between px-1 mb-1" {...categoryHeaderDnd(null)}>
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

                    </>
                  )}

                  {/* CATEGORIES */}
                  {orderedCategories.map((cat) => {
                    const catChannels = channelsInGroup(cat.id);
                    const catDrop = dropTarget?.kind === 'category' && dropTarget.id === cat.id ? dropTarget.pos : null;
                    const isCollapsed = collapsedCats.has(cat.id);
                    return (
                      <div key={cat.id} className={dragItem?.kind === 'category' && dragItem.id === cat.id ? 'opacity-40' : ''}>
                        <div
                          {...categoryHeaderDnd(cat.id)}
                          className={`relative flex items-center justify-between px-1 mb-1 rounded-[4px] ${
                            catDrop === 'into' ? 'bg-[#5865f2]/15 ring-1 ring-inset ring-[#5865f2]' : ''
                          }`}
                        >
                          {catDrop === 'before' && <div className="absolute -top-1.5 left-0 right-0 h-[2px] rounded bg-[#5865f2]" />}
                          {catDrop === 'after' && <div className="absolute -bottom-1 left-0 right-0 h-[2px] rounded bg-[#5865f2]" />}
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
                            {catChannels.map(renderChannelItem)}
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
              className="h-8 rounded-[4px] bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1] flex items-center justify-center transition cursor-pointer"
              title="Tocador de Vídeos"
            >
              <Clapperboard className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onOpenVoiceDrawer('soundboard')}
              className="h-8 rounded-[4px] bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1] flex items-center justify-center transition cursor-pointer"
              title="Soundboard"
            >
              <Zap className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onOpenVoiceDrawer('music')}
              className="h-8 rounded-[4px] bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1] flex items-center justify-center transition cursor-pointer"
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
            speakingId={selfSocketId}
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
