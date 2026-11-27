import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Download,
  Loader2,
  MicOff,
  Minus,
  MonitorCog,
  Phone,
  PhoneOff,
  Scissors,
  ShieldAlert,
  Square,
  WifiOff,
  X,
} from 'lucide-react';
import { ApiClient, normalizeServerUrl, resolveMediaUrl, setLocalP2pBaseUrl } from './lib/api';
import { audioEngine } from './lib/audioEngine';
import { GamepadBridge } from './lib/gamepadBridge';
import { computeChannelPermissions, computeServerPermissions } from './lib/permissions';
import { applyThemeConfig, DEFAULT_THEME_CONFIG, loadSavedThemeLocal } from './lib/themeEngine';
import {
  clearSavedServers,
  loadSavedServers,
  removeSavedServer,
  SavedServer,
  serverKey,
  upsertSavedServer,
} from './lib/savedServers';
import { WebRTCManager } from './lib/webrtc';
import { SfuJoinInfo, sfuSupported } from './lib/sfuSession';
import {
  AppMode,
  Attachment,
  AudioSettings,
  Channel,
  ChannelCategory,
  ChatMessage,
  FileTransfer,
  GifItem,
  GlobalProfile,
  HostStatus,
  LanPeer,
  LanServer,
  Model3DViewerTarget,
  MusicState,
  PrivateGroup,
  PrivateGroupMemberMeta,
  RcPeerSession,
  RcPermissions,
  RemoteInputEvent,
  RemotePeerMedia,
  Role,
  ScreenShareConfig,
  ServerInfo,
  SoundItem,
  SoundPlayedToast,
  StreamStats,
  ThemeConfig,
  TrelloBoard,
  UpdateManifest,
  GithubUpdateState,
  User,
  VideoState,
  VoiceParticipant,
  NotificationRoute,
  RsvpStatus,
  ServerEvent,
  SharedFileInfo,
  PresenceStatus,
} from './types';
import { isSpeaking } from './lib/speakingStore';
import { Avatar } from './components/Avatar';
import { ChannelContextMenu } from './components/ChannelContextMenu';
import { ChatArea } from './components/ChatArea';
import { CreateChannelModal } from './components/CreateChannelModal';
import { GroupModal } from './components/GroupModal';
import { LoginScreen } from './components/LoginScreen';
import { MemberList } from './components/MemberList';
import { ScreenShareModal } from './components/ScreenShareModal';
import { ServerContextMenu } from './components/ServerContextMenu';
import { ServerRail } from './components/ServerRail';
import { NowPlayingBar } from './components/NowPlayingBar';
import { ImageContextMenu } from './components/ImageContextMenu';
import { LinkContextMenu } from './components/LinkContextMenu';
import type { SettingsTabId } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { ContextMenuTarget, UserContextMenu } from './components/UserContextMenu';
import { UserProfilePopout } from './components/UserProfilePopout';
import { VoiceAudioBridge } from './components/VoiceAudioBridge';
import { VoiceStage } from './components/VoiceStage';
import { LazyBoundary } from './components/LazyBoundary';
import { ShareTargetModal } from './components/ShareTargetModal';
import { ThreadPanel } from './components/ThreadPanel';
import { EventsModal } from './components/EventsModal';
import { SearchModal } from './components/SearchModal';
import { PollComposerModal, PollDraft } from './components/PollComposerModal';
import { StageBar } from './components/StageBar';
import { WaverLogo } from './components/WaverLogo';
import { CallRecording, ClipBuffer, RecSource } from './lib/callRecorder';
import { getDesktopPrefs, prettyAccelerator, useDesktopPrefs } from './lib/desktopPrefs';

// Janelas pesadas só carregam quando abertas (menos JS na memória do cliente)
const ChannelSettingsModal = React.lazy(() => import('./components/ChannelSettingsModal').then((m) => ({ default: m.ChannelSettingsModal })));
const HostControlModal = React.lazy(() => import('./components/HostControlModal').then((m) => ({ default: m.HostControlModal })));
const ServerDirectoryModal = React.lazy(() => import('./components/ServerDirectoryModal').then((m) => ({ default: m.ServerDirectoryModal })));
const TrelloBoardModal = React.lazy(() => import('./components/TrelloBoardModal').then((m) => ({ default: m.TrelloBoardModal })));
const UserProfileModal = React.lazy(() => import('./components/UserProfileModal').then((m) => ({ default: m.UserProfileModal })));
const SettingsModal = React.lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const Model3DViewerModal = React.lazy(() =>
  import('./components/Model3DViewerModal').then((m) => ({ default: m.Model3DViewerModal }))
);

const MAX_CACHED_MESSAGES = 400;
const MAX_CACHED_CHANNELS = 5;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function compareVersions(a: string, b: string): number {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  inputDeviceId: '',
  outputDeviceId: '',
  videoDeviceId: '',
  inputProfile: 'voice-isolation',
  inputMode: 'vad',
  vadAuto: true,
  vadThreshold: 18,
  pttKey: 'KeyV',
  inputVolume: 1,
  outputVolume: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  soundboardVolume: 0.8,
  musicVolume: 0.5,
  customTurnUrl: '',
  customTurnUser: '',
  customTurnCred: '',
};

function getDmPairKey(idA: string, idB: string): string {
  return [String(idA), String(idB)].sort().join('::');
}

function mergeMessageLists(localList: ChatMessage[] = [], remoteList: ChatMessage[] = []): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of localList) byId.set(m.id, m);
  for (const m of remoteList) byId.set(m.id, m);
  return Array.from(byId.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-500);
}

function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem('pulsecord_audio_settings');
    if (raw) return { ...DEFAULT_AUDIO_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_AUDIO_SETTINGS;
}

function loadStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === 'string'));
    }
  } catch {
    // ignore
  }
  return new Set();
}

function loadPeerVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem('pulsecord_peer_volumes');
    if (raw) return JSON.parse(raw) || {};
  } catch {
    // ignore
  }
  return {};
}

function getDefaultMode(): AppMode {
  try {
    const saved = localStorage.getItem('pulsecord_mode');
    if (saved === 'host' || saved === 'client') return saved;
  } catch {
    // ignore
  }
  return 'client';
}

function getDefaultServerUrl(): string {
  try {
    const saved = localStorage.getItem('pulsecord_server_url');
    if (saved) return saved;
  } catch {
    // ignore
  }
  if (window.location.protocol.startsWith('http') && window.location.port !== '5173') {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

async function loadLocalGlobalProfile(): Promise<GlobalProfile | null> {
  try {
    if (window.electronAPI?.loadGlobalProfile) {
      const fromDisk = await window.electronAPI.loadGlobalProfile();
      if (fromDisk) return fromDisk;
    }
  } catch {
    // ignore
  }
  try {
    const raw = localStorage.getItem('pulsecord_global_profile');
    if (raw) return JSON.parse(raw) as GlobalProfile;
  } catch {
    // ignore
  }
  return null;
}

async function persistLocalGlobalProfile(patch: GlobalProfile): Promise<GlobalProfile> {
  const existing = (await loadLocalGlobalProfile()) || {};
  const merged: GlobalProfile = { ...existing, ...patch };
  try {
    if (window.electronAPI?.saveGlobalProfile) {
      await window.electronAPI.saveGlobalProfile(merged);
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem('pulsecord_global_profile', JSON.stringify(merged));
  } catch {
    // ignore quota error for large base64 in web browser
  }
  return merged;
}

async function loadLocalDmArchive(): Promise<Record<string, ChatMessage[]>> {
  try {
    if (window.electronAPI?.loadLocalDmVault) {
      const vault = await window.electronAPI.loadLocalDmVault();
      if (vault && typeof vault === 'object') return vault;
    }
  } catch {
    // ignore
  }
  try {
    const raw = localStorage.getItem('pulsecord_dm_archive');
    if (raw) return JSON.parse(raw) || {};
  } catch {
    // ignore
  }
  return {};
}

function persistLocalDmArchive(dmMap: Record<string, ChatMessage[]>) {
  try {
    if (window.electronAPI?.saveLocalDmVault) {
      window.electronAPI.saveLocalDmVault(dmMap).catch(() => {});
      return;
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem('pulsecord_dm_archive', JSON.stringify(dmMap));
  } catch {
    // ignore
  }
}

function upsertPrivateGroup(list: PrivateGroup[], group: PrivateGroup): PrivateGroup[] {
  const idx = list.findIndex((g) => g.id === group.id);
  if (idx === -1) return [group, ...list];
  const next = [...list];
  next[idx] = { ...next[idx], ...group };
  return next;
}

function mergePrivateGroups(prev: PrivateGroup[], incoming: PrivateGroup[]): PrivateGroup[] {
  let acc = [...prev];
  for (const g of incoming) acc = upsertPrivateGroup(acc, g);
  return acc;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  pdf: 'application/pdf', txt: 'text/plain', json: 'application/json', zip: 'application/zip',
};
function guessMimeFromName(name: string) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

export default function App() {
  const isElectron = Boolean(window.electronAPI?.isElectron);

  // Host vs Client mode, embedded host status & auto-discovered LAN servers/peers
  const [appMode, setAppMode] = useState<AppMode>(getDefaultMode);
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(null);
  const [lanServers, setLanServers] = useState<LanServer[]>([]);
  const [lanPeers, setLanPeers] = useState<LanPeer[]>([]);
  const [localPeerInfo, setLocalPeerInfo] = useState<LanPeer | null>(null);
  const [showHostModal, setShowHostModal] = useState(false);
  const [showServerDirectory, setShowServerDirectory] = useState(false);
  const [savedServers, setSavedServers] = useState<SavedServer[]>(() => loadSavedServers());
  /** servidor salvo que estava offline quando o app abriu: tenta de novo sozinho até o host ligar */
  const [autoReconnectUrl, setAutoReconnectUrl] = useState<string | null>(null);

  // Auth & session
  const [booting, setBooting] = useState(true);
  const [serverUrl, setServerUrl] = useState<string>(getDefaultServerUrl);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  // Server data
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<ChannelCategory[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [voiceRooms, setVoiceRooms] = useState<Record<string, VoiceParticipant[]>>({});
  const voiceRoomsRef = useRef(voiceRooms);
  voiceRoomsRef.current = voiceRooms;
  // gravação da chamada: pedido de permissão recebido / aviso antes de entrar numa chamada sendo gravada
  const [recConsentAsk, setRecConsentAsk] = useState<{ requestId: string; from: string } | null>(null);
  const [recJoinPrompt, setRecJoinPrompt] = useState<{ channelId: string; names: string[] } | null>(null);
  const [recRequestPending, setRecRequestPending] = useState(false);
  const startRecordingNowRef = useRef<() => void>(() => {});
  const [dmVoiceParticipants, setDmVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, ChatMessage[]>>({});
  const recentTextChannelsRef = useRef<string[]>([]);
  const [dmMessagesByPair, setDmMessagesByPair] = useState<Record<string, ChatMessage[]>>({});
  const [unreadDmByUser, setUnreadDmByUser] = useState<Record<string, number>>({});
  const [dmGroups, setDmGroups] = useState<PrivateGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupMessagesById, setGroupMessagesById] = useState<Record<string, ChatMessage[]>>({});
  const [unreadByGroup, setUnreadByGroup] = useState<Record<string, number>>({});
  const [typingByChannel, setTypingByChannel] = useState<Record<string, Record<string, string>>>({});
  const [sounds, setSounds] = useState<SoundItem[]>([]);
  const [savedGifs, setSavedGifs] = useState<GifItem[]>([]);

  // Navigation & UI state
  const [navArea, setNavArea] = useState<'server' | 'dms'>('server');
  const [activeDmUserId, setActiveDmUserId] = useState<string | null>(null);
  const [activeTextChannelId, setActiveTextChannelId] = useState<string>('');
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chat' | 'voice'>('chat');
  const [voiceDrawer, setVoiceDrawer] = useState<'none' | 'soundboard' | 'music' | 'video'>('none');
  const [showMembers, setShowMembers] = useState(true);
  const [createChannelMeta, setCreateChannelMeta] = useState<{
    type: 'text' | 'voice';
    categoryId?: string | null;
  } | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [channelContextMenu, setChannelContextMenu] = useState<{
    channel: Channel;
    x: number;
    y: number;
  } | null>(null);
  const [serverContextMenu, setServerContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [groupModal, setGroupModal] = useState<{
    mode: 'create' | 'settings';
    group?: PrivateGroup | null;
    preselectedIds?: string[];
  } | null>(null);
  const [trelloModal, setTrelloModal] = useState<{ scopeKey: string; scopeTitle: string } | null>(null);
  const [trelloBoardsByScope, setTrelloBoardsByScope] = useState<Record<string, TrelloBoard[]>>({});
  const [favoriteChannelIds, setFavoriteChannelIds] = useState<Set<string>>(() =>
    loadStringSet('pulsecord_fav_channels')
  );
  const [pinnedChannelIds, setPinnedChannelIds] = useState<Set<string>>(() =>
    loadStringSet('pulsecord_pinned_channels')
  );
  const [mutedChannelIds, setMutedChannelIds] = useState<Set<string>>(() =>
    loadStringSet('pulsecord_muted_channels')
  );
  const [hideMutedChannels, setHideMutedChannels] = useState(false);
  const [serverMutedNotify, setServerMutedNotify] = useState(false);
  const [channelNotifyMap, setChannelNotifyMap] = useState<Record<string, 'all' | 'mentions' | 'nothing'>>({});
  const [serverNotifyLevel, setServerNotifyLevel] = useState<'all' | 'mentions' | 'nothing'>('mentions');
  const [showScreenModal, setShowScreenModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(null);
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; message: string } | null>(null);

  // Theme & AI CSS Studio + 3D Viewer + In-App Updater + Soundboard/Muted Warnings
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(loadSavedThemeLocal);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [model3DTarget, setModel3DTarget] = useState<Model3DViewerTarget | null>(null);
  const [soundboardActiveUserIds, setSoundboardActiveUserIds] = useState<Set<string>>(new Set());
  const [mutedTalkAlert, setMutedTalkAlert] = useState(false);

  const [localUpdateInfo, setLocalUpdateInfo] = useState<{
    appVersion: string;
    uiHash: string;
    isPackaged: boolean;
    isPortable: boolean;
  } | null>(null);
  const [updateManifest, setUpdateManifest] = useState<UpdateManifest | null>(null);
  // atualização pelo GitHub: baixa sozinha em segundo plano e avisa quando está pronta
  const [githubUpdate, setGithubUpdate] = useState<GithubUpdateState | null>(null);
  const [githubUpdateDismissed, setGithubUpdateDismissed] = useState(false);
  const [githubInstalling, setGithubInstalling] = useState(false);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const [updateApplying, setUpdateApplying] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{
    percent: number;
    loaded: number;
    total: number;
    speedMBps: number;
  } | null>(null);

  // Context Menu, Profile Popout, Full Profile Modal & @Mention request
  const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTarget | null>(null);
  const [profilePopout, setProfilePopout] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [profileModal, setProfileModal] = useState<{ userId: string; edit: boolean } | null>(null);
  const [mentionRequest, setMentionRequest] = useState<{ text: string; seq: number } | null>(null);
  // arquivos vindos do "Compartilhar no Waver" do Explorer
  const [incomingFilesRequest, setIncomingFilesRequest] = useState<{ files: File[]; seq: number } | null>(null);
  const [pendingShareFiles, setPendingShareFiles] = useState<SharedFileInfo[]>([]);
  const [shareBusy, setShareBusy] = useState(false);
  // threads, eventos, busca e enquetes
  const [threadView, setThreadView] = useState<{
    channelId: string;
    parent: ChatMessage;
    messages: ChatMessage[];
    loading: boolean;
  } | null>(null);
  const threadViewRef = useRef(threadView);
  threadViewRef.current = threadView;
  const [serverEvents, setServerEvents] = useState<ServerEvent[]>([]);
  const [showEvents, setShowEvents] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [jumpRequest, setJumpRequest] = useState<{ id: string; seq: number } | null>(null);
  const desktopPrefs = useDesktopPrefs();

  // Local mute & block lists
  const [localMutedUserIds, setLocalMutedUserIds] = useState<Set<string>>(() => loadStringSet('pulsecord_local_mutes'));
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(() => loadStringSet('pulsecord_blocked_users'));

  // Private incoming call state (supports Server DM, Private Group and Serverless LAN P2P)
  const [incomingCall, setIncomingCall] = useState<{
    dmRoomId: string;
    fromUser: User;
    callServerUrl?: string;
    peerUrl?: string;
    isLanP2p?: boolean;
    isGroup?: boolean;
    groupName?: string;
  } | null>(null);

  // Parsec / AnyDesk Remote Control + Per-Peer Permissions + ViGEm Virtual Xbox 360 state
  const [rcControllingPeer, setRcControllingPeer] = useState<{ socketId: string; name: string } | null>(null);
  // Parsec: host usando o PC (controle remoto pausado) — local = eu sou o host; remote = host que eu controlo
  const [rcLocalHostBusy, setRcLocalHostBusy] = useState(false);
  const [rcRemoteHostBusy, setRcRemoteHostBusy] = useState(false);
  const [rcControlledByPeer, setRcControlledByPeer] = useState<{ socketId: string; name: string } | null>(null);
  const [rcControlledPeers, setRcControlledPeers] = useState<RcPeerSession[]>([]);
  const [vigemStatus, setVigemStatus] = useState<string>('UNAVAILABLE');
  const [connectedGamepads, setConnectedGamepads] = useState<Array<{ index: number; id: string }>>([]);
  const [rcPendingPrompt, setRcPendingPrompt] = useState<{
    kind: 'request' | 'invite';
    fromSocketId: string;
    fromName: string;
  } | null>(null);

  // Voice, WebRTC & Audio state
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadAudioSettings);
  const [selfSocketId, setSelfSocketId] = useState('');
  const selfSocketIdRef = useRef('');
  selfSocketIdRef.current = selfSocketId;
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const mutedBeforeDeafenRef = useRef(false);
  const [hasLocalMic, setHasLocalMic] = useState(false);
  const [localCamStream, setLocalCamStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [localScreenStats, setLocalScreenStats] = useState<StreamStats | null>(null);
  const [localScreenLabel, setLocalScreenLabel] = useState('');
  const [remotePeers, setRemotePeers] = useState<Record<string, RemotePeerMedia>>({});
  const [spotlightRequest, setSpotlightRequest] = useState<{ key: string; seq: number } | null>(null);
  const remoteScreenStreams = useMemo(() => {
    const out: Record<string, MediaStream | null> = {};
    for (const [sid, m] of Object.entries(remotePeers)) out[sid] = m.screenStream || null;
    return out;
  }, [remotePeers]);
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>(loadPeerVolumes);
  const [streamAudioVolume, setStreamAudioVolume] = useState(0.85);

  // Soundboard, Music & Watch-Party Video state
  const [soundToasts, setSoundToasts] = useState<SoundPlayedToast[]>([]);
  const [musicState, setMusicState] = useState<MusicState | null>(null);
  const [musicCurrentSec, setMusicCurrentSec] = useState(0);
  const [musicDurationSec, setMusicDurationSec] = useState(0);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [videoVolume, setVideoVolume] = useState(0.85);

  // Refs for socket/async callbacks
  const socketRef = useRef<Socket | null>(null);
  const p2pCallSocketRef = useRef<Socket | null>(null);
  const isLanCallActiveRef = useRef(false);
  const rtcRef = useRef<WebRTCManager | null>(null);
  const serverIceServersRef = useRef<RTCIceServer[]>([]);
  const gamepadBridgeRef = useRef<GamepadBridge | null>(null);
  const soundboardTimersRef = useRef<Map<string, number>>(new Map());
  const mutedAlertTimerRef = useRef<number | null>(null);
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  const rejoinVoiceAfterReconnectRef = useRef<(socket: Socket) => void>(() => {});
  const refetchActiveTextChannelRef = useRef<() => void>(() => {});
  const navAreaRef = useRef<'server' | 'dms'>('server');
  const activeDmUserIdRef = useRef<string | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  const viewModeRef = useRef<'chat' | 'voice'>('chat');
  const userRef = useRef<User | null>(null);
  const localPeerInfoRef = useRef<LanPeer | null>(null);
  const lanPeersRef = useRef<LanPeer[]>([]);
  const rcControllingPeerRef = useRef<{ socketId: string; name: string } | null>(null);
  const rcControlledByPeerRef = useRef<{ socketId: string; name: string } | null>(null);
  const rcControlledPeersRef = useRef<RcPeerSession[]>([]);
  const dmArchiveSaveTimerRef = useRef<number | null>(null);
  const joinVoiceRef = useRef<(channelId: string) => Promise<void>>(async () => {});

  useEffect(() => {
    activeVoiceChannelIdRef.current = activeVoiceChannelId;
  }, [activeVoiceChannelId]);
  useEffect(() => {
    navAreaRef.current = navArea;
  }, [navArea]);
  useEffect(() => {
    activeDmUserIdRef.current = activeDmUserId;
  }, [activeDmUserId]);
  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);
  useEffect(() => {
    localStorage.setItem('pulsecord_fav_channels', JSON.stringify(Array.from(favoriteChannelIds)));
  }, [favoriteChannelIds]);
  useEffect(() => {
    localStorage.setItem('pulsecord_pinned_channels', JSON.stringify(Array.from(pinnedChannelIds)));
  }, [pinnedChannelIds]);
  useEffect(() => {
    localStorage.setItem('pulsecord_muted_channels', JSON.stringify(Array.from(mutedChannelIds)));
  }, [mutedChannelIds]);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  useEffect(() => {
    rcControllingPeerRef.current = rcControllingPeer;
    gamepadBridgeRef.current?.setActive(Boolean(rcControllingPeer), 0);
  }, [rcControllingPeer]);
  useEffect(() => {
    rcControlledByPeerRef.current = rcControlledByPeer;
  }, [rcControlledByPeer]);
  useEffect(() => {
    rcControlledPeersRef.current = rcControlledPeers;
  }, [rcControlledPeers]);
  useEffect(() => {
    localPeerInfoRef.current = localPeerInfo;
  }, [localPeerInfo]);
  useEffect(() => {
    lanPeersRef.current = lanPeers;
  }, [lanPeers]);

  const api = useMemo(() => (serverUrl && token ? new ApiClient(serverUrl, token) : null), [serverUrl, token]);

  const showToast = useCallback((message: string, kind: 'error' | 'info' = 'error') => {
    setToast({ kind, message });
    window.setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 5500);
  }, []);

  const showError = useCallback((msg: string) => showToast(msg, 'error'), [showToast]);
  // Pedido de permissão para gravar e aviso de gravação: vale para o servidor e para a chamada direta na rede local.
  const bindRecConsentEvents = useCallback(
    (sock: Socket) => {
      sock.on('voice:record-consent-ask', ({ requestId, from }: { requestId: string; from: string }) => {
        audioEngine.playUiTone('recording_on');
        setRecConsentAsk({ requestId, from });
      });
      sock.on('voice:record-consent-closed', ({ requestId }: { requestId: string }) => {
        setRecConsentAsk((cur) => (cur && cur.requestId === requestId ? null : cur));
      });
      sock.on(
        'voice:record-consent-result',
        ({ ok, by, reason }: { ok: boolean; by?: string | null; reason?: string | null }) => {
          setRecRequestPending(false);
          if (ok) {
            startRecordingNowRef.current();
            return;
          }
          showToast(
            reason === 'declined'
              ? `${by || 'Alguém'} não permitiu gravar a chamada.`
              : reason === 'timeout'
              ? 'Nem todos responderam ao pedido de gravação a tempo. A chamada não foi gravada.'
              : reason === 'not-approved'
              ? 'A gravação precisa da permissão de todos na chamada.'
              : 'O pedido de gravação foi cancelado.',
            'error'
          );
        }
      );
      sock.on(
        'voice:recording-changed',
        ({ socketId, displayName, recording }: { socketId: string; displayName: string; recording: 'record' | 'clips' | null }) => {
          if (recording === 'record') audioEngine.playUiTone('recording_on');
          else if (recording === null) audioEngine.playUiTone('recording_off');
          if (socketId === sock.id) return;
          showToast(
            recording === 'record'
              ? `🔴 ${displayName} começou a gravar a chamada.`
              : recording === 'clips'
              ? `${displayName} está com os clipes ligados (pode salvar trechos da chamada).`
              : `${displayName} parou de gravar.`,
            'info'
          );
        }
      );
    },
    [showToast]
  );

  // Load, apply & persist Theme + CSS AI Studio (plus Ctrl+Shift+F12 Safe Mode toggle!)
  useEffect(() => {
    applyThemeConfig(themeConfig);
  }, [themeConfig]);

  useEffect(() => {
    window.electronAPI?.loadThemeConfig?.().then((saved) => {
      if (saved) setThemeConfig({ ...DEFAULT_THEME_CONFIG, ...saved });
    }).catch(() => {});
  }, []);

  const handleUpdateThemeConfig = useCallback((next: ThemeConfig) => {
    setThemeConfig(next);
    window.electronAPI?.saveThemeConfig?.(next).catch(() => {});
  }, []);

  useEffect(() => {
    const onSafeKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'F12') {
        e.preventDefault();
        setThemeConfig((prev) => {
          const next = { ...prev, safeMode: !prev.safeMode };
          window.electronAPI?.saveThemeConfig?.(next).catch(() => {});
          showToast(
            next.safeMode
              ? 'Modo Seguro de Tema ativado (CSS customizado pausado).'
              : 'CSS customizado reativado!',
            'info'
          );
          return next;
        });
      }
    };
    window.addEventListener('keydown', onSafeKey);
    return () => window.removeEventListener('keydown', onSafeKey);
  }, [showToast]);

  // STUN/TURN do servidor conectado (credenciais do TURN expiram em 12 h: renova a cada 6 h)
  useEffect(() => {
    if (!token || !api) return;
    let alive = true;
    const load = () =>
      api
        .getIceServers()
        .then((r) => {
          if (!alive) return;
          serverIceServersRef.current = r.iceServers || [];
          rtcRef.current?.setServerIceServers(serverIceServersRef.current);
        })
        .catch(() => {
          if (!alive) return;
          serverIceServersRef.current = [];
          rtcRef.current?.setServerIceServers([]);
        });
    load();
    const id = window.setInterval(load, 6 * 3600 * 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [token, api]);

  // In-App Auto-Updater checks & progress subscription
  useEffect(() => {
    if (!window.electronAPI?.getLocalUpdateInfo) return;
    window.electronAPI.getLocalUpdateInfo().then(setLocalUpdateInfo).catch(() => {});
    const unsubProg = window.electronAPI.onUpdateProgress?.((p) => setUpdateProgress(p));
    return () => {
      unsubProg?.();
    };
  }, []);

  useEffect(() => {
    const e = window.electronAPI;
    if (!e?.onGithubUpdateState) return;
    e.getGithubUpdateState?.().then(setGithubUpdate).catch(() => {});
    return e.onGithubUpdateState((st) => setGithubUpdate(st));
  }, []);
  // em chamada, o download da atualização espera (não disputa a internet com a voz/vídeo)
  useEffect(() => {
    window.electronAPI?.setUpdateBusy?.(Boolean(activeVoiceChannelId));
  }, [activeVoiceChannelId]);
  // ícone da bandeja: linha de som enquanto está em chamada; mexe quando você fala, vermelha se mutado
  useEffect(() => {
    const inCall = Boolean(activeVoiceChannelId);
    window.electronAPI?.setTrayVoiceState?.({
      inCall,
      muted: inCall && (muted || deafened),
      speaking: inCall && !muted && !deafened && localSpeaking,
    });
  }, [activeVoiceChannelId, muted, deafened, localSpeaking]);

  const handleInstallGithubUpdate = useCallback(async () => {
    if (!window.electronAPI?.installGithubUpdate) return;
    if (
      activeVoiceChannelIdRef.current &&
      !window.confirm(
        githubUpdate?.mode === 'patch' && githubUpdate.renderOnly
          ? 'Aplicar agora recarrega a janela (1 segundo) e tira você da chamada. Continuar?'
          : 'Atualizar agora vai reabrir o Waver e tirar você da chamada. Continuar?'
      )
    )
      return;
    setGithubInstalling(true);
    try {
      await window.electronAPI.installGithubUpdate();
    } catch (err: unknown) {
      setGithubInstalling(false);
      showError((err as Error).message || 'Não foi possível instalar a atualização.');
    }
  }, [showError, githubUpdate?.mode, githubUpdate?.renderOnly]);

  const checkUpdates = useCallback(async () => {
    if (!token || !api) return;
    try {
      const m = await api.getUpdateManifest();
      setUpdateManifest(m);
      setUpdateBannerDismissed(false);
    } catch {
      // ignore if offline
    }
  }, [token, api]);

  useEffect(() => {
    if (!token) return;
    checkUpdates();
  }, [token, serverUrl, checkUpdates]);

  const updateKindAvailable = useMemo<'none' | 'ui' | 'installer'>(() => {
    if (!updateManifest || !localUpdateInfo || appMode === 'host') return 'none';
    if (compareVersions(updateManifest.version, localUpdateInfo.appVersion) > 0) {
      return updateManifest.hasInstaller ? 'installer' : updateManifest.hasUiBundle ? 'ui' : 'none';
    }
    if (
      localUpdateInfo.isPackaged &&
      updateManifest.hasUiBundle &&
      updateManifest.uiHash &&
      localUpdateInfo.uiHash &&
      updateManifest.uiHash !== localUpdateInfo.uiHash
    ) {
      return 'ui';
    }
    return 'none';
  }, [updateManifest, localUpdateInfo, appMode]);

  const handleApplyUpdate = useCallback(async () => {
    if (!updateManifest) return;
    if (!window.electronAPI?.isElectron) {
      window.location.reload();
      return;
    }
    setUpdateApplying(true);
    try {
      const useUiOnly =
        updateManifest.hasUiBundle &&
        localUpdateInfo &&
        compareVersions(updateManifest.version, localUpdateInfo.appVersion) === 0;
      if (useUiOnly) {
        const res = await window.electronAPI.applyUiUpdate(normalizeServerUrl(serverUrl));
        setLocalUpdateInfo((prev) => (prev ? { ...prev, uiHash: res.uiHash } : prev));
        showToast('Interface atualizada com sucesso!', 'info');
        setUpdateApplying(false);
      } else if (updateManifest.hasInstaller) {
        await window.electronAPI.downloadAndInstallUpdate({
          serverUrl: normalizeServerUrl(serverUrl),
          expectedSha256: updateManifest.installerSha256,
          installerName: updateManifest.installerName,
        });
      }
    } catch (err: unknown) {
      setUpdateApplying(false);
      setUpdateProgress(null);
      showError((err as Error).message || 'Erro ao aplicar atualização.');
    }
  }, [updateManifest, localUpdateInfo, serverUrl, showError, showToast]);

  // Persist local mute / block / volume preferences
  useEffect(() => {
    try {
      localStorage.setItem('pulsecord_local_mutes', JSON.stringify(Array.from(localMutedUserIds)));
    } catch {
      // ignore
    }
  }, [localMutedUserIds]);

  useEffect(() => {
    try {
      localStorage.setItem('pulsecord_blocked_users', JSON.stringify(Array.from(blockedUserIds)));
    } catch {
      // ignore
    }
  }, [blockedUserIds]);

  useEffect(() => {
    try {
      localStorage.setItem('pulsecord_peer_volumes', JSON.stringify(peerVolumes));
    } catch {
      // ignore
    }
  }, [peerVolumes]);

  // Load encrypted local DM archive once at startup
  useEffect(() => {
    loadLocalDmArchive()
      .then((vault) => {
        if (vault && Object.keys(vault).length > 0) {
          setDmMessagesByPair((prev) => {
            const merged = { ...vault };
            for (const [k, list] of Object.entries(prev)) {
              merged[k] = mergeMessageLists(merged[k], list);
            }
            return merged;
          });
        }
      })
      .catch(() => {});
  }, []);

  const schedulePersistDmArchive = useCallback((nextMap: Record<string, ChatMessage[]>) => {
    if (dmArchiveSaveTimerRef.current) window.clearTimeout(dmArchiveSaveTimerRef.current);
    dmArchiveSaveTimerRef.current = window.setTimeout(() => {
      persistLocalDmArchive(nextMap);
    }, 500);
  }, []);

  // Subscribe to Electron embedded Host status, LAN discovery, LAN P2P DMs, ViGEm & Activity Detector
  const toggleMuteRef = useRef<() => void>(() => {});
  const toggleDeafenRef = useRef<() => void>(() => {});
  const overlayToggleRef = useRef<() => void>(() => {});
  const clipSaveRef = useRef<() => void>(() => {});
  const isStageModRef = useRef(false);
  const localMicStreamRef = useRef<MediaStream | null>(null);
  const desktopNotifyRef = useRef<(msg: ChatMessage, kind: 'channel' | 'dm') => void>(() => {});
  // Controle remoto: só aceita um "aceito" de quem EU convidei/pedi há pouco (um servidor ou membro mal-intencionado
  // não consegue ligar o controle do meu PC mandando um aceite falso)
  const rcOutgoingRef = useRef(new Map<string, { kind: 'invite' | 'request'; at: number }>());
  const takeRcOutgoing = (socketId: string, kind: 'invite' | 'request') => {
    const p = rcOutgoingRef.current.get(socketId);
    if (!p || p.kind !== kind || Date.now() - p.at > 3 * 60 * 1000) return false;
    rcOutgoingRef.current.delete(socketId);
    return true;
  };

  // Atalhos globais (funcionam com o Waver em segundo plano, inclusive dentro de jogos)
  useEffect(() => {
    if (!window.electronAPI?.setGlobalShortcuts) return;
    window.electronAPI
      .setGlobalShortcuts({ ...desktopPrefs.shortcuts })
      .then((r) => {
        if (r && !r.ok && r.failed?.length) console.warn('[Waver] Atalhos em uso por outro programa:', r.failed.join(', '));
      })
      .catch(() => {});
  }, [desktopPrefs.shortcuts.mute, desktopPrefs.shortcuts.deafen, desktopPrefs.shortcuts.overlay, desktopPrefs.shortcuts.clip]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const offShortcut = api.onGlobalShortcut?.((action) => {
      if (action === 'mute') toggleMuteRef.current();
      else if (action === 'deafen') toggleDeafenRef.current();
      else if (action === 'overlay') overlayToggleRef.current();
      else if (action === 'clip') clipSaveRef.current();
    });
    const offNotify = api.onNotificationClicked?.((route: NotificationRoute) => {
      if (!route) return;
      if (route.type === 'channel') {
        setNavArea('server');
        setActiveTextChannelId(route.id);
      } else {
        const uid = route.userId;
        setNavArea('dms');
        setActiveGroupId(null);
        setActiveDmUserId(uid);
        setUnreadDmByUser((prev) => {
          if (!prev[uid]) return prev;
          const copy = { ...prev };
          delete copy[uid];
          return copy;
        });
      }
      setViewMode('chat');
    });
    const addShares = (list: SharedFileInfo[]) => {
      if (!Array.isArray(list) || !list.length) return;
      setPendingShareFiles((prev) => {
        const seen = new Set(prev.map((f) => f.path));
        return [...prev, ...list.filter((f) => !seen.has(f.path))];
      });
    };
    api.takePendingShares?.().then(addShares).catch(() => {});
    const offShare = api.onSharedFiles?.(addShares);
    return () => {
      offShortcut?.();
      offNotify?.();
      offShare?.();
    };
  }, []);

  useEffect(() => {
    const bridge = new GamepadBridge({
      onReport: (rep) => {
        const target = rcControllingPeerRef.current;
        if (!target) return;
        rtcRef.current?.sendRemoteInput(target.socketId, rep);
      },
      onGamepadsChanged: (pads) => setConnectedGamepads(pads),
    });
    gamepadBridgeRef.current = bridge;
    setConnectedGamepads(bridge.getConnectedGamepads());
    return () => {
      bridge.destroy();
      gamepadBridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    window.electronAPI.hostStatus().then((st) => setHostStatus(st)).catch(() => {});
    window.electronAPI.lanGetServers().then((list) => setLanServers(list)).catch(() => {});
    window.electronAPI.rcGetStatus?.().then((st) => setVigemStatus(st?.vigemStatus || 'UNAVAILABLE')).catch(() => {});
    window.electronAPI.lanPeersGetSelf?.().then((info) => {
      if (info) {
        setLocalPeerInfo(info);
        setLocalP2pBaseUrl(info.p2pUrl);
      }
    }).catch(() => {});
    window.electronAPI.lanPeersGet?.().then((list) => setLanPeers(list)).catch(() => {});
    window.electronAPI.lanPeersGetGroups?.().then((list) => {
      if (Array.isArray(list)) setDmGroups((prev) => mergePrivateGroups(prev, list));
    }).catch(() => {});

    const unsubHost = window.electronAPI.onHostStatusChange((st) => setHostStatus(st));
    const unsubLan = window.electronAPI.onLanServersUpdate((list) => setLanServers(list));
    const unsubAct = window.electronAPI.onActivityUpdated((state) => {
      socketRef.current?.emit('user:activity', state);
      const hide = userRef.current?.statusType === 'invisible';
      window.electronAPI?.lanPeersUpdateIdentity?.({ currentActivity: hide ? null : state.currentActivity }).catch(() => {});
    });
    const unsubRcStatus = window.electronAPI.onRcStatusChanged?.((st) => setVigemStatus(st?.vigemStatus || 'UNAVAILABLE'));
    const unsubRcRumble = window.electronAPI.onRcRumble?.((r) => {
      gamepadBridgeRef.current?.playRumble(r.large, r.small);
    });
    const unsubTrayMute = window.electronAPI.onTrayToggleMute?.(() => toggleMuteRef.current());
    const unsubTrayDeaf = window.electronAPI.onTrayToggleDeafen?.(() => toggleDeafenRef.current());

    const unsubLanPeers = window.electronAPI.onLanPeersUpdated?.((list) => setLanPeers(list));
    const unsubLanDm = window.electronAPI.onLanDmMessage?.(({ message, fromPeerId }) => {
      const myPeerId = localPeerInfoRef.current?.peerId;
      const pairKey = message.pairKey || (myPeerId ? getDmPairKey(myPeerId, fromPeerId) : '');
      if (!pairKey) return;
      setDmMessagesByPair((prev) => {
        const cur = prev[pairKey] || [];
        if (cur.some((m) => m.id === message.id)) return prev;
        const next = { ...prev, [pairKey]: [...cur, message] };
        schedulePersistDmArchive(next);
        return next;
      });
      if (
        fromPeerId &&
        fromPeerId !== myPeerId &&
        !(navAreaRef.current === 'dms' && activeDmUserIdRef.current === fromPeerId && viewModeRef.current === 'chat')
      ) {
        setUnreadDmByUser((prev) => ({ ...prev, [fromPeerId]: (prev[fromPeerId] || 0) + 1 }));
        desktopNotifyRef.current({ ...message, authorId: fromPeerId }, 'dm');
      }
    });
    const unsubLanPin = window.electronAPI.onLanDmPinned?.(({ pairKey, messageId, pinned, pinnedAt, pinnedBy }) => {
      if (!pairKey) return;
      setDmMessagesByPair((prev) => {
        const list = prev[pairKey];
        if (!list) return prev;
        const nextList = list.map((m) =>
          m.id === messageId
            ? { ...m, pinned: Boolean(pinned), pinnedAt: pinnedAt || null, pinnedBy: pinnedBy || null }
            : m
        );
        const next = { ...prev, [pairKey]: nextList };
        schedulePersistDmArchive(next);
        return next;
      });
    });
    const unsubLanCallIn = window.electronAPI.onLanCallIncoming?.(({ dmRoomId, callServerUrl, fromPeer }) => {
      if (activeVoiceChannelIdRef.current === dmRoomId) return;
      audioEngine.playUiTone('join');
      const isGrp = dmRoomId.startsWith('group:');
      setIncomingCall({
        dmRoomId,
        callServerUrl,
        peerUrl: fromPeer.p2pUrl,
        isLanP2p: true,
        isGroup: isGrp,
        fromUser: {
          id: fromPeer.peerId,
          username: fromPeer.username,
          displayName: fromPeer.displayName,
          avatarColor: fromPeer.avatarColor || '#5865F2',
          avatarUrl: fromPeer.avatarUrl || null,
          online: true,
          role: 'member',
          roleIds: [],
          createdAt: Date.now(),
        },
      });
    });
    const unsubLanCallResp = window.electronAPI.onLanCallResponded?.(({ accepted, fromPeer }) => {
      if (!accepted) {
        showToast(`${fromPeer?.displayName || 'Amigo'} recusou a chamada privada P2P.`, 'info');
      }
    });
    const unsubLanGroupUpd = window.electronAPI.onLanGroupUpdated?.(({ group }) => {
      if (group) setDmGroups((prev) => upsertPrivateGroup(prev, group));
    });
    const unsubLanGroupMsg = window.electronAPI.onLanGroupMessage?.(({ groupId, message }) => {
      setGroupMessagesById((prev) => {
        const cur = prev[groupId] || [];
        if (cur.some((m) => m.id === message.id)) return prev;
        return { ...prev, [groupId]: [...cur, message] };
      });
      const myPeerId = localPeerInfoRef.current?.peerId;
      if (
        message.authorId !== myPeerId &&
        !(navAreaRef.current === 'dms' && activeGroupIdRef.current === groupId && viewModeRef.current === 'chat')
      ) {
        setUnreadByGroup((prev) => ({ ...prev, [groupId]: (prev[groupId] || 0) + 1 }));
        // Ocupado: sem som de mensagem
        if (userRef.current?.statusType !== 'dnd' && getDesktopPrefs().notificationSound) audioEngine.playUiTone('message_dm');
      }
    });
    const unsubLanGroupPin = window.electronAPI.onLanGroupPinned?.(({ groupId, messageId, pinned, pinnedAt, pinnedBy }) => {
      setGroupMessagesById((prev) => {
        const list = prev[groupId];
        if (!list) return prev;
        return {
          ...prev,
          [groupId]: list.map((m) =>
            m.id === messageId
              ? { ...m, pinned: Boolean(pinned), pinnedAt: pinnedAt || null, pinnedBy: pinnedBy || null }
              : m
          ),
        };
      });
    });
    const unsubLanTrello = window.electronAPI.onLanTrelloUpdated?.(({ scopeKey, boards }) => {
      if (scopeKey && Array.isArray(boards)) {
        setTrelloBoardsByScope((prev) => ({ ...prev, [scopeKey]: boards }));
      }
    });
    const unsubEmergency = window.electronAPI.onRcEmergencyStopped(() => {
      const peer = rcControlledByPeerRef.current;
      const activeSock = p2pCallSocketRef.current || socketRef.current;
      if (peer) {
        activeSock?.emit('rc:revoke', { targetSocketId: peer.socketId });
      }
      for (const s of rcControlledPeersRef.current) {
        if (s.socketId !== peer?.socketId) activeSock?.emit('rc:revoke', { targetSocketId: s.socketId });
      }
      setRcControlledByPeer(null);
      setRcControlledPeers([]);
      setRcControllingPeer(null);
      showToast('Controle remoto encerrado imediatamente (Ctrl+Shift+Esc).', 'info');
    });
    return () => {
      unsubHost();
      unsubLan();
      unsubAct();
      unsubRcStatus?.();
      unsubRcRumble?.();
      unsubTrayMute?.();
      unsubTrayDeaf?.();
      unsubLanPeers?.();
      unsubLanDm?.();
      unsubLanPin?.();
      unsubLanCallIn?.();
      unsubLanCallResp?.();
      unsubLanGroupUpd?.();
      unsubLanGroupMsg?.();
      unsubLanGroupPin?.();
      unsubLanTrello?.();
      unsubEmergency();
    };
  }, [showToast, schedulePersistDmArchive]);

  // Global Push-to-Talk (PTT) listener
  useEffect(() => {
    if (audioSettings.inputMode !== 'ptt' || !activeVoiceChannelId) {
      rtcRef.current?.setPttPressed(false);
      return;
    }

    const pttCode = audioSettings.pttKey || 'KeyV';
    // só campos onde se DIGITA bloqueiam o PTT; slider de volume, checkbox e botões não
    // (antes, clicar no volume do vídeo deixava o foco no slider e a tecla parava de funcionar)
    const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' && NON_TEXT_INPUTS.has(((target as HTMLInputElement).type || 'text').toLowerCase())) return false;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
        // Still allow function/modifier keys while typing
        return !/^(F\d+|CapsLock|ControlLeft|ControlRight|AltLeft|AltRight|ShiftLeft|ShiftRight)$/.test(pttCode);
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== pttCode || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      rtcRef.current?.setPttPressed(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttCode) return;
      rtcRef.current?.setPttPressed(false);
    };
    const onBlur = () => {
      rtcRef.current?.setPttPressed(false);
    };

    // No app desktop a tecla também chega pelo processo principal: funciona com o foco
    // dentro do player do YouTube (iframe), onde a página não recebe o teclado.
    window.electronAPI?.setPttKey?.(pttCode);
    const unsubPttIpc = window.electronAPI?.onPttKey?.(({ down, repeat }) => {
      if (down) {
        if (repeat || isTypingTarget(document.activeElement)) return;
        rtcRef.current?.setPttPressed(true);
      } else {
        rtcRef.current?.setPttPressed(false);
      }
    });
    const onBlurSafe = () => {
      // ao clicar no iframe a janela "perde" o foco para ele, mas o app continua em primeiro plano:
      // nesse caso o IPC cuida da tecla, então não solta o PTT aqui
      if (unsubPttIpc && document.activeElement?.tagName === 'IFRAME') return;
      onBlur();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlurSafe);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlurSafe);
      unsubPttIpc?.();
      window.electronAPI?.setPttKey?.(null);
      rtcRef.current?.setPttPressed(false);
    };
  }, [audioSettings.inputMode, audioSettings.pttKey, activeVoiceChannelId]);

  const handleScanLan = useCallback(() => {
    window.electronAPI?.lanScanNow().then((list) => setLanServers(list)).catch(() => {});
    window.electronAPI?.lanPeersScan?.().then((list) => setLanPeers(list)).catch(() => {});
  }, []);

  const handleStopHost = useCallback(async () => {
    if (!window.electronAPI?.isElectron) return;
    const st = await window.electronAPI.hostStop();
    setHostStatus(st);
  }, []);

  const handleSetHostPassword = useCallback(async (password: string) => {
    if (!window.electronAPI?.isElectron) return;
    const st = await window.electronAPI.hostSetPassword(password);
    setHostStatus(st);
  }, []);

  const handleModeChange = useCallback(async (nextMode: AppMode): Promise<HostStatus | null> => {
    setAppMode(nextMode);
    localStorage.setItem('pulsecord_mode', nextMode);
    if (!window.electronAPI?.isElectron) return null;

    if (nextMode === 'host') {
      const st = await window.electronAPI.hostStart(3000);
      setHostStatus(st);
      if (st.running && st.localUrl) setServerUrl(st.localUrl);
      return st;
    } else {
      const st = await window.electronAPI.hostStop();
      setHostStatus(st);
      return st;
    }
  }, []);

  const handleStartTunnel = useCallback(async () => {
    if (!window.electronAPI?.isElectron) return;
    const st = await window.electronAPI.hostStartTunnel();
    setHostStatus(st);
  }, []);

  const handleStopTunnel = useCallback(async () => {
    if (!window.electronAPI?.isElectron) return;
    const st = await window.electronAPI.hostStopTunnel();
    setHostStatus(st);
  }, []);

  // Sync AudioEngine & WebRTCManager settings
  useEffect(() => {
    audioEngine.setServerUrl(serverUrl);
    const outScale = Math.max(0, Math.min(2, audioSettings.outputVolume ?? 1));
    audioEngine.setVolumes(
      Math.min(1, audioSettings.soundboardVolume * outScale),
      Math.min(1, audioSettings.musicVolume * outScale)
    );
    audioEngine.setOutputDevice(audioSettings.outputDeviceId);
    audioEngine.setDeafened(deafened || Boolean(user?.serverDeafened));
    rtcRef.current?.updateSettings(audioSettings);
    try {
      localStorage.setItem('pulsecord_audio_settings', JSON.stringify(audioSettings));
    } catch {
      // ignore
    }
  }, [audioSettings, deafened, user?.serverDeafened, serverUrl]);

  // Restore saved session OR local serverless identity on boot
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = localStorage.getItem('pulsecord_session');
      // hospedar é contínuo: se você hospeda um servidor salvo mas abriu em outro, o seu continua no ar
      if (window.electronAPI?.isElectron) {
        let activeMode: AppMode | undefined;
        try {
          activeMode = raw ? (JSON.parse(raw) as { mode?: AppMode }).mode : undefined;
        } catch {
          activeMode = undefined;
        }
        if (activeMode !== 'host' && loadSavedServers().some((s) => s.mode === 'host')) {
          window.electronAPI
            .hostStart(3000)
            .then((st) => {
              if (!cancelled) setHostStatus(st);
            })
            .catch(() => {});
        }
      }
      if (raw) {
        let parsed: { serverUrl: string; token: string; mode?: AppMode } | null = null;
        try {
          parsed = JSON.parse(raw) as { serverUrl: string; token: string; mode?: AppMode };
          if (parsed.mode === 'host' && window.electronAPI?.isElectron) {
            const st = await window.electronAPI.hostStart(3000);
            if (!cancelled) {
              setHostStatus(st);
              if (st.running) setServerUrl(st.localUrl);
            }
          }
          if (parsed.serverUrl && parsed.token) {
            const client = new ApiClient(parsed.serverUrl, parsed.token);
            const res = await client.me();
            if (cancelled) return;
            if (parsed.mode) setAppMode(parsed.mode);
            setServerUrl(normalizeServerUrl(parsed.serverUrl));
            setToken(parsed.token);
            setUser(res.user);
            setServer(res.server);
            setNavArea('server');
            setBooting(false);
            return;
          }
        } catch (err: any) {
          const status = err?.status;
          if (status === 401 || status === 403 || !parsed) {
            // token recusado (ou sessão corrompida): aí sim precisa entrar de novo
            localStorage.removeItem('pulsecord_session');
            if (parsed?.serverUrl) setSavedServers((prev) => upsertSavedServer(prev, { serverUrl: parsed!.serverUrl, token: '' }));
          } else if (!cancelled && parsed?.serverUrl) {
            // servidor desligado / sem rede: mantém a sessão e reconecta quando o host voltar
            setAutoReconnectUrl(parsed.serverUrl);
          }
        }
      }

      // No server session -> check local profile identity (opens straight into Serverless LAN DMs!)
      try {
        const rawLocal = localStorage.getItem('pulsecord_local_identity');
        if (rawLocal) {
          const ident = JSON.parse(rawLocal) as {
            displayName: string;
            username: string;
            avatarColor?: string;
            avatarDataUrl?: string;
          };
          const gp = await loadLocalGlobalProfile();
          const selfPeer = window.electronAPI?.lanPeersGetSelf
            ? await window.electronAPI.lanPeersGetSelf().catch(() => null)
            : null;
          if (cancelled) return;
          const uid = selfPeer?.peerId || `local_${ident.username}`;
          const localUser: User = {
            id: uid,
            username: ident.username,
            displayName: gp?.displayName || ident.displayName,
            avatarColor: ident.avatarColor || gp?.bannerColor || '#5865F2',
            avatarUrl: gp?.avatarDataUrl || ident.avatarDataUrl || null,
            bannerColor: gp?.bannerColor || ident.avatarColor || '#5865F2',
            bannerUrl: gp?.bannerDataUrl || undefined,
            bio: gp?.bio || '',
            pronouns: gp?.pronouns || '',
            statusType: gp?.statusType || 'online',
            customStatusEmoji: gp?.customStatusEmoji || '',
            customStatusText: gp?.customStatusText || '',
            avatarDecoration: gp?.avatarDecoration || 'none',
            nameStyle: gp?.nameStyle || 'default',
            profileEffect: gp?.profileEffect || 'none',
            profileBgUrl: gp?.profileBgDataUrl || null,
            connections: gp?.connections || [],
            online: true,
            role: 'member',
            roleIds: [],
            createdAt: Date.now(),
          };
          setUser(localUser);
          setServer(null);
          setToken(null);
          setNavArea('dms');
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep LAN Peer identity in sync whenever profile or localPeerInfo updates
  useEffect(() => {
    if (!user?.id || !window.electronAPI?.lanPeersUpdateIdentity) return;
    let cancelled = false;
    loadLocalGlobalProfile().then((gp) => {
      if (cancelled) return;
      window.electronAPI
        ?.lanPeersUpdateIdentity({
          username: user.username,
          displayName: user.displayName,
          avatarColor: user.avatarColor,
          avatarDataUrl: gp?.avatarDataUrl || (user.avatarUrl?.startsWith('data:') ? user.avatarUrl : undefined),
          bannerColor: user.bannerColor || gp?.bannerColor,
          bio: user.bio || gp?.bio,
          statusType: user.statusType || 'online',
          customStatusEmoji: user.customStatusEmoji || '',
          customStatusText: user.customStatusText || '',
          currentActivity: user.statusType === 'invisible' ? null : user.currentActivity || null,
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    user?.username,
    user?.displayName,
    user?.avatarColor,
    user?.avatarUrl,
    user?.customStatusEmoji,
    user?.customStatusText,
    user?.statusType,
  ]);

  // Automatic Global Profile + Game Activity sync across any LAN server joined!
  useEffect(() => {
    if (!token || !user?.id || !api) return;
    let cancelled = false;
    (async () => {
      try {
        const globalProfile = await loadLocalGlobalProfile();
        const actState = window.electronAPI?.getActivityState
          ? await window.electronAPI.getActivityState()
          : { currentActivity: null, recentActivities: [] };
        if (cancelled) return;

        if (globalProfile || actState.currentActivity || actState.recentActivities.length > 0) {
          const payload: GlobalProfile & {
            currentActivity?: User['currentActivity'];
            recentActivities?: User['recentActivities'];
          } = {
            ...(globalProfile || {}),
            currentActivity: actState.currentActivity,
            recentActivities: actState.recentActivities,
          };
          const res = await api.syncGlobalProfile(payload);
          if (!cancelled && res.user) setUser(res.user);
        }
      } catch {
        // non-fatal sync error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.id, serverUrl, api]);

  // Helper to revoke any active AnyDesk/Parsec remote control session cleanly
  const revokeRemoteControlInternal = useCallback((notifyRemote = true) => {
    const activeSock = p2pCallSocketRef.current || socketRef.current;
    const controlledBy = rcControlledByPeerRef.current;
    if (controlledBy) {
      window.electronAPI?.rcDisable().catch(() => {});
      if (notifyRemote) activeSock?.emit('rc:revoke', { targetSocketId: controlledBy.socketId });
    }
    for (const peer of rcControlledPeersRef.current) {
      if (peer.socketId !== controlledBy?.socketId && notifyRemote) {
        activeSock?.emit('rc:revoke', { targetSocketId: peer.socketId });
      }
    }
    if (rcControllingPeerRef.current && notifyRemote) {
      activeSock?.emit('rc:revoke', { targetSocketId: rcControllingPeerRef.current.socketId });
    }
    setRcControlledByPeer(null);
    setRcControlledPeers([]);
    setRcControllingPeer(null);
    setRcPendingPrompt(null);
  }, []);

  // Parsec: avisa quem está controlando quando o host pega/solta o mouse e teclado físicos
  useEffect(() => {
    if (!window.electronAPI?.onRcHostActivity) return;
    const unsub = window.electronAPI.onRcHostActivity(({ active }) => {
      setRcLocalHostBusy(active);
      for (const peer of rcControlledPeersRef.current) {
        rtcRef.current?.sendRemoteInput(peer.socketId, { type: 'host-busy', busy: active });
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!rcControllingPeer) setRcRemoteHostBusy(false);
  }, [rcControllingPeer]);

  // Forward ViGEm controller rumble from Host PC to the active remote controller!
  useEffect(() => {
    if (!window.electronAPI?.onRcRumble) return;
    const unsub = window.electronAPI.onRcRumble((r) => {
      for (const peer of rcControlledPeersRef.current) {
        if (peer.permissions.gamepad) {
          rtcRef.current?.sendRemoteInput(peer.socketId, {
            type: 'rumble',
            slot: r.slot,
            largeMotor: r.large,
            smallMotor: r.small,
          });
        }
      }
    });
    return () => unsub();
  }, []);

  const syncClockWithSocket = useCallback((sock: Socket) => {
    const samples: number[] = [];
    const ping = () => {
      if (!sock.connected) return;
      const t0 = Date.now();
      sock.emit('clock:sync', t0, (res: { serverNow: number; clientSentAt: number }) => {
        if (!res || typeof res.serverNow !== 'number') return;
        const t1 = Date.now();
        const rtt = t1 - t0;
        if (rtt > 1500) return;
        const offset = Math.round(res.serverNow - (t0 + rtt / 2));
        samples.push(offset);
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 0;
        setClockOffsetMs(median);
        audioEngine.setClockOffset(median);
      });
    };
    ping();
    window.setTimeout(ping, 150);
    window.setTimeout(ping, 350);
  }, []);

  // Initialize WebRTCManager whenever we have any identity (Server OR Serverless LAN!)
  useEffect(() => {
    if (!user?.id) return;

    const rtc = new WebRTCManager(audioSettings, {
      onPeersUpdated: (peers) => setRemotePeers(peers),
      onLocalStateUpdated: (st) => {
        setHasLocalMic(Boolean(st.micStream && st.micStream.getAudioTracks().length > 0));
        localMicStreamRef.current = st.micStream;
        setLocalCamStream(st.camStream);
        setLocalScreenStream(st.screenStream);
        setLocalSpeaking(st.localSpeaking);
        setLocalScreenStats(st.localScreenStats);
        setLocalScreenLabel(st.screenLabel);
      },
      onRemoteInputReceived: (fromSocketId, event) => {
        if (event.type === 'host-busy') {
          if (rcControllingPeerRef.current?.socketId === fromSocketId) setRcRemoteHostBusy(Boolean(event.busy));
          return;
        }
        if (event.type === 'rumble') {
          if (rcControllingPeerRef.current?.socketId === fromSocketId) {
            gamepadBridgeRef.current?.playRumble(event.largeMotor ?? 0, event.smallMotor ?? 0);
          }
          return;
        }
        // Host security & Parsec permission gate!
        const session = rcControlledPeersRef.current.find((p) => p.socketId === fromSocketId);
        const legacyMatch = rcControlledByPeerRef.current?.socketId === fromSocketId;
        if (!session && !legacyMatch) return;
        const perms = session?.permissions || { mouse: true, keyboard: true, gamepad: true };
        if (
          (event.type === 'mousemove' ||
            event.type === 'mouserel' ||
            event.type === 'mousedown' ||
            event.type === 'mouseup' ||
            event.type === 'wheel') &&
          !perms.mouse
        ) {
          return;
        }
        if ((event.type === 'keydown' || event.type === 'keyup') && !perms.keyboard) return;
        if (event.type === 'gamepad' && !perms.gamepad) return;
        window.electronAPI?.rcExecuteInput(event);
      },
      onMutedMicSpeaking: () => {
        audioEngine.playUiTone('muted_speaking_warning');
        setMutedTalkAlert(true);
        if (mutedAlertTimerRef.current) window.clearTimeout(mutedAlertTimerRef.current);
        mutedAlertTimerRef.current = window.setTimeout(() => setMutedTalkAlert(false), 4500);
      },
      onError: (msg) => showError(msg),
    });
    rtc.setServerModeration(Boolean(user.serverMuted), Boolean(user.serverDeafened));
    rtcRef.current = rtc;
    rtc.setServerIceServers(serverIceServersRef.current);

    return () => {
      revokeRemoteControlInternal(false);
      rtc.leaveChannel(false);
      rtc.detachSocket();
      audioEngine.stopMusic();
      audioEngine.stopAllSounds();
      if (p2pCallSocketRef.current) {
        p2pCallSocketRef.current.disconnect();
        p2pCallSocketRef.current = null;
        isLanCallActiveRef.current = false;
      }
      rtcRef.current = null;
    };
  }, [user?.id, revokeRemoteControlInternal, showError]);

  // Connect Server Socket.IO ONLY when connected to a Server (token present)
  useEffect(() => {
    const rtc = rtcRef.current;
    if (!token || !user?.id || !rtc) {
      setSocketConnected(false);
      return;
    }

    const socket = io(normalizeServerUrl(serverUrl), {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1200,
    });
    socketRef.current = socket;
    if (!isLanCallActiveRef.current) {
      rtc.attachSocket(socket);
    }

    audioEngine.setCallbacks({
      onProgress: (cur, dur) => {
        // ~4 eventos/s: só re-renderiza o app quando o segundo exibido muda (ou num salto)
        setMusicCurrentSec((prev) => (Math.floor(prev) === Math.floor(cur) ? prev : cur));
        setMusicDurationSec(dur);
      },
      onTrackEnded: (queueId) => {
        const chId = activeVoiceChannelIdRef.current;
        const activeSock = p2pCallSocketRef.current || socketRef.current;
        if (chId && activeSock) activeSock.emit('music:track-ended', { channelId: chId, queueId });
      },
      onMusicError: (msg) => showError(msg),
    });

    let everConnected = false;
    socket.on('connect', () => {
      setSocketConnected(true);
      setSelfSocketId(socket.id || '');
      syncClockWithSocket(socket);
      // reconexão (Wi-Fi oscilou, túnel caiu): o servidor já nos tirou da call; volta sozinho
      if (everConnected) {
        rejoinVoiceAfterReconnectRef.current(socket);
        refetchActiveTextChannelRef.current(); // mensagens enviadas enquanto estava fora
      }
      everConnected = true;
    });
    const clockInterval = window.setInterval(() => syncClockWithSocket(socket), 30000);

    socket.on('disconnect', () => setSocketConnected(false));

    socket.on('connect_error', (err) => {
      setSocketConnected(false);
      if (err.message === 'UNAUTHORIZED') {
        localStorage.removeItem('pulsecord_session');
        setSavedServers((prev) => upsertSavedServer(prev, { serverUrl, token: '' }));
        setToken(null);
        setUser(null);
      }
    });

    socket.on(
      'bootstrap',
      (data: {
        server: ServerInfo;
        channels: Channel[];
        categories?: ChannelCategory[];
        roles?: Role[];
        members: User[];
        voiceRooms: Record<string, VoiceParticipant[]>;
        dmGroups?: PrivateGroup[];
        sounds: SoundItem[];
        savedGifs: GifItem[];
      }) => {
        setServer(data.server);
        setChannels(data.channels);
        if (Array.isArray(data.categories)) setCategories(data.categories);
        if (Array.isArray(data.roles)) setRoles(data.roles);
        if (Array.isArray(data.dmGroups)) setDmGroups((prev) => mergePrivateGroups(prev, data.dmGroups || []));
        setMembers(data.members);
        setVoiceRooms(data.voiceRooms);
        setSounds(data.sounds);
        setSavedGifs(data.savedGifs);
        const me = data.members.find((m) => m.id === userRef.current?.id);
        if (me) {
          setUser(me);
          rtc.setServerModeration(Boolean(me.serverMuted), Boolean(me.serverDeafened));
        }
        const firstText = data.channels.find((c) => c.type === 'text');
        setActiveTextChannelId((prev) =>
          prev && data.channels.some((c) => c.id === prev) ? prev : firstText?.id || ''
        );
      }
    );

    socket.on('server:updated', (info: ServerInfo) => setServer(info));
    socket.on('roles:updated', (list: Role[]) => setRoles(list));
    socket.on('categories:updated', (list: ChannelCategory[]) => setCategories(list));
    socket.on('channels:updated', (list: Channel[]) => {
      setChannels(list);
      setActiveTextChannelId((prev) => {
        if (list.some((c) => c.id === prev && c.type === 'text')) return prev;
        return list.find((c) => c.type === 'text')?.id || '';
      });
    });

    socket.on('dm-group:updated', (grp: PrivateGroup) => {
      setDmGroups((prev) => upsertPrivateGroup(prev, grp));
    });

    socket.on('dm-group:message', ({ groupId, message }: { groupId: string; message: ChatMessage }) => {
      setGroupMessagesById((prev) => {
        const list = prev[groupId] || [];
        if (list.some((m) => m.id === message.id)) return prev;
        return { ...prev, [groupId]: [...list, message] };
      });
      if (
        message.authorId !== userRef.current?.id &&
        !(navAreaRef.current === 'dms' && activeGroupIdRef.current === groupId && viewModeRef.current === 'chat')
      ) {
        setUnreadByGroup((prev) => ({ ...prev, [groupId]: (prev[groupId] || 0) + 1 }));
        // Ocupado: sem som de mensagem
        if (userRef.current?.statusType !== 'dnd' && getDesktopPrefs().notificationSound) audioEngine.playUiTone('message_dm');
      }
    });

    socket.on('dm-group:message-pinned', ({ groupId, message }: { groupId: string; message: ChatMessage }) => {
      if (!groupId || !message?.id) return;
      setGroupMessagesById((prev) => ({
        ...prev,
        [groupId]: (prev[groupId] || []).map((m) => (m.id === message.id ? { ...m, ...message } : m)),
      }));
    });

    socket.on(
      'dm-group:call-incoming',
      ({ dmRoomId, groupName, fromUser }: { groupId: string; dmRoomId: string; groupName: string; fromUser: User }) => {
        if (activeVoiceChannelIdRef.current === dmRoomId) return;
        audioEngine.playUiTone('join');
        setIncomingCall({ dmRoomId, fromUser, isGroup: true, groupName });
      }
    );

    socket.on('trello:updated', ({ scopeKey, boards }: { scopeKey: string; boards: TrelloBoard[] }) => {
      if (scopeKey && Array.isArray(boards)) {
        setTrelloBoardsByScope((prev) => ({ ...prev, [scopeKey]: boards }));
      }
    });

    socket.on('users:update', (list: User[]) => {
      setMembers(list);
      const me = list.find((m) => m.id === userRef.current?.id);
      if (me) {
        const prevMe = userRef.current;
        setUser(
          me.statusType === 'invisible' && prevMe
            ? { ...me, currentActivity: me.currentActivity ?? prevMe.currentActivity, recentActivities: me.recentActivities?.length ? me.recentActivities : prevMe.recentActivities }
            : me
        );
        rtc.setServerModeration(Boolean(me.serverMuted), Boolean(me.serverDeafened));
      }
    });

    socket.on('voice:rooms', (snap: Record<string, VoiceParticipant[]>) => setVoiceRooms(snap));
    socket.on(
      'voice:dm-participants',
      ({ channelId, participants }: { channelId: string; participants: VoiceParticipant[] }) => {
        if (activeVoiceChannelIdRef.current === channelId) {
          setDmVoiceParticipants(participants || []);
        }
      }
    );

    socket.on('voice:peer-left', ({ socketId }: { socketId: string }) => {
      if (rcControlledByPeerRef.current?.socketId === socketId) {
        window.electronAPI?.rcDisable().catch(() => {});
        setRcControlledByPeer(null);
      }
      if (rcControllingPeerRef.current?.socketId === socketId) {
        setRcControllingPeer(null);
      }
    });

    socket.on('soundboard:updated', (list: SoundItem[]) => setSounds(list));
    socket.on('gifs:updated', (list: GifItem[]) => setSavedGifs(list));
    socket.on('update:available', (manifest: UpdateManifest) => {
      setUpdateManifest(manifest);
      setUpdateBannerDismissed(false);
    });

    socket.on('chat:message', (msg: ChatMessage) => {
      setMessagesByChannel((prev) => {
        const list = prev[msg.channelId] || [];
        if (list.some((m) => m.id === msg.id)) return prev;
        // teto por canal: a conversa pode ficar aberta por horas sem a memória crescer sem fim
        const nextList = list.length >= MAX_CACHED_MESSAGES ? [...list.slice(-(MAX_CACHED_MESSAGES - 1)), msg] : [...list, msg];
        return { ...prev, [msg.channelId]: nextList };
      });
      desktopNotifyRef.current(msg, 'channel');
    });

    socket.on('chat:message-updated', ({ channelId, message }: { channelId: string; message: ChatMessage }) => {
      if (!channelId || !message?.id) return;
      setMessagesByChannel((prev) => {
        const list = prev[channelId];
        if (!list || !list.some((m) => m.id === message.id)) return prev;
        return { ...prev, [channelId]: list.map((m) => (m.id === message.id ? message : m)) };
      });
      setThreadView((tv) => (tv && tv.parent.id === message.id ? { ...tv, parent: message } : tv));
    });
    socket.on('chat:thread-message', ({ parentId, message }: { parentId: string; message: ChatMessage }) => {
      setThreadView((tv) =>
        tv && tv.parent.id === parentId && !tv.messages.some((m) => m.id === message.id)
          ? { ...tv, messages: [...tv.messages, message] }
          : tv
      );
    });
    socket.on('chat:thread-message-updated', ({ parentId, message }: { parentId: string; message: ChatMessage }) => {
      setThreadView((tv) =>
        tv && tv.parent.id === parentId ? { ...tv, messages: tv.messages.map((m) => (m.id === message.id ? message : m)) } : tv
      );
    });
    socket.on('chat:thread-message-deleted', ({ parentId, messageId }: { parentId: string; messageId: string }) => {
      setThreadView((tv) => (tv && tv.parent.id === parentId ? { ...tv, messages: tv.messages.filter((m) => m.id !== messageId) } : tv));
    });
    bindRecConsentEvents(socket);
    socket.on('stage:role', ({ role, by }: { role: 'speaker' | 'audience'; by: string | null }) => {
      audioEngine.playUiTone(role === 'speaker' ? 'join' : 'leave');
      showToast(
        role === 'speaker'
          ? `${by ? `${by} chamou você` : 'Você subiu'} para falar no palco.`
          : `${by ? `${by} mandou você` : 'Você foi'} para a plateia.`,
        'info'
      );
    });
    socket.on('stage:hand-raised', ({ socketId, displayName }: { socketId: string; displayName: string }) => {
      if (socketId !== socket.id && isStageModRef.current) showToast(`✋ ${displayName} levantou a mão no palco.`, 'info');
    });
    socket.on('events:updated', (list: ServerEvent[]) => {
      if (Array.isArray(list)) setServerEvents(list);
    });

    socket.on('chat:message-deleted', ({ channelId, messageId }: { channelId: string; messageId: string }) => {
      setThreadView((tv) => (tv && tv.parent.id === messageId ? null : tv));
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] || []).filter((m) => m.id !== messageId),
      }));
    });

    socket.on('chat:message-pinned', ({ channelId, message }: { channelId: string; message: ChatMessage }) => {
      if (!channelId || !message?.id) return;
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] || []).map((m) => (m.id === message.id ? message : m)),
      }));
    });

    socket.on('dm:message-pinned', ({ pairKey, message }: { pairKey: string; message: ChatMessage }) => {
      if (!pairKey || !message?.id) return;
      setDmMessagesByPair((prev) => {
        const list = prev[pairKey] || [];
        const nextList = list.map((m) => (m.id === message.id ? { ...m, ...message } : m));
        const next = { ...prev, [pairKey]: nextList };
        schedulePersistDmArchive(next);
        return next;
      });
    });

    // Live update for Heavy Transfers (e.g., Download Único 🔥 burned or cache-pruned)
    socket.on('transfer:updated', (transfer: FileTransfer) => {
      setMessagesByChannel((prev) => {
        let changed = false;
        const next: Record<string, ChatMessage[]> = {};
        for (const [chId, list] of Object.entries(prev)) {
          let chDirty = false;
          const updated = list.map((m) => {
            if (m.transfer && m.transfer.id === transfer.id) {
              chDirty = true;
              changed = true;
              return { ...m, transfer: { ...m.transfer, ...transfer } };
            }
            return m;
          });
          next[chId] = chDirty ? updated : list;
        }
        return changed ? next : prev;
      });
      setDmMessagesByPair((prev) => {
        let changed = false;
        const next: Record<string, ChatMessage[]> = {};
        for (const [pairKey, list] of Object.entries(prev)) {
          let pairDirty = false;
          const updated = list.map((m) => {
            if (m.transfer && m.transfer.id === transfer.id) {
              pairDirty = true;
              changed = true;
              return { ...m, transfer: { ...m.transfer, ...transfer } };
            }
            return m;
          });
          next[pairKey] = pairDirty ? updated : list;
        }
        if (changed) schedulePersistDmArchive(next);
        return changed ? next : prev;
      });
    });

    // Private Direct Messages (saved locally in encrypted dm-archive.enc!)
    socket.on('dm:message', (msg: ChatMessage) => {
      const myId = userRef.current?.id;
      if (!myId) return;
      const pairKey = msg.pairKey || (msg.toUserId ? getDmPairKey(msg.authorId, msg.toUserId) : '');
      if (!pairKey) return;

      setDmMessagesByPair((prev) => {
        const list = prev[pairKey] || [];
        if (list.some((m) => m.id === msg.id)) return prev;
        const next = { ...prev, [pairKey]: [...list, msg] };
        schedulePersistDmArchive(next);
        return next;
      });

      const otherUserId = msg.authorId === myId ? msg.toUserId : msg.authorId;
      if (
        otherUserId &&
        msg.authorId !== myId &&
        !(navAreaRef.current === 'dms' && activeDmUserIdRef.current === otherUserId && viewModeRef.current === 'chat')
      ) {
        setUnreadDmByUser((prev) => ({ ...prev, [otherUserId]: (prev[otherUserId] || 0) + 1 }));
        desktopNotifyRef.current(msg, 'dm');
      }
    });

    // Private 1-on-1 Call signaling
    socket.on('dm:call-incoming', ({ dmRoomId, fromUser }: { dmRoomId: string; fromUser: User }) => {
      if (activeVoiceChannelIdRef.current === dmRoomId) return;
      audioEngine.playUiTone('join');
      setIncomingCall({ dmRoomId, fromUser });
    });

    socket.on('dm:call-declined', ({ byName }: { byName: string }) => {
      showToast(`${byName} recusou a chamada privada.`, 'info');
    });

    // Moderation real-time enforcement
    socket.on(
      'moderation:voice-enforced',
      ({ serverMuted, serverDeafened, by }: { serverMuted: boolean; serverDeafened: boolean; by: string }) => {
        rtc.setServerModeration(serverMuted, serverDeafened);
        if (serverMuted || serverDeafened) {
          showToast(
            `${by} ${serverDeafened ? 'desativou seu áudio no servidor' : 'silenciou seu microfone no servidor'}.`,
            'error'
          );
        } else {
          showToast(`${by} liberou seu áudio no servidor.`, 'info');
        }
      }
    );

    socket.on(
      'moderation:move-voice',
      ({ targetChannelId, channelName, by }: { targetChannelId: string; channelName: string; by: string }) => {
        showToast(`${by} moveu você para #${channelName}.`, 'info');
        joinVoiceRef.current(targetChannelId).catch(() => {});
      }
    );

    socket.on('moderation:kicked', ({ reason, by }: { reason: string; by: string }) => {
      showToast(`Você foi expulso do servidor por ${by}${reason ? `: ${reason}` : '.'}`, 'error');
      rtc.leaveChannel(false);
      audioEngine.stopMusic();
      localStorage.removeItem('pulsecord_session');
      setSavedServers((prev) => removeSavedServer(prev, serverUrl));
      setActiveVoiceChannelId(null);
      setViewMode('chat');
      setNavArea('dms');
      setToken(null);
      setUser(null);
      setServer(null);
    });

    socket.on('moderation:banned', ({ reason, by }: { reason: string; by: string }) => {
      showToast(
        `Você foi banido do servidor por ${by}${reason ? `: ${reason}` : '.'}`,
        'error'
      );
      rtc.leaveChannel(false);
      audioEngine.stopMusic();
      localStorage.removeItem('pulsecord_session');
      setSavedServers((prev) => removeSavedServer(prev, serverUrl));
      setActiveVoiceChannelId(null);
      setViewMode('chat');
      setToken(null);
      setUser(null);
      setServer(null);
    });

    // AnyDesk Remote Control signaling (always requires explicit acceptance!)
    socket.on('rc:invited', ({ fromSocketId, fromName }: { fromSocketId: string; fromName: string }) => {
      audioEngine.playUiTone('join');
      setRcPendingPrompt({ kind: 'invite', fromSocketId, fromName });
    });

    socket.on('rc:requested', ({ fromSocketId, fromName }: { fromSocketId: string; fromName: string }) => {
      audioEngine.playUiTone('join');
      setRcPendingPrompt({ kind: 'request', fromSocketId, fromName });
    });

    socket.on(
      'rc:accepted',
      async ({ fromSocketId, fromName, role }: { fromSocketId: string; fromName: string; role: string }) => {
        // convite meu aceito -> o outro passa a me controlar; pedido meu aceito -> eu passo a controlar o outro
        if (!takeRcOutgoing(fromSocketId, role === 'controller' ? 'invite' : 'request')) return;
        if (role === 'controller') {
          const enabled = window.electronAPI?.rcEnable ? await window.electronAPI.rcEnable() : false;
          if (!enabled && isElectron) {
            showError('Não foi possível ativar o motor de controle remoto no Windows.');
            socket.emit('rc:revoke', { targetSocketId: fromSocketId });
            return;
          }
          const defaultPerms: RcPermissions = { mouse: true, keyboard: true, gamepad: true };
          await window.electronAPI?.rcSetPermissions?.(defaultPerms).catch(() => {});
          setRcControlledByPeer({ socketId: fromSocketId, name: fromName });
          setRcControlledPeers((prev) => {
            const filtered = prev.filter((p) => p.socketId !== fromSocketId);
            return [
              ...filtered,
              {
                socketId: fromSocketId,
                name: fromName,
                permissions: defaultPerms,
                gamepadSlot: filtered.length % 4,
              },
            ];
          });
          showToast(`${fromName} agora está controlando sua tela. Aperte Ctrl+Shift+Esc para parar.`, 'info');
        } else {
          setRcControllingPeer({ socketId: fromSocketId, name: fromName });
          setViewMode('voice');
          showToast(`${fromName} autorizou o controle remoto! Clique e digite na tela transmitida.`, 'info');
        }
      }
    );

    socket.on('rc:declined', ({ fromSocketId, fromName }: { fromSocketId: string; fromName: string }) => {
      rcOutgoingRef.current.delete(fromSocketId);
      showToast(`${fromName} recusou o pedido de controle remoto.`, 'info');
    });

    socket.on('rc:permissions-updated', ({ fromSocketId, permissions }: { fromSocketId: string; permissions: RcPermissions }) => {
      if (rcControllingPeerRef.current?.socketId === fromSocketId) {
        const allowed: string[] = [];
        if (permissions.mouse) allowed.push('Mouse');
        if (permissions.keyboard) allowed.push('Teclado');
        if (permissions.gamepad) allowed.push('Controle Xbox');
        showToast(`Permissões atualizadas pelo Host: ${allowed.length ? allowed.join(', ') : 'Somente visualização'}`, 'info');
      }
    });

    socket.on('rc:revoked', ({ fromSocketId }: { fromSocketId: string }) => {
      const remaining = rcControlledPeersRef.current.filter((p) => p.socketId !== fromSocketId);
      setRcControlledPeers(remaining);
      if (remaining.length === 0) {
        if (rcControlledByPeerRef.current) {
          window.electronAPI?.rcDisable().catch(() => {});
          setRcControlledByPeer(null);
          showToast('Controle remoto encerrado pelo outro participante.', 'info');
        }
      } else if (rcControlledByPeerRef.current?.socketId === fromSocketId) {
        setRcControlledByPeer({ socketId: remaining[0].socketId, name: remaining[0].name });
      }
      if (rcControllingPeerRef.current?.socketId === fromSocketId) {
        setRcControllingPeer(null);
        showToast('O dono da tela encerrou o controle remoto.', 'info');
      }
    });

    socket.on(
      'chat:typing',
      ({
        channelId,
        userId,
        displayName,
        isTyping,
      }: {
        channelId: string;
        userId: string;
        displayName: string;
        isTyping: boolean;
      }) => {
        setTypingByChannel((prev) => {
          const chMap = { ...(prev[channelId] || {}) };
          if (isTyping) chMap[userId] = displayName;
          else delete chMap[userId];
          return { ...prev, [channelId]: chMap };
        });
      }
    );

    socket.on(
      'soundboard:played',
      (evt: { sound: SoundItem; playedBy: { userId: string; displayName: string; avatarColor: string }; playedAt: number }) => {
        const uid = evt.playedBy?.userId;
        const clearRing = () => {
          if (!uid) return;
          const prevT = soundboardTimersRef.current.get(uid);
          if (prevT) window.clearTimeout(prevT);
          soundboardTimersRef.current.delete(uid);
          setSoundboardActiveUserIds((prev) => {
            if (!prev.has(uid)) return prev;
            const next = new Set(prev);
            next.delete(uid);
            return next;
          });
        };

        if (uid) {
          const prevT = soundboardTimersRef.current.get(uid);
          if (prevT) window.clearTimeout(prevT);
          setSoundboardActiveUserIds((prev) => new Set(prev).add(uid));
          soundboardTimersRef.current.set(uid, window.setTimeout(clearRing, 9000));
        }

        audioEngine.playSoundboardClip(evt.sound.url, evt.sound.volume ?? 1, clearRing);
        const toastId = `${evt.sound.id}-${evt.playedAt}-${Math.random()}`;
        const item: SoundPlayedToast = {
          id: toastId,
          sound: evt.sound,
          playedBy: evt.playedBy,
          playedAt: evt.playedAt,
        };
        setSoundToasts((prev) => [...prev.slice(-3), item]);
        window.setTimeout(() => {
          setSoundToasts((prev) => prev.filter((t) => t.id !== toastId));
        }, 3500);
      }
    );

    socket.on('music:state', (state: MusicState) => {
      if (state.channelId === activeVoiceChannelIdRef.current) {
        setMusicState(state);
        audioEngine.syncMusicState(state);
      }
    });

    socket.on('video:state', (state: VideoState) => {
      if (state.channelId === activeVoiceChannelIdRef.current) {
        setVideoState({ ...state, receivedAt: Date.now() });
      }
    });

    socket.on('voice:moved-elsewhere', ({ channelId }: { channelId: string }) => {
      if (activeVoiceChannelIdRef.current !== channelId) return;
      revokeRemoteControlInternal(true);
      rtc.leaveChannel();
      audioEngine.stopMusic();
      setActiveVoiceChannelId(null);
      setDmVoiceParticipants([]);
      setMusicState(null);
      setVideoState(null);
      setViewMode('chat');
      showToast('Você entrou nesta call por outra conexão, então esta saiu.', 'info');
    });

    socket.on('voice:channel-deleted', ({ channelId }: { channelId: string }) => {
      if (activeVoiceChannelIdRef.current === channelId) {
        revokeRemoteControlInternal(true);
        rtc.leaveChannel();
        audioEngine.stopMusic();
        setActiveVoiceChannelId(null);
        setDmVoiceParticipants([]);
        setMusicState(null);
        setVideoState(null);
        setViewMode('chat');
      }
    });

    return () => {
      window.clearInterval(clockInterval);
      if (!isLanCallActiveRef.current) {
        rtc.leaveChannel(false);
        rtc.detachSocket();
        audioEngine.stopMusic();
        audioEngine.stopAllSounds();
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, user?.id, serverUrl, syncClockWithSocket, showError, showToast, schedulePersistDmArchive]);

  // ---- Cópia local (cifrada) das mensagens dos canais: o canal abre na hora e o servidor atualiza depois
  const msgCacheScope = user?.id && serverUrl ? `${serverUrl.replace(/\/+$/, '').toLowerCase()}|${user.id}` : '';
  const msgCacheSavedRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const msgCacheTimerRef = useRef<number | null>(null);
  const messagesByChannelRef = useRef(messagesByChannel);
  messagesByChannelRef.current = messagesByChannel;
  // canais que já têm a lista do servidor nesta sessão (a cópia local não sobrescreve)
  const serverLoadedChannelsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    msgCacheSavedRef.current = new Map();
    serverLoadedChannelsRef.current = new Set();
  }, [msgCacheScope]);
  useEffect(() => {
    const save = window.electronAPI?.saveMessageCache;
    if (!save || !msgCacheScope) return;
    if (msgCacheTimerRef.current) window.clearTimeout(msgCacheTimerRef.current);
    // grava só os canais que mudaram, 1,5 s depois da última mensagem (sem gravar a cada letra/reação)
    msgCacheTimerRef.current = window.setTimeout(() => {
      msgCacheTimerRef.current = null;
      for (const [chId, list] of Object.entries(messagesByChannelRef.current)) {
        if (!serverLoadedChannelsRef.current.has(chId)) continue; // só o que veio do servidor
        if (msgCacheSavedRef.current.get(chId) === list) continue;
        msgCacheSavedRef.current.set(chId, list);
        save(msgCacheScope, chId, list).catch(() => {});
      }
    }, 1500);
  }, [messagesByChannel, msgCacheScope]);

  // Fetch server text channel message history
  useEffect(() => {
    if (!token || !api || !activeTextChannelId || navArea !== 'server') return;
    const chId = activeTextChannelId;
    const load = window.electronAPI?.loadMessageCache;
    // canal fora da memória (nunca aberto ou já descartado): mostra a cópia local até o servidor responder
    if (!messagesByChannelRef.current[chId]) serverLoadedChannelsRef.current.delete(chId);
    if (load && msgCacheScope && !messagesByChannelRef.current[chId]) {
      load(msgCacheScope, chId)
        .then((cached) => {
          if (!cached || !cached.length || serverLoadedChannelsRef.current.has(chId)) return;
          setMessagesByChannel((prev) => (prev[chId] ? prev : { ...prev, [chId]: cached }));
        })
        .catch(() => {});
    }
    api
      .getMessages(activeTextChannelId)
      .then((res) => {
        serverLoadedChannelsRef.current.add(chId);
        const order = recentTextChannelsRef.current.filter((id) => id !== activeTextChannelId);
        order.unshift(activeTextChannelId);
        recentTextChannelsRef.current = order.slice(0, MAX_CACHED_CHANNELS);
        setMessagesByChannel((prev) => {
          // só os últimos canais visitados ficam na memória; os outros são buscados de novo ao abrir
          const next: Record<string, ChatMessage[]> = {};
          for (const id of recentTextChannelsRef.current) {
            if (id === activeTextChannelId) next[id] = res.messages;
            else if (prev[id]) next[id] = prev[id];
          }
          return next;
        });
      })
      .catch(() => {});
  }, [token, activeTextChannelId, navArea, api, msgCacheScope]);

  refetchActiveTextChannelRef.current = () => {
    if (!api || !activeTextChannelId || navArea !== 'server') return;
    const chId = activeTextChannelId;
    api
      .getMessages(chId)
      .then((res) => setMessagesByChannel((prev) => ({ ...prev, [chId]: res.messages })))
      .catch(() => {});
  };

  // Fetch & merge DM message history with encrypted local vault
  useEffect(() => {
    if (!user?.id || !activeDmUserId || navArea !== 'dms') return;
    setUnreadDmByUser((prev) => {
      if (!prev[activeDmUserId]) return prev;
      const copy = { ...prev };
      delete copy[activeDmUserId];
      return copy;
    });
    if (!token || !api) return;
    // Skip REST fetch if target is a serverless LAN peer
    if (lanPeersRef.current.some((p) => p.peerId === activeDmUserId) && !members.some((m) => m.id === activeDmUserId)) {
      return;
    }
    api
      .getDmMessages(activeDmUserId)
      .then((res) => {
        const pairKey = res.pairKey || getDmPairKey(user.id, activeDmUserId);
        setDmMessagesByPair((prev) => {
          const merged = mergeMessageLists(prev[pairKey], res.messages);
          const next = { ...prev, [pairKey]: merged };
          schedulePersistDmArchive(next);
          return next;
        });
      })
      .catch(() => {});
  }, [token, user?.id, activeDmUserId, navArea, api, schedulePersistDmArchive]);

  // Fetch Private Group message history (Server groups)
  useEffect(() => {
    if (!user?.id || !activeGroupId || navArea !== 'dms') return;
    setUnreadByGroup((prev) => {
      if (!prev[activeGroupId]) return prev;
      const copy = { ...prev };
      delete copy[activeGroupId];
      return copy;
    });
    const grp = dmGroups.find((g) => g.id === activeGroupId);
    if (!grp || grp.isLanP2p || !api || !token) return;
    api
      .getDmGroupMessages(activeGroupId)
      .then((res) => {
        if (Array.isArray(res.messages)) {
          setGroupMessagesById((prev) => ({ ...prev, [activeGroupId]: res.messages }));
        }
      })
      .catch(() => {});
  }, [token, user?.id, activeGroupId, navArea, api, dmGroups]);

  // ---- Handlers ----
  // nome/ícone do servidor mudaram: atualiza o atalho salvo na barra lateral
  useEffect(() => {
    if (!token || !server || !serverUrl) return;
    setSavedServers((prev) =>
      upsertSavedServer(prev, {
        serverUrl,
        token,
        mode: appMode,
        name: server.name,
        iconColor: server.iconColor,
        iconUrl: server.iconUrl ?? null,
      })
    );
  }, [token, serverUrl, appMode, server?.name, server?.iconColor, server?.iconUrl]);

  // abriu o app com o host desligado: tenta de novo a cada 8 s até conectar (ou até você entrar em outro)
  useEffect(() => {
    if (!autoReconnectUrl || token) return;
    let stop = false;
    const tick = async () => {
      const entry = loadSavedServers().find((s) => serverKey(s.serverUrl) === serverKey(autoReconnectUrl));
      if (!entry) {
        setAutoReconnectUrl(null);
        return;
      }
      const ok = await switchSavedServerRef.current(entry, { silent: true });
      if (ok && !stop) showToast(`Reconectado a "${entry.name}".`, 'info');
    };
    const id = window.setInterval(tick, 8000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [autoReconnectUrl, token, showToast]);

  const handleAuthenticated = (data: {
    mode: AppMode;
    serverUrl: string;
    token: string;
    user: User;
    server: ServerInfo;
  }) => {
    setAppMode(data.mode);
    setServerUrl(data.serverUrl);
    setToken(data.token);
    setUser(data.user);
    setServer(data.server);
    setNavArea('server');
    localStorage.setItem('pulsecord_mode', data.mode);
    localStorage.setItem('pulsecord_server_url', data.serverUrl);
    localStorage.setItem(
      'pulsecord_session',
      JSON.stringify({ mode: data.mode, serverUrl: data.serverUrl, token: data.token })
    );
    setAutoReconnectUrl(null);
    setSavedServers((prev) =>
      upsertSavedServer(prev, {
        serverUrl: data.serverUrl,
        token: data.token,
        mode: data.mode,
        name: data.server.name,
        iconColor: data.server.iconColor,
        iconUrl: data.server.iconUrl ?? null,
        lastUsedAt: Date.now(),
      })
    );
  };

  /** Troca para outro servidor salvo na barra lateral (um conectado por vez, como no app antigo). */
  const handleSwitchSavedServer = async (entry: SavedServer, opts?: { silent?: boolean }): Promise<boolean> => {
    if (token && server && serverKey(entry.serverUrl) === serverKey(serverUrl)) {
      setNavArea('server');
      return true;
    }
    let url = entry.serverUrl;
    if (entry.mode === 'host' && window.electronAPI?.isElectron) {
      let st = hostStatus;
      if (!st?.running) {
        st = await window.electronAPI.hostStart(3000).catch(() => null);
        if (st) setHostStatus(st);
      }
      if (!st?.running || !st.localUrl) {
        if (!opts?.silent) showError(st?.error || 'Não foi possível ligar o seu servidor neste PC.');
        return false;
      }
      url = st.localUrl;
    }
    try {
      let tok = entry.token;
      let res: { user: User; server: ServerInfo } | null = null;
      if (tok) {
        try {
          res = await new ApiClient(url, tok).me();
        } catch (err: any) {
          if (err?.status !== 401 && err?.status !== 403) throw err;
          tok = '';
        }
      }
      if (!res) {
        // sessão expirou: entra de novo com o mesmo nome (servidor com senha pede para entrar pelo "+")
        const u = userRef.current;
        if (!u) throw Object.assign(new Error('Entre no servidor de novo pelo botão +.'), { status: 401 });
        const lr = await new ApiClient(url).login({
          username: u.username,
          displayName: u.displayName,
          hostSelfJoin: entry.mode === 'host' ? true : undefined,
        });
        tok = lr.token;
        res = { user: lr.user, server: lr.server };
      }
      revokeRemoteControlInternal(true);
      disconnectLanCallSocket();
      rtcRef.current?.leaveChannel();
      audioEngine.stopMusic();
      setActiveVoiceChannelId(null);
      setDmVoiceParticipants([]);
      setVideoState(null);
      setViewMode('chat');
      setChannels([]);
      setRoles([]);
      setMembers([]);
      setVoiceRooms({});
      handleAuthenticated({ mode: entry.mode, serverUrl: url, token: tok, user: res.user, server: res.server });
      return true;
    } catch (err: any) {
      if (!opts?.silent) {
        if (err?.status === 401 || err?.status === 403) {
          showError(err?.message && err.status === 401 ? err.message : 'Esse servidor pediu para entrar de novo.');
          setShowServerDirectory(true);
        } else {
          showError(`"${entry.name}" está offline ou fora da rede agora.`);
        }
      }
      return false;
    }
  };
  const switchSavedServerRef = useRef(handleSwitchSavedServer);
  switchSavedServerRef.current = handleSwitchSavedServer;

  const handleLocalEnter = useCallback(
    (identity: { displayName: string; username: string; avatarColor: string; avatarDataUrl?: string }) => {
      try {
        localStorage.setItem('pulsecord_local_identity', JSON.stringify(identity));
      } catch {
        // ignore
      }
      const uid = localPeerInfoRef.current?.peerId || `local_${identity.username}`;
      const localUser: User = {
        id: uid,
        username: identity.username,
        displayName: identity.displayName,
        avatarColor: identity.avatarColor || '#5865F2',
        avatarUrl: identity.avatarDataUrl || null,
        bannerColor: identity.avatarColor || '#5865F2',
        online: true,
        statusType: 'online',
        role: 'member',
        roleIds: [],
        createdAt: Date.now(),
      };
      window.electronAPI
        ?.lanPeersUpdateIdentity?.({
          username: localUser.username,
          displayName: localUser.displayName,
          avatarColor: localUser.avatarColor,
          avatarDataUrl: identity.avatarDataUrl,
        })
        .catch(() => {});
      setUser(localUser);
      setServer(null);
      setToken(null);
      setNavArea('dms');
    },
    []
  );

  const disconnectLanCallSocket = useCallback(() => {
    if (p2pCallSocketRef.current) {
      try {
        p2pCallSocketRef.current.emit('voice:leave');
        p2pCallSocketRef.current.disconnect();
      } catch {
        // ignore
      }
      p2pCallSocketRef.current = null;
    }
    isLanCallActiveRef.current = false;
    if (socketRef.current && rtcRef.current) {
      rtcRef.current.attachSocket(socketRef.current);
    }
  }, []);

  const handleLeaveServer = async () => {
    revokeRemoteControlInternal(true);
    if (!isLanCallActiveRef.current) {
      rtcRef.current?.leaveChannel();
      audioEngine.stopMusic();
      setActiveVoiceChannelId(null);
      setDmVoiceParticipants([]);
      setVideoState(null);
      setViewMode('chat');
    }
    try {
      await api?.logout();
    } catch {
      // ignore
    }
    if (appMode === 'host' && window.electronAPI?.isElectron) {
      await handleStopHost();
    }
    localStorage.removeItem('pulsecord_session');
    setSavedServers((prev) => removeSavedServer(prev, serverUrl));
    setAppMode('client');
    setToken(null);
    setServer(null);
    setChannels([]);
    setRoles([]);
    setMembers([]);
    setVoiceRooms({});
    setNavArea('dms');
    if (user) {
      setUser({ ...user, role: 'member', roleIds: [] });
    }
  };

  const handleLogout = async () => {
    revokeRemoteControlInternal(true);
    disconnectLanCallSocket();
    try {
      await api?.logout();
    } catch {
      // ignore
    }
    rtcRef.current?.leaveChannel();
    audioEngine.stopMusic();
    if (appMode === 'host' && window.electronAPI?.isElectron) {
      await handleStopHost();
    }
    localStorage.removeItem('pulsecord_session');
    localStorage.removeItem('pulsecord_local_identity');
    // as mensagens salvas no PC ficam: são separadas por servidor + conta e voltam ao entrar de novo nela
    setMessagesByChannel({});
    clearSavedServers();
    setSavedServers([]);
    setAutoReconnectUrl(null);
    setActiveVoiceChannelId(null);
    setDmVoiceParticipants([]);
    setVideoState(null);
    setMutedTalkAlert(false);
    setSoundboardActiveUserIds(new Set());
    setViewMode('chat');
    setNavArea('dms');
    setToken(null);
    setUser(null);
    setServer(null);
  };

  const handleCreateServerFromDirectory = async (opts: {
    serverName: string;
    iconColor: string;
    iconDataUrl?: string | null;
    password: string;
  }) => {
    if (!window.electronAPI?.isElectron) {
      throw new Error('Criar servidor só está disponível no aplicativo Waver (.exe).');
    }
    revokeRemoteControlInternal(true);
    disconnectLanCallSocket();
    rtcRef.current?.leaveChannel();
    audioEngine.stopMusic();
    setActiveVoiceChannelId(null);
    setDmVoiceParticipants([]);
    setVideoState(null);

    const st = await window.electronAPI.hostStart({
      port: 3000,
      serverName: opts.serverName,
      iconColor: opts.iconColor,
      iconDataUrl: opts.iconDataUrl || null,
      password: opts.password,
    });
    setHostStatus(st);
    if (!st?.running || !st.localUrl) {
      throw new Error(st?.error || 'Não foi possível ligar o servidor local.');
    }

    const activeUser = userRef.current;
    const localClient = new ApiClient(st.localUrl);
    const res = await localClient.login({
      username: activeUser?.username || 'host',
      displayName: activeUser?.displayName || 'Host',
      invitePassword: opts.password || undefined,
      hostSelfJoin: true,
    });
    handleAuthenticated({
      mode: 'host',
      serverUrl: st.localUrl,
      token: res.token,
      user: res.user,
      server: res.server,
    });
    setShowServerDirectory(false);
    showToast(`Servidor "${opts.serverName}" criado e hospedado na hora!`, 'info');
  };

  const handleJoinServerFromDirectory = async (opts: { serverUrl: string; password: string }) => {
    const activeUser = userRef.current;
    if (!activeUser) throw new Error('Identidade local não definida.');
    revokeRemoteControlInternal(true);
    disconnectLanCallSocket();
    rtcRef.current?.leaveChannel();
    audioEngine.stopMusic();
    setActiveVoiceChannelId(null);
    setDmVoiceParticipants([]);
    setVideoState(null);

    const client = new ApiClient(opts.serverUrl);
    const res = await client.login({
      username: activeUser.username,
      displayName: activeUser.displayName,
      invitePassword: opts.password.trim() || undefined,
    });

    // o servidor que você hospeda continua no ar para os outros; ele fica salvo na barra lateral
    handleAuthenticated({
      mode: 'client',
      serverUrl: opts.serverUrl,
      token: res.token,
      user: res.user,
      server: res.server,
    });
    setShowServerDirectory(false);
    showToast(`Conectado ao servidor "${res.server.name}"!`, 'info');
  };

  const handleSwitchToHostInApp = async () => {
    revokeRemoteControlInternal(true);
    const st = await handleModeChange('host');
    if (!st?.running) {
      showError(st?.error || 'Não foi possível hospedar o servidor neste PC.');
      return;
    }
    rtcRef.current?.leaveChannel();
    audioEngine.stopMusic();
    setActiveVoiceChannelId(null);
    setDmVoiceParticipants([]);
    setVideoState(null);
    setMutedTalkAlert(false);
    setSoundboardActiveUserIds(new Set());
    setViewMode('chat');

    if (user) {
      try {
        const localClient = new ApiClient(st.localUrl);
        const res = await localClient.login({
          username: user.username,
          displayName: user.displayName,
          hostSelfJoin: true,
        });
        handleAuthenticated({
          mode: 'host',
          serverUrl: st.localUrl,
          token: res.token,
          user: res.user,
          server: res.server,
        });
        setShowHostModal(false);
        return;
      } catch {
        // fallback to login screen
      }
    }
    localStorage.removeItem('pulsecord_session');
    setToken(null);
    setUser(null);
    setServer(null);
    setShowHostModal(false);
  };

  const handleSwitchToClientInApp = async () => {
    await handleModeChange('client');
    await handleLogout();
    setShowHostModal(false);
  };

  const handleJoinOrFocusVoiceChannel = useCallback(
    async (channelId: string, opts?: { recordingOk?: boolean }) => {
      if (activeVoiceChannelIdRef.current === channelId) {
        setViewMode('voice');
        return;
      }
      // chamada sendo gravada: pergunta antes de entrar (entrar = concordar com a gravação)
      if (!opts?.recordingOk) {
        const recs = (voiceRoomsRef.current[channelId] || []).filter((p) => p.recording === 'record');
        if (recs.length) {
          audioEngine.playUiTone('recording_on');
          setRecJoinPrompt({ channelId, names: Array.from(new Set(recs.map((p) => p.displayName))) });
          return;
        }
      }
      if (isLanCallActiveRef.current) {
        disconnectLanCallSocket();
      }
      const socket = socketRef.current;
      const rtc = rtcRef.current;
      if (!socket || !rtc) return;

      revokeRemoteControlInternal(true);
      rtc.attachSocket(socket);
      await rtc.prepareJoin(channelId, socket.id || '', muted, deafened);

      socket.emit(
        'voice:join',
        // sfu: este app sabe usar o SFU do servidor (calls grandes); o servidor decide se usa
        { channelId, muted, deafened, sfu: sfuSupported() },
        async (res: {
          ok?: boolean;
          error?: string;
          selfSocketId?: string;
          peers?: VoiceParticipant[];
          participants?: VoiceParticipant[];
          musicState?: MusicState;
          sfu?: SfuJoinInfo | null;
        }) => {
          if (!res?.ok) {
            rtc.leaveChannel();
            showError(res?.error || 'Não foi possível entrar na chamada.');
            return;
          }
          audioEngine.playUiTone('join');
          setActiveVoiceChannelId(channelId);
          setViewMode('voice');
          setSelfSocketId(res.selfSocketId || socket.id || '');
          if (channelId.startsWith('dm:')) {
            setDmVoiceParticipants(res.participants || []);
          } else {
            setDmVoiceParticipants([]);
          }
          await rtc.completeJoin(channelId, res.selfSocketId || socket.id || '', res.peers || [], res.sfu);
          if (res.musicState) {
            setMusicState(res.musicState);
            audioEngine.syncMusicState(res.musicState);
          }
          if ((res as { videoState?: VideoState }).videoState) {
            setVideoState({ ...(res as { videoState: VideoState }).videoState, receivedAt: Date.now() });
          }
        }
      );
    },
    [muted, deafened, revokeRemoteControlInternal, disconnectLanCallSocket, showError]
  );

  rejoinVoiceAfterReconnectRef.current = (socket: Socket) => {
    const channelId = activeVoiceChannelIdRef.current;
    const rtc = rtcRef.current;
    if (!channelId || !rtc || isLanCallActiveRef.current || socketRef.current !== socket) return;
    rtc.attachSocket(socket);
    rtc.resetPeersForRejoin(channelId, socket.id || '');
    socket.emit(
      'voice:join',
      { channelId, muted, deafened, sfu: sfuSupported() },
      async (res: {
        ok?: boolean;
        error?: string;
        selfSocketId?: string;
        peers?: VoiceParticipant[];
        participants?: VoiceParticipant[];
        musicState?: MusicState;
        videoState?: VideoState;
        sfu?: SfuJoinInfo | null;
      }) => {
        if (activeVoiceChannelIdRef.current !== channelId) return; // saiu da call enquanto reconectava
        if (!res?.ok) {
          rtc.leaveChannel();
          setActiveVoiceChannelId(null);
          showError(res?.error || 'A conexão caiu e não foi possível voltar para a call.');
          return;
        }
        const selfId = res.selfSocketId || socket.id || '';
        setSelfSocketId(selfId);
        if (channelId.startsWith('dm:')) setDmVoiceParticipants(res.participants || []);
        await rtc.completeJoin(channelId, selfId, res.peers || [], res.sfu);
        if (res.musicState) {
          setMusicState(res.musicState);
          audioEngine.syncMusicState(res.musicState);
        }
        if (res.videoState) setVideoState({ ...res.videoState, receivedAt: Date.now() });
        showToast('Conexão restabelecida: você voltou para a call.', 'info');
      }
    );
  };

  const connectAndJoinLanCall = useCallback(
    async (callServerUrl: string, dmRoomId: string) => {
      const rtc = rtcRef.current;
      const curUser = userRef.current;
      if (!rtc || !curUser) return;

      if (activeVoiceChannelIdRef.current) {
        socketRef.current?.emit('voice:leave');
        rtc.leaveChannel();
      }
      disconnectLanCallSocket();
      revokeRemoteControlInternal(true);

      const baseAuth = {
        userId: curUser.id,
        displayName: curUser.displayName,
        avatarColor: curUser.avatarColor,
        avatarUrl: curUser.avatarUrl || null,
      };
      const p2pSock = io(callServerUrl, {
        // a cada (re)conexão pede um ingresso novo ao anfitrião: só quem é da DM/grupo entra na call
        auth: (cb: (data: object) => void) => {
          const getTicket = window.electronAPI?.lanCallTicket;
          if (!getTicket) return cb(baseAuth);
          getTicket(callServerUrl, dmRoomId)
            .then((ticket) => cb({ ...baseAuth, ticket }))
            .catch(() => cb(baseAuth));
        },
        transports: ['websocket', 'polling'],
      });
      p2pCallSocketRef.current = p2pSock;
      isLanCallActiveRef.current = true;
      rtc.attachSocket(p2pSock);
      bindRecConsentEvents(p2pSock);

      p2pSock.on('connect', () => {
        setSelfSocketId(p2pSock.id || '');
        syncClockWithSocket(p2pSock);
      });
      p2pSock.on('dm:voice-participants', (list: VoiceParticipant[]) => {
        if (activeVoiceChannelIdRef.current === dmRoomId) {
          setDmVoiceParticipants(list || []);
        }
      });
      p2pSock.on('voice:peer-left', ({ socketId }: { socketId: string }) => {
        const remaining = rcControlledPeersRef.current.filter((p) => p.socketId !== socketId);
        setRcControlledPeers(remaining);
        if (remaining.length === 0) {
          window.electronAPI?.rcDisable().catch(() => {});
          setRcControlledByPeer(null);
        }
        if (rcControllingPeerRef.current?.socketId === socketId) {
          setRcControllingPeer(null);
        }
      });
      p2pSock.on('music:state', (state: MusicState) => {
        setMusicState(state);
        audioEngine.syncMusicState(state);
      });
      p2pSock.on('video:state', (state: VideoState) => setVideoState({ ...state, receivedAt: Date.now() }));
      p2pSock.on('rc:invited', ({ fromSocketId, fromName }: { fromSocketId: string; fromName: string }) => {
        audioEngine.playUiTone('join');
        setRcPendingPrompt({ kind: 'invite', fromSocketId, fromName });
      });
      p2pSock.on('rc:requested', ({ fromSocketId, fromName }: { fromSocketId: string; fromName: string }) => {
        audioEngine.playUiTone('join');
        setRcPendingPrompt({ kind: 'request', fromSocketId, fromName });
      });
      p2pSock.on(
        'rc:accepted',
        async ({ fromSocketId, fromName, role }: { fromSocketId: string; fromName: string; role: string }) => {
          if (!takeRcOutgoing(fromSocketId, role === 'controller' ? 'invite' : 'request')) return;
          if (role === 'controller') {
            const enabled = window.electronAPI?.rcEnable ? await window.electronAPI.rcEnable() : false;
            if (!enabled && isElectron) {
              showError('Não foi possível ativar o controle remoto.');
              p2pSock.emit('rc:revoke', { targetSocketId: fromSocketId });
              return;
            }
            const defaultPerms: RcPermissions = { mouse: true, keyboard: true, gamepad: true };
            await window.electronAPI?.rcSetPermissions?.(defaultPerms).catch(() => {});
            setRcControlledByPeer({ socketId: fromSocketId, name: fromName });
            setRcControlledPeers((prev) => {
              const filtered = prev.filter((p) => p.socketId !== fromSocketId);
              return [
                ...filtered,
                {
                  socketId: fromSocketId,
                  name: fromName,
                  permissions: defaultPerms,
                  gamepadSlot: filtered.length % 4,
                },
              ];
            });
          } else {
            setRcControllingPeer({ socketId: fromSocketId, name: fromName });
            setViewMode('voice');
          }
        }
      );
      p2pSock.on('rc:permissions-updated', ({ fromSocketId, permissions }: { fromSocketId: string; permissions: RcPermissions }) => {
        if (rcControllingPeerRef.current?.socketId === fromSocketId) {
          const allowed = [
            permissions.mouse && 'Mouse',
            permissions.keyboard && 'Teclado',
            permissions.gamepad && 'Controle Xbox',
          ].filter(Boolean);
          showToast(`Permissões do Host: ${allowed.join(', ') || 'Somente visão'}`, 'info');
        }
      });
      p2pSock.on('rc:declined', ({ fromSocketId, fromName }: { fromSocketId: string; fromName: string }) => {
        rcOutgoingRef.current.delete(fromSocketId);
        showToast(`${fromName} recusou o controle remoto.`, 'info');
      });
      p2pSock.on('rc:revoked', ({ fromSocketId }: { fromSocketId: string }) => {
        const remaining = rcControlledPeersRef.current.filter((p) => p.socketId !== fromSocketId);
        setRcControlledPeers(remaining);
        if (remaining.length === 0) {
          window.electronAPI?.rcDisable().catch(() => {});
          setRcControlledByPeer(null);
        }
        if (rcControllingPeerRef.current?.socketId === fromSocketId) {
          setRcControllingPeer(null);
        }
      });

      await new Promise<void>((resolve, reject) => {
        if (p2pSock.connected) return resolve();
        const timer = window.setTimeout(() => reject(new Error('Tempo esgotado na chamada LAN P2P.')), 6500);
        p2pSock.once('connect', () => {
          window.clearTimeout(timer);
          resolve();
        });
        p2pSock.once('connect_error', (err) => {
          window.clearTimeout(timer);
          reject(err);
        });
      });

      await rtc.prepareJoin(dmRoomId, p2pSock.id || '', muted, deafened);
      p2pSock.emit(
        'voice:join',
        { channelId: dmRoomId, muted, deafened },
        async (res: { ok?: boolean; error?: string; selfSocketId?: string; peers?: VoiceParticipant[]; musicState?: MusicState; videoState?: VideoState }) => {
          if (!res?.ok) {
            disconnectLanCallSocket();
            rtc.leaveChannel();
            showError(res?.error || 'Falha ao iniciar chamada LAN P2P.');
            return;
          }
          audioEngine.playUiTone('join');
          setActiveVoiceChannelId(dmRoomId);
          setViewMode('voice');
          const mySid = res.selfSocketId || p2pSock.id || '';
          setSelfSocketId(mySid);
          const selfPart: VoiceParticipant = {
            socketId: mySid,
            userId: curUser.id,
            displayName: curUser.displayName,
            avatarUrl: curUser.avatarUrl,
            avatarColor: curUser.avatarColor,
            muted,
            deafened,
            cameraOn: false,
            screenSharing: false,
            screenLabel: '',
            joinedAt: Date.now(),
          };
          setDmVoiceParticipants([selfPart, ...(res.peers || [])]);
          await rtc.completeJoin(dmRoomId, mySid, res.peers || []);
          if (res.musicState) {
            setMusicState(res.musicState);
            audioEngine.syncMusicState(res.musicState);
          }
          if (res.videoState) setVideoState({ ...res.videoState, receivedAt: Date.now() });
        }
      );
    },
    [muted, deafened, isElectron, revokeRemoteControlInternal, disconnectLanCallSocket, syncClockWithSocket, showError, showToast, bindRecConsentEvents]
  );

  useEffect(() => {
    joinVoiceRef.current = handleJoinOrFocusVoiceChannel;
  }, [handleJoinOrFocusVoiceChannel]);

  const handleLeaveVoice = () => {
    revokeRemoteControlInternal(true);
    audioEngine.playUiTone('leave');
    if (isLanCallActiveRef.current) {
      disconnectLanCallSocket();
    } else {
      socketRef.current?.emit('voice:leave');
    }
    rtcRef.current?.leaveChannel();
    audioEngine.stopMusic();
    audioEngine.stopAllSounds();
    setActiveVoiceChannelId(null);
    setDmVoiceParticipants([]);
    setMusicState(null);
    setVideoState(null);
    setVoiceDrawer('none');
    setViewMode('chat');
  };

  const handleToggleMute = () => {
    const nextMuted = !muted;
    const nextDeaf = !nextMuted && deafened ? false : deafened;
    if (!nextDeaf) mutedBeforeDeafenRef.current = false;
    setMuted(nextMuted);
    setMutedTalkAlert(false);
    if (nextDeaf !== deafened) setDeafened(nextDeaf);
    audioEngine.playUiTone(nextMuted ? 'mute' : 'unmute');
    rtcRef.current?.setMuteDeafen(nextMuted, nextDeaf);
    (p2pCallSocketRef.current || socketRef.current)?.emit('voice:media-state', { muted: nextMuted, deafened: nextDeaf });
  };

  const handleToggleDeafen = () => {
    const nextDeaf = !deafened;
    let nextMuted = muted;
    if (nextDeaf) {
      mutedBeforeDeafenRef.current = muted;
      nextMuted = true;
    } else {
      nextMuted = mutedBeforeDeafenRef.current;
    }
    setDeafened(nextDeaf);
    setMuted(nextMuted);
    setMutedTalkAlert(false);
    // Distinct Discord 3-note chime for headphones vs mic!
    audioEngine.playUiTone(nextDeaf ? 'deafen_on' : 'deafen_off');
    audioEngine.setDeafened(nextDeaf || Boolean(user?.serverDeafened));
    rtcRef.current?.setMuteDeafen(nextMuted, nextDeaf);
    (p2pCallSocketRef.current || socketRef.current)?.emit('voice:media-state', { muted: nextMuted, deafened: nextDeaf });
  };

  toggleMuteRef.current = handleToggleMute;
  toggleDeafenRef.current = handleToggleDeafen;

  // Mensagem nova de outra pessoa: som do app (se não estiver olhando aquela conversa) e notificação do
  // Windows (com o app fora de foco). Ocupado: nenhum som nem notificação.
  desktopNotifyRef.current = (msg, kind) => {
    const me = userRef.current;
    const prefs = getDesktopPrefs();
    if (!me || msg.authorId === me.id) return;
    if (me.statusType === 'dnd') return;
    if (blockedUserIds.has(msg.authorId)) return;
    const focused = document.hasFocus();
    const viewing =
      viewMode === 'chat' &&
      (kind === 'dm' ? navArea === 'dms' && activeDmUserId === msg.authorId : navArea === 'server' && activeTextChannelId === msg.channelId);
    const playSound = () => {
      if (prefs.notificationSound && !deafened && !(focused && viewing)) audioEngine.playUiTone(kind === 'dm' ? 'message_dm' : 'message');
    };
    if (kind === 'dm') playSound();
    let title = msg.authorName || 'Waver';
    let route: NotificationRoute = null;
    if (kind === 'dm') {
      route = { type: 'dm', userId: msg.authorId };
    } else {
      const ch = channels.find((c) => c.id === msg.channelId);
      if (!ch) return;
      const level = channelNotifyMap[msg.channelId] || serverNotifyLevel;
      if (level === 'nothing') return;
      if (level === 'mentions') {
        const text = (msg.content || '').toLowerCase();
        const mentioned =
          text.includes('@everyone') ||
          text.includes('@here') ||
          text.includes('@' + (me.displayName || '').toLowerCase()) ||
          text.includes('@' + (me.username || '').toLowerCase()) ||
          (Boolean(msg.replyTo?.authorName) && msg.replyTo?.authorName === me.displayName);
        if (!mentioned) return;
      }
      title = `${msg.authorName} (#${ch.name})`;
      route = { type: 'channel', id: ch.id };
      playSound();
    }
    if (focused || !prefs.notifications || !window.electronAPI?.showNotification) return;
    const body =
      (msg.content || '').trim() ||
      (msg.attachments?.length ? '📎 Enviou um anexo' : msg.gifUrl ? 'Enviou um GIF' : msg.transfer ? '📦 Enviou um arquivo' : 'Nova mensagem');
    window.electronAPI
      .showNotification({
        title,
        body: body.slice(0, 220),
        iconDataUrl: msg.authorAvatar && msg.authorAvatar.startsWith('data:image/') ? msg.authorAvatar : undefined,
        route,
        // o som já é tocado pelo próprio app
        silent: true,
      })
      .catch(() => {});
  };

  const handlePickShareTarget = async (target: { type: 'channel'; id: string } | { type: 'dm'; userId: string }) => {
    const api = window.electronAPI;
    if (!api?.readSharedFile || !pendingShareFiles.length) return;
    const LIMIT = 55 * 1024 * 1024;
    const big = pendingShareFiles.filter((f) => f.size > LIMIT);
    const ok = pendingShareFiles.filter((f) => f.size <= LIMIT).slice(0, 6);
    if (!ok.length) {
      showError('Arquivos acima de 55 MB: use a Transferência Pesada (botão + no chat).');
      return;
    }
    setShareBusy(true);
    try {
      const files: File[] = [];
      for (const f of ok) {
        const bytes = await api.readSharedFile(f.path);
        files.push(new File([bytes as BlobPart], f.name, { type: guessMimeFromName(f.name) }));
      }
      if (target.type === 'channel') {
        setNavArea('server');
        setActiveTextChannelId(target.id);
      } else {
        setNavArea('dms');
        setActiveGroupId(null);
        setActiveDmUserId(target.userId);
      }
      setViewMode('chat');
      setIncomingFilesRequest({ files, seq: Date.now() });
      const skippedCount = pendingShareFiles.length - ok.length;
      setPendingShareFiles([]);
      api.clearPendingShares?.().catch(() => {});
      if (big.length) showToast(`${big.length} arquivo(s) acima de 55 MB ficaram de fora: use a Transferência Pesada.`, 'info');
      else if (skippedCount > 0) showToast('Só 6 arquivos por mensagem: os demais ficaram de fora.', 'info');
    } catch (err: unknown) {
      showError((err as Error).message || 'Não foi possível ler os arquivos.');
    } finally {
      setShareBusy(false);
    }
  };

  const handlePinMessage = useCallback(
    async (messageId: string, pinned: boolean) => {
      if (!user) return;
      if (navArea === 'dms' && activeGroupId) {
        const grp = dmGroups.find((g) => g.id === activeGroupId);
        if (grp?.isLanP2p || !server) {
          await window.electronAPI
            ?.lanPeersPinGroupMessage?.({
              groupId: activeGroupId,
              messageId,
              pinned,
            })
            .catch(() => {});
          setGroupMessagesById((prev) => ({
            ...prev,
            [activeGroupId]: (prev[activeGroupId] || []).map((m) =>
              m.id === messageId
                ? { ...m, pinned, pinnedAt: pinned ? Date.now() : null, pinnedBy: pinned ? user.displayName : null }
                : m
            ),
          }));
          return;
        }
        socketRef.current?.emit('dm-group:pin', { groupId: activeGroupId, messageId, pinned });
        return;
      }
      if (navArea === 'dms' && activeDmUserId) {
        const isLanOnly =
          lanPeersRef.current.some((p) => p.peerId === activeDmUserId) &&
          !members.some((m) => m.id === activeDmUserId);
        if (isLanOnly) {
          const peer = lanPeersRef.current.find((p) => p.peerId === activeDmUserId);
          const myId = localPeerInfoRef.current?.peerId || user.id;
          const pairKey = getDmPairKey(myId, activeDmUserId);
          await window.electronAPI
            ?.lanPeersPinDm?.({
              toPeerId: activeDmUserId,
              peerUrl: peer?.p2pUrl,
              pairKey,
              messageId,
              pinned,
            })
            .catch(() => {});
          setDmMessagesByPair((prev) => {
            const list = prev[pairKey] || [];
            const updated = list.map((m) =>
              m.id === messageId
                ? { ...m, pinned, pinnedAt: pinned ? Date.now() : null, pinnedBy: pinned ? user.displayName : null }
                : m
            );
            const next = { ...prev, [pairKey]: updated };
            schedulePersistDmArchive(next);
            return next;
          });
          return;
        }
        socketRef.current?.emit('dm:pin', { toUserId: activeDmUserId, messageId, pinned });
        return;
      }

      if (api && activeTextChannelId) {
        await api.pinChannelMessage(activeTextChannelId, messageId, pinned).catch((e) => {
          showError(e?.message || 'Erro ao fixar mensagem.');
        });
      }
    },
    [user, navArea, activeDmUserId, activeGroupId, dmGroups, server, members, api, activeTextChannelId, schedulePersistDmArchive, showError]
  );

  const handleUpdatePeerRcPermissions = useCallback(
    async (targetSocketId: string, permissions: RcPermissions) => {
      setRcControlledPeers((prev) =>
        prev.map((p) => (p.socketId === targetSocketId ? { ...p, permissions } : p))
      );
      await window.electronAPI?.rcSetPermissions?.(permissions).catch(() => {});
      (p2pCallSocketRef.current || socketRef.current)?.emit('rc:permissions-update', { targetSocketId, permissions });
    },
    []
  );

  const handleAddMusicUrlToVoice = useCallback(
    (url: string): Promise<{ ok?: boolean; error?: string; count?: number }> => {
      return new Promise((resolve) => {
        const chId = activeVoiceChannelIdRef.current;
        const activeSock = p2pCallSocketRef.current || socketRef.current;
        if (!chId || !activeSock) return resolve({ error: 'Entre em uma sala de voz primeiro!' });
        activeSock.emit('music:add-url', { channelId: chId, url }, (res: { ok?: boolean; error?: string; count?: number }) => {
          if (res?.ok) showToast(`Música adicionada (${res.count || 1} faixa${(res.count || 1) > 1 ? 's' : ''})!`, 'info');
          resolve(res || { error: 'Falha ao adicionar link.' });
        });
      });
    },
    [showToast]
  );

  const handleAddVideoUrlToVoice = useCallback(
    (url: string): Promise<{ ok?: boolean; error?: string }> => {
      return new Promise((resolve) => {
        const chId = activeVoiceChannelIdRef.current;
        const activeSock = p2pCallSocketRef.current || socketRef.current;
        if (!chId || !activeSock) return resolve({ error: 'Entre em uma sala de voz primeiro!' });
        activeSock.emit('video:add-url', { channelId: chId, url }, (res: { ok?: boolean; error?: string }) => {
          if (res?.ok) {
            setViewMode('voice');
            showToast('Vídeo adicionado ao Cinema da Call!', 'info');
          }
          resolve(res || { error: 'Falha ao adicionar vídeo.' });
        });
      });
    },
    [showToast]
  );

  const handleToggleCamera = () => {
    if (!activeVoiceChannelId) return;
    rtcRef.current?.toggleCamera();
  };

  const handleStartScreenShare = async (config: ScreenShareConfig) => {
    setShowScreenModal(false);
    if (!activeVoiceChannelId) return;
    const ok = await rtcRef.current?.startScreenShare(config);
    if (ok) setViewMode('voice');
  };

  const handleStopScreenShare = () => {
    if (rcControlledByPeerRef.current) revokeRemoteControlInternal(true);
    rtcRef.current?.stopScreenShare();
  };

  // Private DM navigation & 1-on-1 private calls
  const handleOpenDmWithUser = useCallback((targetUser: User) => {
    if (!userRef.current || targetUser.id === userRef.current.id) return;
    setNavArea('dms');
    setActiveDmUserId(targetUser.id);
    setViewMode('chat');
    setUnreadDmByUser((prev) => {
      if (!prev[targetUser.id]) return prev;
      const copy = { ...prev };
      delete copy[targetUser.id];
      return copy;
    });
  }, []);

  const handleStartPrivateCall = useCallback(
    async (targetUser: User) => {
      if (!userRef.current || targetUser.id === userRef.current.id) return;
      const targetLanPeer = lanPeersRef.current.find((p) => p.peerId === targetUser.id);
      const isLanOnly = !server || (Boolean(targetLanPeer) && !members.some((m) => m.id === targetUser.id));
      if (isLanOnly && targetLanPeer && window.electronAPI?.lanPeersCallInvite) {
        const myPeerId = localPeerInfoRef.current?.peerId || userRef.current.id;
        const dmRoomId = `dm:${getDmPairKey(myPeerId, targetLanPeer.peerId)}`;
        setNavArea('dms');
        setActiveDmUserId(targetLanPeer.peerId);
        try {
          const res = await window.electronAPI.lanPeersCallInvite({
            toPeerId: targetLanPeer.peerId,
            peerUrl: targetLanPeer.p2pUrl,
            dmRoomId,
          });
          const localCallUrl = localPeerInfoRef.current?.p2pUrl || res.callServerUrl;
          await connectAndJoinLanCall(localCallUrl, dmRoomId);
          showToast(`Chamando ${targetUser.displayName} (LAN P2P)...`, 'info');
        } catch (err: unknown) {
          showError((err as Error).message || 'Não foi possível chamar o amigo na LAN.');
        }
        return;
      }
      const dmRoomId = `dm:${getDmPairKey(userRef.current.id, targetUser.id)}`;
      setNavArea('dms');
      setActiveDmUserId(targetUser.id);
      await handleJoinOrFocusVoiceChannel(dmRoomId);
      socketRef.current?.emit('dm:call-invite', { toUserId: targetUser.id });
      showToast(`Chamando ${targetUser.displayName}...`, 'info');
    },
    [server, members, connectAndJoinLanCall, handleJoinOrFocusVoiceChannel, showToast, showError]
  );

  const handlePrepareLanAttachments = useCallback(
    async (
      files: File[],
      meta?: Array<{ waveform?: number[]; durationSec?: number; isVoiceMessage?: boolean }>
    ): Promise<Array<Attachment & { _rawBytes?: Uint8Array }>> => {
      const results: Array<Attachment & { _rawBytes?: Uint8Array }> = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const m = meta?.[i] || {};
        const buf = new Uint8Array(await file.arrayBuffer());
        const isImg = file.type.startsWith('image/');
        const isAud = file.type.startsWith('audio/') || Boolean(m.isVoiceMessage);
        const isVid = file.type.startsWith('video/');
        results.push({
          id: `lan-att-${Date.now()}-${i}`,
          url: URL.createObjectURL(file),
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          kind: isImg ? 'image' : isAud ? 'audio' : isVid ? 'video' : 'file',
          waveform: m.waveform,
          durationSec: m.durationSec,
          isVoiceMessage: m.isVoiceMessage,
          _rawBytes: buf,
        });
      }
      return results;
    },
    []
  );

  // Send server text message, private group message OR private 1-on-1 DM message (Server or Serverless LAN P2P)
  const handleSendMessage = async (payload: {
    content: string;
    attachments: Array<Attachment & { _rawBytes?: Uint8Array }>;
    gifUrl?: string | null;
    transfer?: FileTransfer | null;
    replyTo?: ChatMessage['replyTo'];
  }) => {
    if (navArea === 'dms' && activeGroupId) {
      const grp = dmGroups.find((g) => g.id === activeGroupId);
      if (grp?.isLanP2p || !server) {
        if (!window.electronAPI?.lanPeersSendGroupMessage) return;
        try {
          const sendAtts = payload.attachments.map((att) => ({
            url: att.url,
            name: att.name,
            mimeType: att.mimeType,
            size: att.size,
            kind: att.kind,
            waveform: att.waveform,
            durationSec: att.durationSec,
            isVoiceMessage: att.isVoiceMessage,
            bytes: att._rawBytes,
          }));
          const res = await window.electronAPI.lanPeersSendGroupMessage({
            groupId: activeGroupId,
            content: payload.content,
            attachments: sendAtts,
            gifUrl: payload.gifUrl || null,
            replyTo: payload.replyTo || null,
          });
          if (res?.message) {
            setGroupMessagesById((prev) => {
              const cur = prev[activeGroupId] || [];
              if (cur.some((m) => m.id === res.message!.id)) return prev;
              return { ...prev, [activeGroupId]: [...cur, res.message!] };
            });
          }
        } catch (err: unknown) {
          showError((err as Error).message || 'Falha ao enviar mensagem para o grupo.');
        }
        return;
      }
      socketRef.current?.emit('dm-group:send', { groupId: activeGroupId, ...payload });
      return;
    }
    if (navArea === 'dms' && activeDmUserId) {
      const targetLanPeer = lanPeersRef.current.find((p) => p.peerId === activeDmUserId);
      const isLanOnly = !server || (Boolean(targetLanPeer) && !members.some((m) => m.id === activeDmUserId));
      if (isLanOnly && targetLanPeer && window.electronAPI?.lanPeersSendDm) {
        try {
          const sendAtts = payload.attachments.map((att) => ({
            url: att.url,
            name: att.name,
            mimeType: att.mimeType,
            size: att.size,
            kind: att.kind,
            waveform: att.waveform,
            durationSec: att.durationSec,
            isVoiceMessage: att.isVoiceMessage,
            bytes: att._rawBytes,
          }));
          const res = await window.electronAPI.lanPeersSendDm({
            toPeerId: targetLanPeer.peerId,
            peerUrl: targetLanPeer.p2pUrl,
            content: payload.content,
            attachments: sendAtts,
            gifUrl: payload.gifUrl || null,
            replyTo: payload.replyTo || null,
          });
          if (res?.message) {
            const pairKey = res.message.pairKey || getDmPairKey(localPeerInfoRef.current?.peerId || user?.id || '', targetLanPeer.peerId);
            setDmMessagesByPair((prev) => {
              const cur = prev[pairKey] || [];
              if (cur.some((m) => m.id === res.message!.id)) return prev;
              const next = { ...prev, [pairKey]: [...cur, res.message!] };
              schedulePersistDmArchive(next);
              return next;
            });
          }
        } catch (err: unknown) {
          showError((err as Error).message || 'Falha ao enviar DM na LAN.');
        }
        return;
      }

      socketRef.current?.emit('dm:send', { toUserId: activeDmUserId, ...payload });
      return;
    }
    if (!activeTextChannelId) return;
    socketRef.current?.emit('chat:send', { channelId: activeTextChannelId, ...payload });
  };

  const handleDeleteChannel = async (ch: Channel) => {
    if (!api) return;
    if (!window.confirm(`Deseja realmente excluir o canal "${ch.name}"?`)) return;
    try {
      await api.deleteChannel(ch.id);
    } catch (err: unknown) {
      showError((err as Error).message || 'Erro ao excluir canal.');
    }
  };

  // ===== Status de disponibilidade =====
  // Troca o status na hora (servidor + perfil global da LAN). `auto` = feito pelo "ausente automático":
  // não grava no perfil global, para o app não abrir já como Ausente da próxima vez.
  const AUTO_AWAY_KEY = 'pc-auto-away';
  const applySelfStatus = useCallback((st: PresenceStatus, opts?: { auto?: boolean }) => {
    const me = userRef.current;
    if (!me) return;
    try {
      if (opts?.auto && st === 'idle') localStorage.setItem(AUTO_AWAY_KEY, '1');
      else localStorage.removeItem(AUTO_AWAY_KEY);
    } catch {}
    if (me.statusType === st) return;
    setUser((prev) => (prev ? { ...prev, statusType: st } : prev));
    socketRef.current?.emit('user:status', { statusType: st });
    if (!opts?.auto) persistLocalGlobalProfile({ statusType: st }).catch(() => {});
  }, []);

  // Ausente automático: só para quem está "Disponível". Depois de 10 min sem mexer no app e sem som saindo
  // do microfone, vira Ausente; ao clicar/teclar no app (ou voltar a falar) volta na hora para Disponível.
  // Ocupado, Invisível e Ausente escolhidos à mão nunca são trocados sozinhos.
  const lastPresenceActRef = useRef(Date.now());
  const autoAwayActiveRef = useRef(false);
  useEffect(() => {
    try {
      autoAwayActiveRef.current = localStorage.getItem(AUTO_AWAY_KEY) === '1';
    } catch {}
  }, []);
  useEffect(() => {
    if (localSpeaking) {
      lastPresenceActRef.current = Date.now();
      if (autoAwayActiveRef.current && userRef.current?.statusType === 'idle') {
        autoAwayActiveRef.current = false;
        applySelfStatus('online');
      }
    }
  }, [localSpeaking, applySelfStatus]);
  useEffect(() => {
    const IDLE_MS = 10 * 60 * 1000;
    let lastMove = 0;
    const wake = () => {
      lastPresenceActRef.current = Date.now();
      if (autoAwayActiveRef.current) {
        autoAwayActiveRef.current = false;
        if (userRef.current?.statusType === 'idle') applySelfStatus('online');
      }
    };
    const onMove = () => {
      const now = Date.now();
      if (now - lastMove < 2000) return;
      lastMove = now;
      lastPresenceActRef.current = now;
    };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    window.addEventListener('wheel', onMove, { capture: true, passive: true });
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('focus', onMove);
    const iv = window.setInterval(() => {
      const me = userRef.current;
      if (!me) return;
      if (me.statusType !== 'online') {
        // escolheu outro status à mão: o ausente automático não mexe mais
        if (me.statusType !== 'idle') autoAwayActiveRef.current = false;
        return;
      }
      if (isSpeaking(selfSocketIdRef.current)) lastPresenceActRef.current = Date.now();
      if (Date.now() - lastPresenceActRef.current >= IDLE_MS) {
        autoAwayActiveRef.current = true;
        applySelfStatus('idle', { auto: true });
      }
    }, 15000);
    return () => {
      window.removeEventListener('pointerdown', wake, true);
      window.removeEventListener('keydown', wake, true);
      window.removeEventListener('wheel', onMove, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('focus', onMove);
      window.clearInterval(iv);
    };
  }, [applySelfStatus]);

  // Profile & Context Menu open handlers
  const handleOpenUserProfilePopout = useCallback((targetUser: User, e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenuTarget(null);
    setProfilePopout({ userId: targetUser.id, x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenUserContextMenu = useCallback(
    (
      targetUser: User,
      e: React.MouseEvent,
      meta?: { socketId?: string; inVoiceChannelId?: string | null; isSharingScreen?: boolean }
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setProfilePopout(null);

      // Enrich voice meta automatically from voiceRooms / dmVoiceParticipants if not provided
      let socketId = meta?.socketId;
      let inVoiceChannelId = meta?.inVoiceChannelId ?? null;
      let isSharingScreen = meta?.isSharingScreen ?? false;

      if (!socketId) {
        if (activeVoiceChannelIdRef.current?.startsWith('dm:')) {
          const p = dmVoiceParticipants.find((x) => x.userId === targetUser.id);
          if (p) {
            socketId = p.socketId;
            inVoiceChannelId = activeVoiceChannelIdRef.current;
            isSharingScreen = p.screenSharing;
          }
        }
        if (!socketId) {
          for (const [chId, list] of Object.entries(voiceRooms)) {
            const p = list.find((x) => x.userId === targetUser.id);
            if (p) {
              socketId = p.socketId;
              inVoiceChannelId = chId;
              isSharingScreen = p.screenSharing;
              break;
            }
          }
        }
      }

      setContextMenuTarget({
        user: targetUser,
        socketId,
        inVoiceChannelId,
        isSharingScreen,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [voiceRooms, dmVoiceParticipants]
  );

  // Remote Control actions
  const handleInviteRemoteControl = useCallback(
    (targetSocketId: string) => {
      if (!isElectron) {
        showError('Controle remoto (Parsec/AnyDesk) requer o app Desktop Waver (.exe) no PC que compartilha a tela.');
        return;
      }
      if (!localScreenStream) {
        showError('Compartilhe sua tela primeiro para convidar alguém a controlá-la.');
        return;
      }
      rcOutgoingRef.current.set(targetSocketId, { kind: 'invite', at: Date.now() });
      (p2pCallSocketRef.current || socketRef.current)?.emit('rc:invite', { targetSocketId });
      showToast('Convite de controle remoto enviado! Aguardando aceitação.', 'info');
    },
    [isElectron, localScreenStream, showError, showToast]
  );

  const handleRequestRemoteControl = useCallback(
    (targetSocketId: string) => {
      rcOutgoingRef.current.set(targetSocketId, { kind: 'request', at: Date.now() });
      (p2pCallSocketRef.current || socketRef.current)?.emit('rc:request', { targetSocketId });
      showToast('Pedido de controle remoto enviado! Aguardando permissão.', 'info');
    },
    [showToast]
  );

  const handleAcceptRcPrompt = async () => {
    if (!rcPendingPrompt) return;
    const { kind, fromSocketId, fromName } = rcPendingPrompt;
    setRcPendingPrompt(null);
    const activeSock = p2pCallSocketRef.current || socketRef.current;

    if (kind === 'request') {
      // Someone asked to control MY screen
      if (!isElectron) {
        showError('Controle remoto do PC requer o app Desktop Waver (.exe).');
        activeSock?.emit('rc:decline', { targetSocketId: fromSocketId });
        return;
      }
      const ok = await window.electronAPI!.rcEnable();
      if (!ok) {
        showError('Não foi possível iniciar o controle de mouse/teclado do Windows.');
        activeSock?.emit('rc:decline', { targetSocketId: fromSocketId });
        return;
      }
      const defaultPerms: RcPermissions = { mouse: true, keyboard: true, gamepad: true };
      await window.electronAPI?.rcSetPermissions?.(defaultPerms).catch(() => {});
      setRcControlledByPeer({ socketId: fromSocketId, name: fromName });
      setRcControlledPeers((prev) => {
        const filtered = prev.filter((p) => p.socketId !== fromSocketId);
        return [...filtered, { socketId: fromSocketId, name: fromName, permissions: defaultPerms, gamepadSlot: filtered.length % 4 }];
      });
      activeSock?.emit('rc:accept', { targetSocketId: fromSocketId, role: 'host', permissions: defaultPerms });
      showToast(`${fromName} recebeu permissão para controlar seu PC. Use Ctrl+Shift+Esc para cancelar.`, 'info');
    } else {
      // Someone invited ME to control THEIR screen
      setRcControllingPeer({ socketId: fromSocketId, name: fromName });
      setViewMode('voice');
      activeSock?.emit('rc:accept', { targetSocketId: fromSocketId, role: 'controller' });
      showToast(`Você agora está controlando a tela de ${fromName}!`, 'info');
    }
  };

  const handleDeclineRcPrompt = () => {
    if (!rcPendingPrompt) return;
    (p2pCallSocketRef.current || socketRef.current)?.emit('rc:decline', { targetSocketId: rcPendingPrompt.fromSocketId });
    setRcPendingPrompt(null);
  };

  // Derived active channels, groups, DMs, permissions, participants & users
  const serverPermissions = useMemo(() => computeServerPermissions(user, roles), [user, roles]);
  const activeTextChannel =
    channels.find((c) => c.id === activeTextChannelId) || channels.find((c) => c.type === 'text') || null;
  const activeVoiceChannel = channels.find((c) => c.id === activeVoiceChannelId) || null;
  const activeTextPermissions = useMemo(
    () => computeChannelPermissions(user, roles, activeTextChannel, categories),
    [user, roles, activeTextChannel, categories]
  );
  const activeVoicePermissions = useMemo(
    () => computeChannelPermissions(user, roles, activeVoiceChannel, categories),
    [user, roles, activeVoiceChannel, categories]
  );
  const isInDmVoice = Boolean(
    activeVoiceChannelId && (activeVoiceChannelId.startsWith('dm:') || activeVoiceChannelId.startsWith('group:'))
  );
  const activeGroup = useMemo(
    () => (activeGroupId ? dmGroups.find((g) => g.id === activeGroupId) || null : null),
    [activeGroupId, dmGroups]
  );
  const availableGroupPeers = useMemo<PrivateGroupMemberMeta[]>(() => {
    const out: PrivateGroupMemberMeta[] = [];
    const seenIds = new Set<string>();
    const seenUsernames = new Set<string>();
    const myId = user?.id;
    const myPeerId = localPeerInfo?.peerId;
    const myUsername = user?.username?.toLowerCase();
    for (const m of members) {
      if (m.id === myId || m.id === myPeerId) continue;
      seenIds.add(m.id);
      if (m.username) seenUsernames.add(m.username.toLowerCase());
      out.push({
        id: m.id,
        username: m.username,
        displayName: m.displayName,
        avatarColor: m.avatarColor,
        avatarUrl: m.avatarUrl || null,
      });
    }
    for (const lp of lanPeers) {
      if (lp.peerId === myId || lp.peerId === myPeerId) continue;
      if (seenIds.has(lp.peerId)) continue;
      if (lp.username && myUsername && lp.username.toLowerCase() === myUsername) continue;
      if (lp.username && seenUsernames.has(lp.username.toLowerCase())) continue;
      out.push({
        id: lp.peerId,
        username: lp.username,
        displayName: lp.displayName,
        avatarColor: lp.avatarColor || '#5865f2',
        avatarUrl: lp.avatarUrl || null,
        p2pUrl: lp.p2pUrl,
      });
    }
    return out;
  }, [members, lanPeers, user?.id, user?.username, localPeerInfo?.peerId]);

  const handleStartGroupCall = useCallback(
    async (group: PrivateGroup) => {
      if (!userRef.current) return;
      const dmRoomId = `group:${group.id}`;
      setNavArea('dms');
      setActiveGroupId(group.id);
      setActiveDmUserId(null);

      if (group.isLanP2p || !server) {
        try {
          const res = await window.electronAPI?.lanPeersGroupCallInvite?.({ groupId: group.id });
          const targetUrl = res?.callServerUrl || group.hostP2pUrl || localPeerInfoRef.current?.p2pUrl || serverUrl;
          await connectAndJoinLanCall(targetUrl, dmRoomId);
          showToast(`Chamada em grupo "${group.name}" iniciada (LAN P2P)!`, 'info');
        } catch (err: unknown) {
          showError((err as Error).message || 'Não foi possível iniciar chamada em grupo LAN.');
        }
        return;
      }

      await handleJoinOrFocusVoiceChannel(dmRoomId);
      socketRef.current?.emit('dm-group:call-invite', { groupId: group.id });
      showToast(`Chamando integrantes de "${group.name}"...`, 'info');
    },
    [server, serverUrl, connectAndJoinLanCall, handleJoinOrFocusVoiceChannel, showToast, showError]
  );

  const handleSaveGroupModal = async (payload: {
    id?: string;
    name: string;
    memberIds: string[];
    membersMeta: PrivateGroupMemberMeta[];
    iconDataUrl?: string | null;
    clearIcon?: boolean;
    startCallNow?: boolean;
  }) => {
    const editingGrp = groupModal?.group || null;
    const useLan = Boolean(editingGrp?.isLanP2p || !server || !api);
    let savedGroup: PrivateGroup | null = null;

    if (useLan) {
      if (!window.electronAPI?.lanPeersSaveGroup) {
        throw new Error('Grupos LAN P2P requerem o app Waver (.exe).');
      }
      const res = await window.electronAPI.lanPeersSaveGroup({
        id: payload.id,
        name: payload.name,
        memberIds: payload.memberIds,
        membersMeta: payload.membersMeta,
        iconDataUrl: payload.iconDataUrl,
        clearIcon: payload.clearIcon,
      });
      savedGroup = res?.group || null;
    } else if (api) {
      if (payload.id && editingGrp) {
        const prevSet = new Set(editingGrp.memberIds || []);
        const nextSet = new Set(payload.memberIds || []);
        const addMemberIds = payload.memberIds.filter((id) => !prevSet.has(id));
        const removeMemberIds = (editingGrp.memberIds || []).filter((id) => id !== user?.id && !nextSet.has(id));
        const { group } = await api.updateDmGroup(payload.id, {
          name: payload.name,
          iconDataUrl: payload.iconDataUrl,
          clearIcon: payload.clearIcon,
          addMemberIds: addMemberIds.length > 0 ? addMemberIds : undefined,
        });
        savedGroup = group;
        for (const remId of removeMemberIds) {
          const r = await api.updateDmGroup(payload.id, { removeMemberId: remId });
          savedGroup = r.group;
        }
      } else {
        const { group } = await api.createDmGroup({
          name: payload.name,
          memberIds: payload.memberIds,
          iconDataUrl: payload.iconDataUrl,
        });
        savedGroup = group;
      }
    }

    if (savedGroup) {
      setDmGroups((prev) => upsertPrivateGroup(prev, savedGroup!));
      setNavArea('dms');
      setActiveDmUserId(null);
      setActiveGroupId(savedGroup.id);
      setViewMode('chat');
      showToast(`Grupo "${savedGroup.name}" salvo!`, 'info');
      if (payload.startCallNow) {
        await handleStartGroupCall(savedGroup);
      }
    }
    setGroupModal(null);
  };

  const handleLeaveGroup = async (groupId: string) => {
    const grp = dmGroups.find((g) => g.id === groupId);
    if (grp && !grp.isLanP2p && server && api && user) {
      await api.updateDmGroup(groupId, { removeMemberId: user.id }).catch(() => {});
    }
    setDmGroups((prev) => prev.filter((g) => g.id !== groupId));
    if (activeGroupId === groupId) setActiveGroupId(null);
    setGroupModal(null);
    showToast('Você saiu do grupo.', 'info');
  };

  const handleOpenTrello = async (scopeKey: string, scopeTitle: string) => {
    setTrelloModal({ scopeKey, scopeTitle });
    const grp = scopeKey.startsWith('group:') ? dmGroups.find((g) => `group:${g.id}` === scopeKey) : null;
    const isLanScope = !server || !api || Boolean(grp?.isLanP2p) || (scopeKey.startsWith('dm:') && activeDmIsLanPeer);
    try {
      if (isLanScope && window.electronAPI?.lanPeersGetTrello) {
        const boards = await window.electronAPI.lanPeersGetTrello(scopeKey);
        if (Array.isArray(boards)) {
          setTrelloBoardsByScope((prev) => ({ ...prev, [scopeKey]: boards }));
        }
      } else if (api) {
        const res = await api.getTrelloBoards(scopeKey);
        if (Array.isArray(res.boards)) {
          setTrelloBoardsByScope((prev) => ({ ...prev, [scopeKey]: res.boards }));
        }
      }
    } catch {
      // keep cached boards if offline
    }
  };

  const handleSaveTrelloBoards = async (scopeKey: string, nextBoards: TrelloBoard[]) => {
    setTrelloBoardsByScope((prev) => ({ ...prev, [scopeKey]: nextBoards }));
    const grp = scopeKey.startsWith('group:') ? dmGroups.find((g) => `group:${g.id}` === scopeKey) : null;
    const isLanScope = !server || !api || Boolean(grp?.isLanP2p) || (scopeKey.startsWith('dm:') && activeDmIsLanPeer);
    try {
      if (isLanScope && window.electronAPI?.lanPeersSyncTrello) {
        await window.electronAPI.lanPeersSyncTrello({
          scopeKey,
          boards: nextBoards,
          peerUrls: lanPeers.map((p) => p.p2pUrl).filter(Boolean) as string[],
        });
      } else if (api) {
        await api.saveTrelloBoards(scopeKey, nextBoards);
      }
    } catch (err: unknown) {
      showError((err as Error).message || 'Erro ao salvar quadros do Trello.');
    }
  };

  const handleCreateCategoryPrompt = async () => {
    if (!api) return;
    const catName = window.prompt('Nome da nova categoria:', '');
    if (!catName || !catName.trim()) return;
    try {
      await api.createCategory({ name: catName.trim() });
      showToast(`Categoria "${catName.trim()}" criada!`, 'info');
    } catch (err: unknown) {
      showError((err as Error).message || 'Erro ao criar categoria.');
    }
  };

  const activeVoiceLabel = useMemo(() => {
    if (!activeVoiceChannelId) return '';
    if (activeVoiceChannel) return activeVoiceChannel.name;
    if (activeVoiceChannelId.startsWith('group:')) {
      const grp = dmGroups.find((g) => `group:${g.id}` === activeVoiceChannelId);
      return grp ? `Grupo • ${grp.name}` : 'Chamada em Grupo';
    }
    if (activeVoiceChannelId.startsWith('dm:') && user) {
      const ids = activeVoiceChannelId.slice(3).split('::');
      const otherId = ids.find((id) => id !== user.id && id !== localPeerInfo?.peerId) || ids[0];
      const peerMember = members.find((m) => m.id === otherId);
      if (peerMember) return `Privado • ${peerMember.displayName}`;
      const lanMatch = lanPeers.find((p) => p.peerId === otherId);
      return lanMatch ? `LAN P2P • ${lanMatch.displayName}` : 'Chamada Privada';
    }
    return 'Chamada de Voz';
  }, [activeVoiceChannelId, activeVoiceChannel, dmGroups, user, members, lanPeers, localPeerInfo?.peerId]);

  const activeVoiceParticipants = useMemo(() => {
    if (!activeVoiceChannelId) return [];
    if (isInDmVoice) return dmVoiceParticipants;
    return voiceRooms[activeVoiceChannelId] || [];
  }, [activeVoiceChannelId, isInDmVoice, dmVoiceParticipants, voiceRooms]);

  // ---- "Parar de assistir" uma transmissão: fico só no áudio da call e não baixo nada da tela dela
  const [notWatching, setNotWatching] = useState<string[]>([]);
  const lastNotWatchingSentRef = useRef('');
  useEffect(() => {
    setNotWatching([]);
    lastNotWatchingSentRef.current = '';
  }, [activeVoiceChannelId]);
  // quem parou de transmitir sai da lista (na próxima vez que transmitir, assisto de novo)
  useEffect(() => {
    if (notWatching.length === 0) return;
    const sharing = new Set(activeVoiceParticipants.filter((p) => p.screenSharing).map((p) => p.socketId));
    const gone = notWatching.filter((id) => !sharing.has(id));
    if (gone.length === 0) return;
    gone.forEach((id) => rtcRef.current?.setScreenWatching(id, true));
    setNotWatching((prev) => prev.filter((id) => sharing.has(id)));
  }, [activeVoiceParticipants, notWatching]);
  // Compara com o que o servidor tem de mim: depois de reconectar (ou trocar de socket) o participante volta sem
  // a lista, e quem transmite voltaria a me mandar a tela. Assim a lista é reenviada sozinha.
  useEffect(() => {
    if (!activeVoiceChannelId || !selfSocketId) return;
    const me = activeVoiceParticipants.find((p) => p.socketId === selfSocketId);
    if (!me) return;
    const key = notWatching.slice().sort().join(',');
    const serverKey = (me.notWatching || []).slice().sort().join(',');
    if (key === serverKey) {
      lastNotWatchingSentRef.current = '';
      return;
    }
    const sentKey = `${selfSocketId}|${key}`;
    if (sentKey === lastNotWatchingSentRef.current) return;
    lastNotWatchingSentRef.current = sentKey;
    (p2pCallSocketRef.current || socketRef.current)?.emit('voice:media-state', { notWatching });
  }, [notWatching, activeVoiceChannelId, activeVoiceParticipants, selfSocketId]);
  // quem saiu da MINHA transmissão não recebe a tela (malha)
  useEffect(() => {
    rtcRef.current?.setScreenBlockedPeers(
      activeVoiceParticipants.filter((p) => p.notWatching?.includes(selfSocketId)).map((p) => p.socketId)
    );
  }, [activeVoiceParticipants, selfSocketId, localScreenStream]);
  const setWatchingStream = useCallback((socketId: string, watching: boolean) => {
    rtcRef.current?.setScreenWatching(socketId, watching);
    setNotWatching((prev) => {
      const has = prev.includes(socketId);
      if (watching ? !has : has) return prev;
      return watching ? prev.filter((id) => id !== socketId) : [...prev, socketId];
    });
  }, []);

  const activeDmIsLanPeer = useMemo(() => {
    if (!activeDmUserId) return false;
    if (members.some((m) => m.id === activeDmUserId)) return false;
    return lanPeers.some((p) => p.peerId === activeDmUserId);
  }, [activeDmUserId, members, lanPeers]);

  const activeDmPeer = useMemo<User | null>(() => {
    if (!activeDmUserId) return null;
    const srvMatch = members.find((m) => m.id === activeDmUserId);
    if (srvMatch) return srvMatch;
    const lanMatch = lanPeers.find((p) => p.peerId === activeDmUserId);
    if (!lanMatch) return null;
    return {
      id: lanMatch.peerId,
      username: lanMatch.username,
      displayName: lanMatch.displayName,
      avatarColor: lanMatch.avatarColor || '#5865F2',
      avatarUrl: lanMatch.avatarUrl || null,
      bio: lanMatch.bio,
      customStatusEmoji: lanMatch.customStatusEmoji,
      customStatusText: lanMatch.customStatusText,
      currentActivity: lanMatch.currentActivity || null,
      online: true,
      statusType: 'online',
      role: 'member',
      roleIds: [],
      createdAt: Date.now(),
    };
  }, [activeDmUserId, members, lanPeers]);

  const activeDmPairKey = useMemo(() => {
    if (!user || !activeDmUserId) return '';
    if (activeDmIsLanPeer && localPeerInfo?.peerId) {
      return getDmPairKey(localPeerInfo.peerId, activeDmUserId);
    }
    return getDmPairKey(user.id, activeDmUserId);
  }, [user, activeDmUserId, activeDmIsLanPeer, localPeerInfo?.peerId]);

  const totalUnreadDms = useMemo(
    () =>
      Object.values(unreadDmByUser).reduce((acc, n) => acc + n, 0) +
      Object.values(unreadByGroup).reduce((acc, n) => acc + n, 0),
    [unreadDmByUser, unreadByGroup]
  );

  const speakingSocketIds = useMemo(() => {
    const set = new Set<string>();
    if (localSpeaking && selfSocketId) set.add(selfSocketId);
    for (const peer of Object.values(remotePeers)) {
      if (peer.speaking) set.add(peer.socketId);
    }
    return set;
  }, [localSpeaking, selfSocketId, remotePeers]);

  // Overlay da chamada sobre jogos (janela própria no Electron)
  useEffect(() => {
    window.electronAPI?.setOverlayConfig?.({
      enabled: desktopPrefs.overlayEnabled,
      corner: desktopPrefs.overlayCorner,
      onlySpeaking: desktopPrefs.overlayOnlySpeaking,
      onlyInGames: desktopPrefs.overlayOnlyInGames,
    });
  }, [desktopPrefs.overlayEnabled, desktopPrefs.overlayCorner, desktopPrefs.overlayOnlySpeaking, desktopPrefs.overlayOnlyInGames]);

  useEffect(() => {
    window.electronAPI?.setMediaActivity?.(desktopPrefs.mediaActivity).catch(() => {});
  }, [desktopPrefs.mediaActivity]);

  overlayToggleRef.current = () => {
    if (!getDesktopPrefs().overlayEnabled) return;
    window.electronAPI
      ?.toggleOverlay?.()
      .then((visible) => showToast(visible ? 'Overlay visível' : 'Overlay escondido', 'info'))
      .catch(() => {});
  };

  const overlayParticipants = activeVoiceChannelId ? voiceRooms[activeVoiceChannelId] : undefined;
  const overlaySentRef = useRef('');
  useEffect(() => {
    const send = window.electronAPI?.sendOverlayState;
    if (!send) return;
    if (!desktopPrefs.overlayEnabled || !activeVoiceChannelId) {
      if (overlaySentRef.current !== '') {
        overlaySentRef.current = '';
        send(null);
      }
      return;
    }
    const state = {
      channelName: activeVoiceLabel || 'Chamada',
      participants: (overlayParticipants || []).map((p) => {
        const self = p.socketId === selfSocketId;
        return {
          name: p.displayName,
          avatarUrl: p.avatarUrl ? resolveMediaUrl(serverUrl, p.avatarUrl) : null,
          avatarColor: p.avatarColor,
          speaking: speakingSocketIds.has(p.socketId),
          muted: self ? muted : Boolean(p.muted || p.serverMuted),
          deafened: self ? deafened : Boolean(p.deafened || p.serverDeafened),
        };
      }),
    };
    const key = JSON.stringify(state);
    if (key === overlaySentRef.current) return;
    overlaySentRef.current = key;
    send(state);
  }, [
    desktopPrefs.overlayEnabled,
    activeVoiceChannelId,
    activeVoiceLabel,
    overlayParticipants,
    speakingSocketIds,
    selfSocketId,
    muted,
    deafened,
    serverUrl,
  ]);

  // ---------- Reações, enquetes, threads, eventos e busca
  const emitAck = useCallback(
    (event: string, payload: object) =>
      new Promise<void>((resolve, reject) => {
        const sock = socketRef.current;
        if (!sock?.connected) return reject(new Error('Sem conexão com o servidor.'));
        sock.timeout(10000).emit(event, payload, (err: Error | null, res?: { error?: string }) => {
          if (err) reject(new Error('O servidor não respondeu. Tente de novo.'));
          else if (res?.error) reject(new Error(res.error));
          else resolve();
        });
      }),
    []
  );
  const handleReact = (channelId: string, messageId: string, emoji: string, threadParentId?: string) =>
    emitAck('chat:react', { channelId, messageId, emoji, threadParentId }).catch((err: Error) => showError(err.message));
  const handleVotePoll = (channelId: string, messageId: string, optionIds: string[]) =>
    emitAck('chat:poll-vote', { channelId, messageId, optionIds }).catch((err: Error) => showError(err.message));
  const handleClosePoll = (channelId: string, messageId: string) =>
    emitAck('chat:poll-close', { channelId, messageId }).catch((err: Error) => showError(err.message));
  const handleSubmitPoll = (channelId: string, draft: PollDraft) =>
    emitAck('chat:send', { channelId, content: '', attachments: [], poll: draft })
      .then(() => setPollComposerOpen(false))
      .catch((err: Error) => showError(err.message));
  const handleOpenThread = (channelId: string, msg: ChatMessage) => {
    if (!api) return;
    const hasReplies = Boolean(msg.thread?.count);
    setThreadView({ channelId, parent: msg, messages: [], loading: hasReplies });
    if (!hasReplies) return;
    api
      .getThread(channelId, msg.id)
      .then((r) =>
        setThreadView((tv) => (tv && tv.parent.id === msg.id ? { ...tv, parent: r.parent, messages: r.messages, loading: false } : tv))
      )
      .catch((err: Error) => {
        showError(err.message || 'Não foi possível abrir a thread.');
        setThreadView((tv) => (tv && tv.parent.id === msg.id ? { ...tv, loading: false } : tv));
      });
  };
  const handleSendThread = (text: string) => {
    const tv = threadViewRef.current;
    if (!tv) return Promise.resolve();
    return emitAck('chat:send', { channelId: tv.channelId, content: text, attachments: [], threadParentId: tv.parent.id }).catch(
      (err: Error) => {
        showError(err.message);
        throw err;
      }
    );
  };
  const handleSearchJump = (msg: ChatMessage) => {
    setShowSearch(false);
    setNavArea('server');
    setActiveTextChannelId(msg.channelId);
    setViewMode('chat');
    setJumpRequest({ id: msg.id, seq: Date.now() });
    window.setTimeout(() => {
      const list = messagesByChannelRef.current[msg.channelId] || [];
      if (!list.some((m) => m.id === msg.id)) showToast('Essa mensagem é antiga demais para aparecer na conversa carregada.', 'info');
    }, 2500);
  };

  // ---------- Gravação da chamada, clipes e palco
  const callRecordingRef = useRef<CallRecording | null>(null);
  const clipBufferRef = useRef<ClipBuffer | null>(null);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [clipsActive, setClipsActive] = useState(false);
  const recSourcesRef = useRef<() => RecSource[]>(() => []);
  recSourcesRef.current = () => {
    const list: RecSource[] = [{ key: 'self', stream: localMicStreamRef.current }];
    for (const p of Object.values(remotePeers)) {
      list.push({ key: `${p.socketId}:mic`, stream: p.micStream });
      if (p.screenAudioStream && !notWatching.includes(p.socketId)) list.push({ key: `${p.socketId}:screen`, stream: p.screenAudioStream });
    }
    return list;
  };
  const localScreenVideo = localScreenStream?.getVideoTracks()[0] || null;
  const localScreenVideoRef = useRef(localScreenVideo);
  localScreenVideoRef.current = localScreenVideo;
  const recMode: 'record' | 'clips' | null = recordingSince ? 'record' : clipsActive ? 'clips' : null;

  useEffect(() => {
    callRecordingRef.current?.updateSources(recSourcesRef.current());
    clipBufferRef.current?.updateSources(recSourcesRef.current(), localScreenVideo);
  }, [remotePeers, hasLocalMic, localScreenVideo]);

  useEffect(() => {
    const want = desktopPrefs.clipsEnabled && Boolean(activeVoiceChannelId) && typeof MediaRecorder !== 'undefined';
    if (want && !clipBufferRef.current) {
      try {
        clipBufferRef.current = new ClipBuffer(recSourcesRef.current(), localScreenVideoRef.current);
        setClipsActive(true);
      } catch (err) {
        console.warn('[Waver] Clipes indisponíveis:', err);
      }
    } else if (!want && clipBufferRef.current) {
      clipBufferRef.current.stop();
      clipBufferRef.current = null;
      setClipsActive(false);
    }
  }, [desktopPrefs.clipsEnabled, activeVoiceChannelId]);

  useEffect(
    () => () => {
      clipBufferRef.current?.stop();
      clipBufferRef.current = null;
      callRecordingRef.current?.stop().catch(() => {});
      callRecordingRef.current = null;
    },
    []
  );

  // avisa o servidor (todos na chamada veem REC / CLIPES); repete depois de reconectar
  useEffect(() => {
    if (!activeVoiceChannelId) return;
    (p2pCallSocketRef.current || socketRef.current)?.emit('voice:media-state', { recording: recMode });
  }, [recMode, activeVoiceChannelId, selfSocketId]);

  const handleToggleRecording = async () => {
    const current = callRecordingRef.current;
    if (current) {
      callRecordingRef.current = null;
      setRecordingSince(null);
      try {
        const file = await current.stop();
        showToast(file ? `Gravação salva em ${file}` : 'Gravação baixada.', 'info');
        if (file) window.electronAPI?.revealMediaFile?.(file).catch(() => {});
      } catch {
        showError('Não foi possível salvar a gravação.');
      }
      return;
    }
    if (!activeVoiceChannelId || typeof MediaRecorder === 'undefined') return;
    if (recRequestPending) {
      showToast('Ainda esperando a resposta de todos na chamada.', 'info');
      return;
    }
    const sock = p2pCallSocketRef.current || socketRef.current;
    if (!sock) return;
    setRecRequestPending(true);
    let answered = false;
    const fallback = window.setTimeout(() => {
      // servidor antigo (sem pedido de permissão): só avisa, como antes
      if (answered) return;
      setRecRequestPending(false);
      if (window.confirm('Este servidor não pede permissão para gravar. Gravar mesmo assim? Todos vão ver "REC" ao lado do seu nome.')) {
        startRecordingNowRef.current();
      }
    }, 5000);
    sock.emit('voice:record-request', {}, (res: { ok?: boolean; approved?: boolean; waiting?: number; error?: string }) => {
      answered = true;
      window.clearTimeout(fallback);
      if (res?.error) {
        setRecRequestPending(false);
        showError(res.error);
        return;
      }
      if (res?.approved) {
        setRecRequestPending(false);
        startRecordingNowRef.current();
        return;
      }
      showToast(`Pedindo permissão para gravar a ${res?.waiting || 0} pessoa(s) na chamada…`, 'info');
    });
  };
  startRecordingNowRef.current = () => {
    if (callRecordingRef.current || !activeVoiceChannelIdRef.current) return;
    try {
      callRecordingRef.current = new CallRecording(recSourcesRef.current(), localScreenVideoRef.current);
      setRecordingSince(Date.now());
      showToast(localScreenVideoRef.current ? 'Gravando a chamada e a sua transmissão.' : 'Gravando o áudio da chamada.', 'info');
    } catch {
      showError('Este computador não conseguiu iniciar a gravação.');
    }
  };
  const stopRecordingRef = useRef(handleToggleRecording);
  stopRecordingRef.current = handleToggleRecording;
  useEffect(() => {
    if (!activeVoiceChannelId && callRecordingRef.current) stopRecordingRef.current();
  }, [activeVoiceChannelId]);

  clipSaveRef.current = async () => {
    const buf = clipBufferRef.current;
    if (!buf) {
      showToast(
        getDesktopPrefs().clipsEnabled ? 'Os clipes funcionam durante uma chamada.' : 'Ligue os clipes em Configurações → Windows.',
        'info'
      );
      return;
    }
    try {
      const r = await buf.save();
      if (!r.seconds) return;
      audioEngine.playUiTone('unmute');
      showToast(r.path ? `Clipe de ${r.seconds} s salvo em Vídeos\\Waver\\Clipes.` : `Clipe de ${r.seconds} s baixado.`, 'info');
    } catch {
      showError('Não foi possível salvar o clipe.');
    }
  };

  const myVoiceParticipant = activeVoiceChannelId
    ? (voiceRooms[activeVoiceChannelId] || []).find((p) => p.socketId === selfSocketId)
    : undefined;
  const channelForcesMute = Boolean(myVoiceParticipant && (myVoiceParticipant.stageRole === 'audience' || myVoiceParticipant.noSpeak));
  useEffect(() => {
    rtcRef.current?.setChannelMuted(channelForcesMute);
  }, [channelForcesMute]);
  const isStageMod = Boolean(
    activeVoicePermissions.administrator ||
      activeVoicePermissions.muteMembers ||
      activeVoicePermissions.moveMembers ||
      activeVoicePermissions.manageChannels ||
      user?.role === 'host'
  );
  isStageModRef.current = isStageMod;

  // fecha a thread ao trocar de canal
  useEffect(() => {
    setThreadView((tv) => (tv && tv.channelId !== activeTextChannel?.id ? null : tv));
  }, [activeTextChannel?.id]);

  // eventos do servidor
  useEffect(() => {
    if (!api) {
      setServerEvents([]);
      return;
    }
    api
      .getEvents()
      .then((r) => setServerEvents(r.events || []))
      .catch(() => {});
  }, [api]);
  const upcomingEventsCount = useMemo(
    () => serverEvents.filter((e) => (e.endsAt || e.startsAt + 3 * 3600 * 1000) > Date.now()).length,
    [serverEvents]
  );

  // lembretes: 10 min antes e na hora, para quem marcou "Vou" ou "Talvez"
  useEffect(() => {
    const myId = user?.id;
    if (!serverEvents.length || !myId) return;
    const check = () => {
      const now = Date.now();
      let reminded: Record<string, number> = {};
      try {
        reminded = JSON.parse(localStorage.getItem('pc.eventReminders') || '{}') || {};
      } catch {}
      let changed = false;
      for (const ev of serverEvents) {
        const st = ev.rsvps?.[myId];
        if (st !== 'going' && st !== 'maybe') continue;
        const stages: Array<['soon' | 'start', boolean]> = [
          ['soon', now >= ev.startsAt - 10 * 60000 && now < ev.startsAt],
          ['start', now >= ev.startsAt && now < ev.startsAt + 15 * 60000],
        ];
        for (const [stage, due] of stages) {
          const key = `${ev.id}:${stage}`;
          if (!due || reminded[key]) continue;
          reminded[key] = now;
          changed = true;
          const text =
            stage === 'soon'
              ? `"${ev.title}" começa em ${Math.max(1, Math.round((ev.startsAt - now) / 60000))} min`
              : `"${ev.title}" está começando agora`;
          showToast(`📅 ${text}`, 'info');
          audioEngine.playUiTone('join');
          if (getDesktopPrefs().notifications && !document.hasFocus()) {
            window.electronAPI?.showNotification?.({ title: 'Evento do servidor', body: text, route: null }).catch(() => {});
          }
        }
      }
      if (changed) {
        for (const k of Object.keys(reminded)) if (now - reminded[k] > 3 * 24 * 3600 * 1000) delete reminded[k];
        try {
          localStorage.setItem('pc.eventReminders', JSON.stringify(reminded));
        } catch {}
      }
    };
    check();
    const t = window.setInterval(check, 30000);
    return () => window.clearInterval(t);
  }, [serverEvents, user?.id, showToast]);

  // Ctrl+F abre a busca no servidor
  useEffect(() => {
    if (!api) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && navAreaRef.current === 'server') {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  const activeTypingUsers = useMemo(() => {
    if (navArea !== 'server' || !activeTextChannel) return [];
    return Object.entries(typingByChannel[activeTextChannel.id] || {})
      .filter(([uid]) => uid !== user?.id)
      .map(([, name]) => name);
  }, [navArea, typingByChannel, activeTextChannel, user?.id]);

  // Always resolve freshest User object for Popout & Full Profile Modal (including LAN peers)
  const findResolvedUserById = useCallback(
    (uid: string): User | null => {
      if (user && uid === user.id) return user;
      const srv = members.find((m) => m.id === uid);
      if (srv) return srv;
      const lp = lanPeers.find((p) => p.peerId === uid);
      if (!lp) return null;
      return {
        id: lp.peerId,
        username: lp.username,
        displayName: lp.displayName,
        avatarColor: lp.avatarColor || '#5865F2',
        avatarUrl: lp.avatarUrl || null,
        bio: lp.bio,
        customStatusEmoji: lp.customStatusEmoji,
        customStatusText: lp.customStatusText,
        currentActivity: lp.currentActivity || null,
        online: true,
        statusType: 'online',
        role: 'member',
        roleIds: [],
        createdAt: Date.now(),
      };
    },
    [user, members, lanPeers]
  );

  const resolvedPopoutUser = useMemo(() => {
    if (!profilePopout) return null;
    return findResolvedUserById(profilePopout.userId);
  }, [profilePopout, findResolvedUserById]);

  const resolvedModalUser = useMemo(() => {
    if (!profileModal) return null;
    return findResolvedUserById(profileModal.userId);
  }, [profileModal, findResolvedUserById]);

  const resolvedContextUser = useMemo(() => {
    if (!contextMenuTarget) return null;
    const fresh = members.find((m) => m.id === contextMenuTarget.user.id);
    return fresh ? { ...contextMenuTarget, user: fresh } : contextMenuTarget;
  }, [contextMenuTarget, members]);

  // Authentic slim Discord Windows titlebar (24px)
  const renderTitlebar = () =>
    isElectron ? (
      <div className="h-6 shrink-0 bg-[#1e1f22] pc-titlebar px-3 flex items-center justify-between select-none app-drag">
        <div className="flex items-center gap-2">
          <WaverLogo className="w-3.5 h-3.5 shrink-0" />
          <span className="text-[11px] font-bold tracking-widest uppercase text-[#949ba4]">Waver</span>
          {appMode === 'host' && hostStatus?.running && (
            <span className="text-[10px] font-bold text-[#23a55a] bg-[#23a55a]/15 px-1.5 rounded">
              HOST ONLINE
            </span>
          )}
          {rcControlledByPeer && (
            <span className="text-[10px] font-bold text-white bg-[#da373c] px-1.5 rounded animate-pulse">
              ANYDESK ATIVO • Ctrl+Shift+Esc
            </span>
          )}
        </div>
        <div className="flex items-center app-no-drag -mr-3">
          <button
            type="button"
            onClick={() => window.electronAPI?.windowMinimize()}
            className="w-8 h-6 flex items-center justify-center text-[#b5bac1] hover:bg-[#35373c] hover:text-white cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => window.electronAPI?.windowMaximize()}
            className="w-8 h-6 flex items-center justify-center text-[#b5bac1] hover:bg-[#35373c] hover:text-white cursor-pointer"
          >
            <Square className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => window.electronAPI?.windowClose()}
            className="w-8 h-6 flex items-center justify-center text-[#b5bac1] hover:bg-[#da373c] hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    ) : null;

  if (booting) {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#1e1f22]">
        {renderTitlebar()}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#b5bac1]">
          <Loader2 className="w-8 h-8 animate-spin text-[#5865f2]" />
          <span className="text-sm font-medium">Iniciando Waver...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#1e1f22]">
        {renderTitlebar()}
        <div className="flex-1 min-h-0">
          <LoginScreen
            initialServerUrl={serverUrl}
            lanServers={lanServers}
            onScanLan={handleScanLan}
            onLocalEnter={handleLocalEnter}
            onAuthenticated={handleAuthenticated}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#1e1f22] overflow-hidden relative">
      {themeConfig.wallpaperUrl && (
        <div
          className="fixed inset-0 pc-wallpaper-bg pointer-events-none z-0"
          style={{ filter: themeConfig.wallpaperBlurPx ? `blur(${themeConfig.wallpaperBlurPx}px)` : undefined }}
        />
      )}
      <div className="relative z-10 flex-1 flex flex-col min-h-0 overflow-hidden">
      {renderTitlebar()}

      {/* Baixando atualização: cartão pequeno com barra, o app continua usável */}
      {(githubUpdate?.status === 'downloading' || githubUpdate?.status === 'paused') && githubUpdate.version && (
        <div className="fixed bottom-4 right-4 z-[60] w-72 rounded-lg bg-[#111214]/95 border border-white/10 shadow-2xl px-3.5 py-2.5 text-xs text-[#dbdee1] pointer-events-none">
          <div className="flex items-center gap-2 mb-1.5">
            <Download className="w-3.5 h-3.5 text-[#23a55a] shrink-0" />
            <span className="font-semibold text-white truncate">
              {githubUpdate.status === 'paused' ? 'Atualização pausada (em chamada)' : `Atualizando para v${githubUpdate.version}`}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[#23a55a] transition-[width] duration-300"
              style={{
                width: `${githubUpdate.total ? Math.min(100, Math.round(((githubUpdate.loaded || 0) / githubUpdate.total) * 100)) : 5}%`,
              }}
            />
          </div>
          <div className="mt-1 text-[10px] text-[#949ba4]">
            {formatBytes(githubUpdate.loaded || 0)}
            {githubUpdate.total ? ` de ${formatBytes(githubUpdate.total)}` : ''}
            {githubUpdate.mode === 'patch' ? ' · só o que mudou' : ''}
          </div>
        </div>
      )}

      {/* Automatic LAN Update Available Banner */}
      {githubUpdate?.status === 'ready' && githubUpdate.version && !githubUpdateDismissed && (
        <div className="bg-[#248046] text-white text-sm font-medium px-4 py-1.5 flex items-center justify-center gap-3 shrink-0">
          <Download className="w-4 h-4 shrink-0" />
          <span className="truncate" title={githubUpdate.notes || undefined}>
            {githubInstalling
              ? githubUpdate.mode === 'patch'
                ? githubUpdate.renderOnly
                  ? 'Aplicando…'
                  : 'Reabrindo o Waver na versão nova…'
                : 'Instalando a atualização… o Waver vai reabrir sozinho.'
              : githubUpdate.mode === 'patch'
              ? `Waver v${githubUpdate.version} pronto (${formatBytes(githubUpdate.bytes || 0)} baixados, conferido). ${
                  githubUpdate.renderOnly ? 'Aplica em 1 segundo, sem reiniciar.' : 'Reabre em poucos segundos, sem instalador.'
                }`
              : `Waver v${githubUpdate.version} já foi baixado e conferido. Atualize quando quiser.`}
          </span>
          {!githubInstalling && (
            <>
              <button
                type="button"
                onClick={handleInstallGithubUpdate}
                className="px-3 py-0.5 rounded-full bg-white text-[#111214] font-bold hover:bg-white/90 cursor-pointer shrink-0"
              >
                {githubUpdate.mode === 'patch' && githubUpdate.renderOnly ? 'Aplicar agora' : 'Reiniciar e atualizar'}
              </button>
              <button
                type="button"
                title="Depois"
                onClick={() => setGithubUpdateDismissed(true)}
                className="p-0.5 text-white/80 hover:text-white cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {updateKindAvailable !== 'none' &&
        !updateBannerDismissed &&
        updateManifest &&
        !(
          githubUpdate?.status === 'ready' &&
          githubUpdate.version &&
          compareVersions(githubUpdate.version, updateManifest.version) >= 0
        ) && (
        <div className="bg-[#5865f2] text-white text-sm font-medium px-4 py-1.5 flex items-center justify-center gap-3 shrink-0">
          <Download className="w-4 h-4 shrink-0" />
          <span>
            {updateApplying && updateProgress
              ? `Baixando atualização (${updateProgress.percent}% • ${updateProgress.speedMBps} MB/s)...`
              : updateApplying
              ? 'Aplicando atualização automática...'
              : `Nova atualização v${updateManifest.version} disponível no Host (${
                  updateKindAvailable === 'ui' ? 'Interface rápida' : 'Instalador completo sem perder dados'
                })!`}
          </span>
          {!updateApplying && (
            <>
              <button
                type="button"
                onClick={handleApplyUpdate}
                className="px-3 py-0.5 rounded-full bg-white text-[#111214] font-bold hover:bg-white/90 cursor-pointer"
              >
                Atualizar Agora
              </button>
              <button
                type="button"
                onClick={() => setUpdateBannerDismissed(true)}
                className="p-0.5 text-white/80 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Muted Mic Speaking Warning Banner (Discord style!) */}
      {mutedTalkAlert && activeVoiceChannelId && (
        <div className="fixed bottom-16 left-64 z-[115] bg-[#2b2d31] border-2 border-[#f0b232] text-white px-3.5 py-2 rounded-lg shadow-2xl flex items-center gap-2.5 text-xs toast-enter">
          <MicOff className="w-4 h-4 text-[#f0b232] shrink-0" />
          <span>Seu microfone está <strong>mutado</strong>!</span>
          <button
            type="button"
            onClick={handleToggleMute}
            className="px-2.5 py-1 rounded-lg bg-[#23a55a] hover:bg-[#1a8245] text-white font-bold cursor-pointer"
          >
            Desmutar
          </button>
        </div>
      )}

      {Boolean(token) && !socketConnected && (
        <div className="bg-[#f0b232] text-[#111214] text-xs font-bold px-4 py-1 flex items-center justify-center gap-2 shrink-0">
          <WifiOff className="w-3.5 h-3.5" />
          Reconectando ao servidor ({serverUrl})...
        </div>
      )}

      {/* Incoming Private 1-on-1 Call Banner (Server or Serverless LAN P2P) */}
      {incomingCall && (
        <div className="fixed top-9 left-1/2 -translate-x-1/2 z-[110] bg-[#111214] border-2 border-[#23a55a] rounded-lg shadow-[0_16px_48px_rgba(0,0,0,0.85)] px-5 py-3.5 flex items-center gap-4 animate-fade-up">
          <div className="relative">
            <Avatar
              name={incomingCall.fromUser.displayName}
              avatarUrl={incomingCall.fromUser.avatarUrl}
              color={incomingCall.fromUser.avatarColor}
              decoration={incomingCall.fromUser.avatarDecoration}
              serverUrl={incomingCall.isLanP2p ? incomingCall.peerUrl || serverUrl : serverUrl}
              size="lg"
              online={true}
              statusType={incomingCall.fromUser.statusType}
              borderBg="#111214"
            />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#4ade80]">
              {incomingCall.isGroup
                ? `Chamada em Grupo${incomingCall.groupName ? ` • ${incomingCall.groupName}` : ''}`
                : incomingCall.isLanP2p
                ? 'Chamada Privada LAN P2P Recebida'
                : 'Chamada Privada Recebida'}
            </div>
            <div className="text-base font-bold text-white">{incomingCall.fromUser.displayName}</div>
          </div>
          <div className="flex items-center gap-2 ml-2">
            <button
              type="button"
              onClick={async () => {
                const call = incomingCall;
                setIncomingCall(null);
                setNavArea('dms');
                if (call.dmRoomId.startsWith('group:')) {
                  setActiveGroupId(call.dmRoomId.slice(6));
                  setActiveDmUserId(null);
                } else {
                  setActiveGroupId(null);
                  setActiveDmUserId(call.fromUser.id);
                }
                if (call.isLanP2p && call.callServerUrl) {
                  await window.electronAPI
                    ?.lanPeersCallRespond?.({
                      toPeerId: call.fromUser.id,
                      peerUrl: call.peerUrl,
                      dmRoomId: call.dmRoomId,
                      accepted: true,
                    })
                    .catch(() => {});
                  await connectAndJoinLanCall(call.callServerUrl, call.dmRoomId);
                } else {
                  await handleJoinOrFocusVoiceChannel(call.dmRoomId);
                }
              }}
              className="px-4 py-2 rounded-full bg-[#23a55a] hover:bg-[#1a8245] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg"
            >
              <Phone className="w-4 h-4" />
              Atender
            </button>
            <button
              type="button"
              onClick={() => {
                if (incomingCall.isLanP2p) {
                  window.electronAPI
                    ?.lanPeersCallRespond?.({
                      toPeerId: incomingCall.fromUser.id,
                      peerUrl: incomingCall.peerUrl,
                      dmRoomId: incomingCall.dmRoomId,
                      accepted: false,
                    })
                    .catch(() => {});
                } else {
                  socketRef.current?.emit('dm:call-decline', {
                    toUserId: incomingCall.fromUser.id,
                    dmRoomId: incomingCall.dmRoomId,
                  });
                }
                setIncomingCall(null);
              }}
              className="px-4 py-2 rounded-full bg-[#da373c] hover:bg-[#b52a2f] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              Recusar
            </button>
          </div>
        </div>
      )}

      {/* AnyDesk Remote Control Consent Modal */}
      {rcPendingPrompt && (
        <div className="fixed inset-0 z-[120] bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#2b2d31] border border-[#5865f2] rounded-lg shadow-2xl overflow-hidden animate-fade-up">
            <div className="px-5 py-4 bg-[#1e1f22] border-b border-[#35373c] flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#5865f2]/20 flex items-center justify-center text-[#a5b4fc]">
                <MonitorCog className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {rcPendingPrompt.kind === 'request'
                    ? 'Pedido de Controle Remoto (AnyDesk)'
                    : 'Convite de Controle Remoto (AnyDesk)'}
                </h3>
                <p className="text-xs text-[#949ba4]">Permissão explícita necessária</p>
              </div>
            </div>

            <div className="p-5 space-y-3 text-sm text-[#dbdee1]">
              {rcPendingPrompt.kind === 'request' ? (
                <>
                  <p>
                    <strong className="text-white">{rcPendingPrompt.fromName}</strong> pediu permissão para controlar o{' '}
                    <strong className="text-[#4ade80]">mouse e teclado do seu computador</strong> enquanto você
                    compartilha a tela.
                  </p>
                  <div className="bg-[#da373c]/15 border border-[#da373c]/40 rounded-lg p-3 text-xs text-[#fca5a5] flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#f23f42]" />
                    <span>
                      Aceite apenas pessoas de confiança. Você pode revogar o acesso instantaneamente a qualquer momento
                      pelo botão vermelho ou pressionando <strong className="text-white">Ctrl+Shift+Esc</strong>.
                    </span>
                  </div>
                </>
              ) : (
                <p>
                  <strong className="text-white">{rcPendingPrompt.fromName}</strong> convidou você para controlar a tela
                  dele remotamente durante a transmissão.
                </p>
              )}
            </div>

            <div className="px-5 py-3.5 bg-[#232428] flex justify-end gap-2">
              <button
                type="button"
                onClick={handleDeclineRcPrompt}
                className="px-4 py-2 rounded-lg text-xs font-bold text-[#b5bac1] hover:text-white hover:bg-[#35373c] cursor-pointer"
              >
                Recusar
              </button>
              <button
                type="button"
                onClick={handleAcceptRcPrompt}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-[#23a55a] hover:bg-[#1a8245] text-white cursor-pointer"
              >
                {rcPendingPrompt.kind === 'request' ? 'Permitir Controle' : 'Aceitar e Controlar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[115] max-w-md bg-[#2b2d31] border text-white px-4 py-3 rounded-lg shadow-2xl flex items-start gap-2.5 toast-enter ${
            toast.kind === 'error' ? 'border-[#f23f42]' : 'border-[#23a55a]'
          }`}
        >
          {toast.kind === 'error' ? (
            <AlertCircle className="w-5 h-5 text-[#f23f42] shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-[#23a55a] shrink-0 mt-0.5" />
          )}
          <p className="text-xs leading-relaxed flex-1">{toast.message}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[#949ba4] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Persistent Voice & Screen Audio Bridge (direct WebRTC audio + 200% boost + local mutes/blocks!) */}
      {activeVoiceChannelId && (
        <VoiceAudioBridge
          remotePeers={remotePeers}
          participants={activeVoiceParticipants}
          peerVolumes={peerVolumes}
          masterOutputVolume={audioSettings.outputVolume ?? 1}
          localMutedUserIds={localMutedUserIds}
          blockedUserIds={blockedUserIds}
          notWatching={notWatching}
          streamAudioVolume={streamAudioVolume}
          deafened={deafened || Boolean(user.serverDeafened)}
          outputDeviceId={audioSettings.outputDeviceId}
        />
      )}

      {/* Authentic Discord 3-Column Layout: [72px Rail] [240px Sidebar] [Main Content] */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <ServerRail
          server={server}
          appMode={appMode}
          hostStatus={hostStatus}
          serverUrl={serverUrl}
          navArea={navArea}
          unreadDmCount={totalUnreadDms}
          inVoice={Boolean(activeVoiceChannelId)}
          onSelectDms={() => {
            setNavArea('dms');
            setViewMode('chat');
            if (!activeDmUserId) {
              const firstOther = members.find((m) => m.id !== user.id);
              if (firstOther) setActiveDmUserId(firstOther.id);
              else if (lanPeers.length > 0) setActiveDmUserId(lanPeers[0].peerId);
            }
          }}
          onSelectServer={() => {
            if (!server) {
              setShowServerDirectory(true);
              return;
            }
            setNavArea('server');
            setViewMode(activeVoiceChannelId && !isInDmVoice && viewMode === 'voice' ? 'voice' : 'chat');
          }}
          onOpenServerDirectory={() => {
            handleScanLan();
            setShowServerDirectory(true);
          }}
          onServerContextMenu={(e) => setServerContextMenu({ x: e.clientX, y: e.clientY })}
          onOpen3DViewer={() => {
            setModel3DTarget(null);
            setShow3DViewer(true);
          }}
          onOpenSettings={() => setSettingsTab('audio')}
          savedServers={savedServers}
          onSwitchServer={(entry) => handleSwitchSavedServer(entry)}
          onRemoveSavedServer={(entry) => {
            setSavedServers((prev) => removeSavedServer(prev, entry.serverUrl));
            if (autoReconnectUrl && serverKey(autoReconnectUrl) === serverKey(entry.serverUrl)) setAutoReconnectUrl(null);
          }}
        />

        <div className="flex-1 flex min-w-0 min-h-0 rounded-tl-lg overflow-hidden">
          <Sidebar
            server={server}
            serverUrl={serverUrl}
            user={user}
            members={members}
            lanPeers={lanPeers}
            appMode={appMode}
            navArea={navArea}
            activeDmUserId={activeDmUserId}
            unreadDmByUser={unreadDmByUser}
            dmGroups={dmGroups}
            activeGroupId={activeGroupId}
            unreadByGroup={unreadByGroup}
            hostStatus={hostStatus}
            channels={channels}
            categories={categories}
            permissions={serverPermissions}
            favoriteChannelIds={favoriteChannelIds}
            pinnedChannelIds={pinnedChannelIds}
            mutedChannelIds={mutedChannelIds}
            hideMutedChannels={hideMutedChannels}
            activeTextChannelId={activeTextChannel?.id || ''}
            activeVoiceChannelId={activeVoiceChannelId}
            activeVoiceLabel={activeVoiceLabel}
            viewMode={viewMode}
            voiceRooms={voiceRooms}
            speakingSocketIds={speakingSocketIds}
            soundboardActiveUserIds={soundboardActiveUserIds}
            selfSocketId={selfSocketId}
            muted={muted}
            deafened={deafened}
            cameraOn={Boolean(localCamStream)}
            screenSharing={Boolean(localScreenStream)}
            audioSettings={audioSettings}
            onUpdateAudioSettings={setAudioSettings}
            onSelectTextChannel={(id) => {
              setNavArea('server');
              setActiveTextChannelId(id);
              setViewMode('chat');
            }}
            onSelectDmUser={(uid) => {
              setNavArea('dms');
              setActiveGroupId(null);
              setActiveDmUserId(uid);
              setViewMode('chat');
            }}
            onSelectGroup={(gid) => {
              setNavArea('dms');
              setActiveDmUserId(null);
              setActiveGroupId(gid);
              setViewMode('chat');
            }}
            onOpenCreateGroup={() => setGroupModal({ mode: 'create' })}
            onOpenGroupSettings={(g) => setGroupModal({ mode: 'settings', group: g })}
            onStartGroupCall={handleStartGroupCall}
            onStartPrivateCall={handleStartPrivateCall}
            onScanLanPeers={handleScanLan}
            onJoinOrFocusVoiceChannel={handleJoinOrFocusVoiceChannel}
            remoteScreenStreams={remoteScreenStreams}
            onWatchStream={(channelId, socketId) => {
              handleJoinOrFocusVoiceChannel(channelId);
              setWatchingStream(socketId, true);
              setSpotlightRequest({ key: `screen:${socketId}`, seq: Date.now() });
            }}
            nowPlayingSlot={
              <NowPlayingBar
                musicState={musicState}
                videoState={videoState}
                onOpenMusic={() => {
                  if (activeVoiceChannelId) handleJoinOrFocusVoiceChannel(activeVoiceChannelId);
                  setVoiceDrawer('music');
                }}
                onOpenVideo={() => {
                  if (activeVoiceChannelId) handleJoinOrFocusVoiceChannel(activeVoiceChannelId);
                }}
                onToggleMusic={() => {
                  const sock = p2pCallSocketRef.current || socketRef.current;
                  if (musicState?.isPlaying) {
                    const pos = audioEngine.getMusicPosition();
                    audioEngine.pauseOptimistic();
                    sock?.emit('music:pause', { channelId: activeVoiceChannelId, positionSec: pos });
                  } else {
                    audioEngine.playOptimistic();
                    sock?.emit('music:play', { channelId: activeVoiceChannelId });
                  }
                }}
                onNextMusic={() =>
                  (p2pCallSocketRef.current || socketRef.current)?.emit('music:next', { channelId: activeVoiceChannelId })
                }
              />
            }
            onLeaveVoice={handleLeaveVoice}
            onLeaveServer={handleLeaveServer}
            onCreateChannel={(type, categoryId) => setCreateChannelMeta({ type, categoryId })}
            onReorderChannels={(layout) => {
              api?.reorderChannels(layout).catch((err: Error) => showError(err.message || 'Não foi possível mover o canal.'));
            }}
            onReorderCategories={(ids) => {
              api?.reorderCategories(ids).catch((err: Error) => showError(err.message || 'Não foi possível mover a categoria.'));
            }}
            onMoveVoiceMember={(userId, channelId) => {
              api
                ?.moderateVoice({ targetUserId: userId, moveToChannelId: channelId })
                .catch((err: Error) => showError(err.message || 'Não foi possível mover a pessoa.'));
            }}
            onEditChannel={(ch) => setEditingChannel(ch)}
            onDeleteChannel={handleDeleteChannel}
            onChannelContextMenu={(channel, e) => setChannelContextMenu({ channel, x: e.clientX, y: e.clientY })}
            onServerContextMenu={(e) => setServerContextMenu({ x: e.clientX, y: e.clientY })}
            onOpenServerTrello={() => handleOpenTrello('server', server?.name || 'Servidor')}
            onToggleMute={handleToggleMute}
            onToggleDeafen={handleToggleDeafen}
            onToggleCamera={handleToggleCamera}
            onOpenScreenShare={() => {
              if (localScreenStream) handleStopScreenShare();
              else setShowScreenModal(true);
            }}
            onOpenVoiceDrawer={(tab) => {
              setViewMode('voice');
              setVoiceDrawer((cur) => (cur === tab ? 'none' : tab));
            }}
            onOpenModeSwitcher={() => setShowHostModal(true)}
            onOpenServerDirectory={() => {
              handleScanLan();
              setShowServerDirectory(true);
            }}
            onOpenSelfProfilePopout={(e) => handleOpenUserProfilePopout(user, e)}
            onUserClick={handleOpenUserProfilePopout}
            onUserContextMenu={handleOpenUserContextMenu}
            onOpenSettings={(tab) => setSettingsTab(tab || 'audio')}
          />

          {/* Main Area: Voice Stage OR Private Group/DM Chat OR Server Text Channel + Member List */}
          {/* A call fica montada mesmo com o chat aberto: o vídeo do "assistir junto" não para nem fica preto */}
          {activeVoiceChannelId && (
            <VoiceStage
              backgrounded={viewMode !== 'voice'}
              topBanner={
                activeVoiceChannel?.isStage ? (
                  <StageBar
                    participants={voiceRooms[activeVoiceChannelId] || []}
                    selfSocketId={selfSocketId}
                    isModerator={isStageMod}
                    onRaiseHand={(raised) => emitAck('stage:raise-hand', { raised }).catch((err: Error) => showError(err.message))}
                    onSetSpeaker={(sid, speaker) =>
                      emitAck('stage:set-speaker', { socketId: sid, speaker }).catch((err: Error) => showError(err.message))
                    }
                  />
                ) : undefined
              }
              extraControls={
                <>
                  <button
                    type="button"
                    onClick={handleToggleRecording}
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition cursor-pointer ${
                      recordingSince ? 'bg-[#f23f42] text-white animate-pulse' : 'bg-[#313338] hover:bg-[#404249] text-white'
                    }`}
                    title={recordingSince ? 'Parar e salvar a gravação' : 'Gravar a chamada'}
                  >
                    <CircleDot className="w-5 h-5" />
                  </button>
                  {clipsActive && (
                    <button
                      type="button"
                      onClick={() => clipSaveRef.current()}
                      className="w-11 h-11 rounded-full flex items-center justify-center transition cursor-pointer bg-[#313338] hover:bg-[#404249] text-white"
                      title={`Salvar clipe (${prettyAccelerator(desktopPrefs.shortcuts.clip) || 'sem atalho'})`}
                    >
                      <Scissors className="w-5 h-5" />
                    </button>
                  )}
                </>
              }
              api={api}
              socket={p2pCallSocketRef.current || socketRef.current}
              channelId={activeVoiceChannelId}
              serverUrl={server ? serverUrl : localPeerInfo?.p2pUrl || serverUrl}
              user={user}
              members={members}
              channelName={activeVoiceLabel}
              permissions={activeVoicePermissions}
              isPrivateCall={isInDmVoice}
              onOpenTrello={() =>
                handleOpenTrello(
                  isInDmVoice ? activeVoiceChannelId : 'server',
                  isInDmVoice ? activeVoiceLabel : server?.name || 'Servidor'
                )
              }
              onInviteToGroupCall={() =>
                setGroupModal({
                  mode: activeGroup ? 'settings' : 'create',
                  group: activeGroup,
                  preselectedIds: activeDmUserId ? [activeDmUserId] : [],
                })
              }
              participants={activeVoiceParticipants}
              selfSocketId={selfSocketId}
              remotePeers={remotePeers}
              spotlightRequest={spotlightRequest}
              notWatching={notWatching}
              onSetWatching={setWatchingStream}
              localCamStream={localCamStream}
              localScreenStream={localScreenStream}
              localSpeaking={localSpeaking}
              localScreenStats={localScreenStats}
              localScreenLabel={localScreenLabel}
              muted={muted || Boolean(user.serverMuted)}
              deafened={deafened || Boolean(user.serverDeafened)}
              hasLocalMic={hasLocalMic}
              onReconnectAudio={() => {
                rtcRef.current?.acquireMicrophone().catch(() => {});
                rtcRef.current?.reconnectAllPeers();
              }}
              peerVolumes={peerVolumes}
              streamAudioVolume={streamAudioVolume}
              onPeerVolumeChange={(socketId, vol) => {
                const participant = activeVoiceParticipants.find((p) => p.socketId === socketId);
                setPeerVolumes((prev) => ({
                  ...prev,
                  [socketId]: vol,
                  ...(participant ? { [participant.userId]: vol } : {}),
                }));
              }}
              onStreamAudioVolumeChange={setStreamAudioVolume}
              clockOffsetMs={clockOffsetMs}
              rcControllingPeer={rcControllingPeer}
              rcRemoteHostBusy={rcRemoteHostBusy}
              rcLocalHostBusy={rcLocalHostBusy}
              rcControlledByPeer={rcControlledByPeer}
              rcControlledPeers={rcControlledPeers}
              vigemStatus={vigemStatus}
              connectedGamepads={connectedGamepads}
              onUpdateRcPermissions={handleUpdatePeerRcPermissions}
              onRetryViGEm={() => {
                window.electronAPI?.rcRetryViGEm?.().then((st) => st && setVigemStatus(st.vigemStatus)).catch(() => {});
              }}
              onInstallViGEmBus={() => {
                window.electronAPI?.rcInstallViGEmBus?.().then((res) => {
                  if (res?.ok) showToast('Instalador do ViGEmBus aberto! Após instalar, clique em Atualizar Controle.', 'info');
                  else showError(res?.error || 'Não foi possível abrir o instalador ViGEmBus.');
                }).catch(() => {});
              }}
              onInviteRemoteControl={handleInviteRemoteControl}
              onRequestRemoteControl={handleRequestRemoteControl}
              onRevokeRemoteControl={(targetSocketId) => {
                if (!targetSocketId) {
                  revokeRemoteControlInternal(true);
                  return;
                }
                const activeSock = p2pCallSocketRef.current || socketRef.current;
                activeSock?.emit('rc:revoke', { targetSocketId });
                const remaining = rcControlledPeersRef.current.filter((p) => p.socketId !== targetSocketId);
                setRcControlledPeers(remaining);
                if (remaining.length === 0) {
                  window.electronAPI?.rcDisable().catch(() => {});
                  setRcControlledByPeer(null);
                } else if (rcControlledByPeerRef.current?.socketId === targetSocketId) {
                  setRcControlledByPeer({ socketId: remaining[0].socketId, name: remaining[0].name });
                }
                if (rcControllingPeerRef.current?.socketId === targetSocketId) {
                  setRcControllingPeer(null);
                }
              }}
              onSendRemoteInput={(targetSocketId: string, evt: RemoteInputEvent) => {
                rtcRef.current?.sendRemoteInput(targetSocketId, evt);
              }}
              onUserClick={handleOpenUserProfilePopout}
              onUserContextMenu={(u, e, meta) =>
                handleOpenUserContextMenu(u, e, { ...meta, inVoiceChannelId: activeVoiceChannelId })
              }
              sounds={sounds}
              soundToasts={soundToasts}
              soundboardActiveUserIds={soundboardActiveUserIds}
              soundboardVolume={audioSettings.soundboardVolume}
              musicState={musicState}
              musicCurrentSec={musicCurrentSec}
              musicDurationSec={musicDurationSec}
              musicVolume={audioSettings.musicVolume}
              videoState={videoState}
              videoVolume={videoVolume}
              activeDrawer={voiceDrawer}
              onSetDrawer={setVoiceDrawer}
              onToggleMute={handleToggleMute}
              onToggleDeafen={handleToggleDeafen}
              onToggleCamera={handleToggleCamera}
              onOpenScreenShare={() => setShowScreenModal(true)}
              onStopScreenShare={handleStopScreenShare}
              onLeaveVoice={handleLeaveVoice}
              onOpenChat={() => setViewMode('chat')}
              onPlaySound={(soundId) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('soundboard:play', {
                  channelId: activeVoiceChannelId,
                  soundId,
                })
              }
              onStopAllSounds={() => audioEngine.stopAllSounds()}
              onSoundboardVolumeChange={(v) => setAudioSettings((s) => ({ ...s, soundboardVolume: v }))}
              onMusicVolumeChange={(v) => setAudioSettings((s) => ({ ...s, musicVolume: v }))}
              onMusicAddUrl={handleAddMusicUrlToVoice}
              onMusicPlay={(index) => {
                audioEngine.playOptimistic();
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:play', {
                  channelId: activeVoiceChannelId,
                  index,
                });
              }}
              onMusicPause={() => {
                const pos = audioEngine.getMusicPosition();
                audioEngine.pauseOptimistic();
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:pause', {
                  channelId: activeVoiceChannelId,
                  positionSec: pos,
                });
              }}
              onMusicSeek={(sec) => {
                audioEngine.seekOptimistic(sec);
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:seek', {
                  channelId: activeVoiceChannelId,
                  positionSec: sec,
                });
              }}
              onMusicNext={() =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:next', { channelId: activeVoiceChannelId })
              }
              onMusicPrev={() =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:prev', { channelId: activeVoiceChannelId })
              }
              onMusicRemove={(index) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:remove', {
                  channelId: activeVoiceChannelId,
                  index,
                })
              }
              onMusicRemoveBlock={(playlistBlockId) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:remove-block', {
                  channelId: activeVoiceChannelId,
                  playlistBlockId,
                })
              }
              onMusicClear={() =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:clear', { channelId: activeVoiceChannelId })
              }
              onMusicLoop={(loopMode) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('music:loop', {
                  channelId: activeVoiceChannelId,
                  loopMode,
                })
              }
              onVideoVolumeChange={setVideoVolume}
              onVideoAddUrl={handleAddVideoUrlToVoice}
              onVideoPlay={(index) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:play', {
                  channelId: activeVoiceChannelId,
                  index,
                })
              }
              onVideoPause={() =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:pause', { channelId: activeVoiceChannelId })
              }
              onVideoSeek={(sec) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:seek', {
                  channelId: activeVoiceChannelId,
                  positionSec: sec,
                })
              }
              onVideoRate={(rate) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:rate', { channelId: activeVoiceChannelId, rate })
              }
              onVideoNext={() =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:next', { channelId: activeVoiceChannelId })
              }
              onVideoPrev={() =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:prev', { channelId: activeVoiceChannelId })
              }
              onVideoEnded={(queueId, durationSec) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:ended', {
                  channelId: activeVoiceChannelId,
                  queueId,
                  durationSec,
                })
              }
              onVideoRemove={(index) =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:remove', {
                  channelId: activeVoiceChannelId,
                  index,
                })
              }
              onVideoClear={() =>
                (p2pCallSocketRef.current || socketRef.current)?.emit('video:clear', { channelId: activeVoiceChannelId })
              }
            />
          )}
          {viewMode === 'voice' && activeVoiceChannelId ? null : navArea === 'dms' || !server ? (
            activeGroup ? (
              <ChatArea
                api={api}
                serverUrl={
                  activeGroup.isLanP2p || !server
                    ? activeGroup.hostP2pUrl || localPeerInfo?.p2pUrl || serverUrl
                    : serverUrl
                }
                user={user}
                members={members}
                dmGroup={activeGroup}
                isPureLanDm={Boolean(activeGroup.isLanP2p || !server)}
                onUploadPendingAttachments={
                  activeGroup.isLanP2p || !server ? handlePrepareLanAttachments : undefined
                }
                messages={groupMessagesById[activeGroup.id] || []}
                typingUsers={[]}
                savedGifs={savedGifs}
                blockedUserIds={blockedUserIds}
                mentionRequest={mentionRequest}
                incomingFilesRequest={incomingFilesRequest}
                onIncomingFilesConsumed={() => setIncomingFilesRequest(null)}
                activeVoiceLabel={activeVoiceChannelId ? activeVoiceLabel : null}
                showMembers={false}
                onToggleMembers={() => {}}
                onReturnToVoice={() => setViewMode('voice')}
                onStartGroupCall={handleStartGroupCall}
                onOpenGroupSettings={(g) => setGroupModal({ mode: 'settings', group: g })}
                onOpenTrello={() => handleOpenTrello(`group:${activeGroup.id}`, activeGroup.name)}
                onPinMessage={handlePinMessage}
                onOpen3DModel={(t) => {
                  setModel3DTarget(t);
                  setShow3DViewer(true);
                }}
                onSendVideoUrlToVoice={(url) => {
                  handleAddVideoUrlToVoice(url);
                }}
                onSendMusicUrlToVoice={(url) => {
                  handleAddMusicUrlToVoice(url);
                }}
                onUserClick={handleOpenUserProfilePopout}
                onUserContextMenu={handleOpenUserContextMenu}
                onSendMessage={handleSendMessage}
              />
            ) : activeDmPeer ? (
              <ChatArea
                api={api}
                serverUrl={
                  activeDmIsLanPeer
                    ? lanPeers.find((p) => p.peerId === activeDmPeer.id)?.p2pUrl ||
                      localPeerInfo?.p2pUrl ||
                      serverUrl
                    : !server
                    ? localPeerInfo?.p2pUrl || serverUrl
                    : serverUrl
                }
                user={user}
                members={members}
                dmPeer={activeDmPeer}
                isPureLanDm={activeDmIsLanPeer}
                onUploadPendingAttachments={activeDmIsLanPeer ? handlePrepareLanAttachments : undefined}
                messages={dmMessagesByPair[activeDmPairKey] || []}
                typingUsers={[]}
                savedGifs={savedGifs}
                blockedUserIds={blockedUserIds}
                mentionRequest={mentionRequest}
                incomingFilesRequest={incomingFilesRequest}
                onIncomingFilesConsumed={() => setIncomingFilesRequest(null)}
                activeVoiceLabel={activeVoiceChannelId ? activeVoiceLabel : null}
                showMembers={false}
                onToggleMembers={() => {}}
                onReturnToVoice={() => setViewMode('voice')}
                onStartPrivateCall={handleStartPrivateCall}
                onCreateGroupFromDm={(peer) => setGroupModal({ mode: 'create', preselectedIds: [peer.id] })}
                onOpenTrello={() => handleOpenTrello(`dm:${activeDmPairKey}`, activeDmPeer.displayName)}
                onPinMessage={handlePinMessage}
                onOpen3DModel={(t) => {
                  setModel3DTarget(t);
                  setShow3DViewer(true);
                }}
                onSendVideoUrlToVoice={(url) => {
                  handleAddVideoUrlToVoice(url);
                }}
                onSendMusicUrlToVoice={(url) => {
                  handleAddMusicUrlToVoice(url);
                }}
                onUserClick={handleOpenUserProfilePopout}
                onUserContextMenu={handleOpenUserContextMenu}
                onSendMessage={handleSendMessage}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center bg-[#313338] pc-chat text-[#949ba4] gap-3 p-6 text-center">
                <p className="text-base font-bold text-white">Mensagens Diretas Privadas (LAN P2P)</p>
                <p className="text-xs max-w-md leading-relaxed">
                  Converse e faça chamadas de voz/tela diretas na rede local com amigos encontrados na barra lateral, ou
                  clique no botão verde <strong>+</strong> à esquerda para criar ou entrar em um servidor!
                </p>
                <button
                  type="button"
                  onClick={() => {
                    handleScanLan();
                    setShowServerDirectory(true);
                  }}
                  className="mt-1 px-4 py-2 rounded-lg bg-[#23a55a] hover:bg-[#1a8245] text-white text-xs font-bold cursor-pointer"
                >
                  Criar ou Entrar em um Servidor
                </button>
              </div>
            )
          ) : activeTextChannel ? (
            <>
              <ChatArea
                api={api}
                serverUrl={serverUrl}
                user={user}
                members={members}
                channel={activeTextChannel}
                permissions={activeTextPermissions}
                onOpenTrello={() => handleOpenTrello('server', server?.name || 'Servidor')}
                messages={messagesByChannel[activeTextChannel.id] || []}
                typingUsers={activeTypingUsers}
                savedGifs={savedGifs}
                blockedUserIds={blockedUserIds}
                mentionRequest={mentionRequest}
                incomingFilesRequest={incomingFilesRequest}
                onIncomingFilesConsumed={() => setIncomingFilesRequest(null)}
                activeVoiceLabel={activeVoiceChannelId ? activeVoiceLabel : null}
                showMembers={showMembers}
                onToggleMembers={() => setShowMembers((v) => !v)}
                onReturnToVoice={() => setViewMode('voice')}
                onPinMessage={handlePinMessage}
                onOpen3DModel={(t) => {
                  setModel3DTarget(t);
                  setShow3DViewer(true);
                }}
                onSendVideoUrlToVoice={(url) => {
                  handleAddVideoUrlToVoice(url);
                }}
                onSendMusicUrlToVoice={(url) => {
                  handleAddMusicUrlToVoice(url);
                }}
                onUserClick={handleOpenUserProfilePopout}
                onUserContextMenu={handleOpenUserContextMenu}
                onSendMessage={handleSendMessage}
                onDeleteMessage={(msgId) => api?.deleteMessage(activeTextChannel.id, msgId).catch(() => {})}
                onReact={(mid, e) => handleReact(activeTextChannel.id, mid, e)}
                onVotePoll={(mid, ids) => handleVotePoll(activeTextChannel.id, mid, ids)}
                onClosePoll={(mid) => handleClosePoll(activeTextChannel.id, mid)}
                onOpenThread={(m) => handleOpenThread(activeTextChannel.id, m)}
                onCreatePoll={() => setPollComposerOpen(true)}
                onOpenSearch={api ? () => setShowSearch(true) : undefined}
                onOpenEvents={api ? () => setShowEvents(true) : undefined}
                upcomingEventsCount={upcomingEventsCount}
                jumpRequest={jumpRequest}
                onTyping={(isTyping) =>
                  socketRef.current?.emit('chat:typing', { channelId: activeTextChannel.id, isTyping })
                }
              />
              {threadView && threadView.channelId === activeTextChannel.id ? (
                <ThreadPanel
                  channelName={activeTextChannel.name}
                  parent={threadView.parent}
                  messages={threadView.messages}
                  loading={threadView.loading}
                  selfId={user.id}
                  members={members}
                  serverUrl={serverUrl}
                  canSend={activeTextPermissions.sendMessages !== false}
                  canManage={Boolean(activeTextPermissions.manageMessages) || user.role === 'host'}
                  onSend={handleSendThread}
                  onReact={(mid, e, inThread) => handleReact(threadView.channelId, mid, e, inThread ? threadView.parent.id : undefined)}
                  onDelete={(mid) =>
                    api?.deleteThreadMessage(threadView.channelId, threadView.parent.id, mid).catch((err: Error) => showError(err.message))
                  }
                  onClose={() => setThreadView(null)}
                />
              ) : (
                showMembers && (
                  <MemberList
                    members={members}
                    roles={roles}
                    voiceRooms={voiceRooms}
                    soundboardActiveUserIds={soundboardActiveUserIds}
                    serverUrl={serverUrl}
                    onMemberClick={handleOpenUserProfilePopout}
                    onMemberContextMenu={handleOpenUserContextMenu}
                  />
                )
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[#313338] text-[#949ba4]">
              Selecione um canal
            </div>
          )}
        </div>
      </div>

      {/* Right-click Discord User Context Menu (Strict DM vs Server scope!) */}
      {resolvedContextUser && (
        <UserContextMenu
          target={resolvedContextUser}
          selfUser={user}
          roles={roles}
          permissions={serverPermissions}
          voiceChannels={channels.filter((c) => c.type === 'voice')}
          contextScope={navArea === 'dms' ? 'dm' : 'server'}
          hasServer={Boolean(server)}
          userVolume={
            (resolvedContextUser.socketId ? peerVolumes[resolvedContextUser.socketId] : undefined) ??
            peerVolumes[resolvedContextUser.user.id] ??
            1
          }
          isLocallyMuted={localMutedUserIds.has(resolvedContextUser.user.id)}
          isBlocked={blockedUserIds.has(resolvedContextUser.user.id)}
          canInviteRemoteControl={Boolean(
            localScreenStream &&
              activeVoiceChannelId &&
              resolvedContextUser.socketId &&
              resolvedContextUser.inVoiceChannelId === activeVoiceChannelId &&
              resolvedContextUser.user.id !== user.id
          )}
          canRequestRemoteControl={Boolean(
            activeVoiceChannelId &&
              resolvedContextUser.socketId &&
              resolvedContextUser.inVoiceChannelId === activeVoiceChannelId &&
              resolvedContextUser.isSharingScreen &&
              resolvedContextUser.user.id !== user.id
          )}
          onVolumeChange={(val) => {
            setPeerVolumes((prev) => ({
              ...prev,
              [resolvedContextUser.user.id]: val,
              ...(resolvedContextUser.socketId ? { [resolvedContextUser.socketId]: val } : {}),
            }));
          }}
          onViewProfile={() => setProfileModal({ userId: resolvedContextUser.user.id, edit: false })}
          onMention={() => {
            setMentionRequest({ text: `@${resolvedContextUser.user.displayName} `, seq: Date.now() });
            setViewMode('chat');
          }}
          onOpenDm={() => handleOpenDmWithUser(resolvedContextUser.user)}
          onStartPrivateCall={() => handleStartPrivateCall(resolvedContextUser.user)}
          onToggleLocalMute={() => {
            setLocalMutedUserIds((prev) => {
              const next = new Set(prev);
              if (next.has(resolvedContextUser.user.id)) next.delete(resolvedContextUser.user.id);
              else next.add(resolvedContextUser.user.id);
              return next;
            });
          }}
          onToggleBlock={() => {
            setBlockedUserIds((prev) => {
              const next = new Set(prev);
              if (next.has(resolvedContextUser.user.id)) {
                next.delete(resolvedContextUser.user.id);
                showToast(`${resolvedContextUser.user.displayName} desbloqueado.`, 'info');
              } else {
                next.add(resolvedContextUser.user.id);
                showToast(`${resolvedContextUser.user.displayName} bloqueado localmente.`, 'info');
              }
              return next;
            });
          }}
          onCopyInvite={() => {
            const inviteAddr = hostStatus?.addresses?.[0]?.address || serverUrl;
            navigator.clipboard.writeText(inviteAddr).catch(() => {});
            showToast(`Endereço do servidor copiado: ${inviteAddr}`, 'info');
          }}
          onInviteRemoteControl={() => {
            if (resolvedContextUser.socketId) handleInviteRemoteControl(resolvedContextUser.socketId);
          }}
          onRequestRemoteControl={() => {
            if (resolvedContextUser.socketId) handleRequestRemoteControl(resolvedContextUser.socketId);
          }}
          onToggleRole={async (roleId, hasRole) => {
            if (!api) return;
            try {
              await api.updateUserRole(resolvedContextUser.user.id, roleId, hasRole ? 'remove' : 'add');
            } catch (err: unknown) {
              showError((err as Error).message || 'Erro ao alterar cargo.');
            }
          }}
          onMoveToVoice={async (targetChannelId) => {
            if (!api) return;
            try {
              await api.moderateVoice({ targetUserId: resolvedContextUser.user.id, moveToChannelId: targetChannelId });
              showToast(`Movendo ${resolvedContextUser.user.displayName}...`, 'info');
            } catch (err: unknown) {
              showError((err as Error).message || 'Erro ao mover usuário.');
            }
          }}
          onToggleServerMute={async () => {
            if (!api) return;
            try {
              await api.moderateVoice({
                targetUserId: resolvedContextUser.user.id,
                serverMuted: !resolvedContextUser.user.serverMuted,
              });
            } catch (err: unknown) {
              showError((err as Error).message || 'Erro ao alterar silenciamento no servidor.');
            }
          }}
          onToggleServerDeafen={async () => {
            if (!api) return;
            try {
              await api.moderateVoice({
                targetUserId: resolvedContextUser.user.id,
                serverDeafened: !resolvedContextUser.user.serverDeafened,
              });
            } catch (err: unknown) {
              showError((err as Error).message || 'Erro ao alterar áudio no servidor.');
            }
          }}
          onKickUser={async () => {
            if (!api) return;
            const reason = window.prompt(`Motivo para expulsar ${resolvedContextUser.user.displayName} (opcional):`, '');
            if (reason === null) return;
            try {
              await api.kickUser(resolvedContextUser.user.id, reason);
              showToast(`${resolvedContextUser.user.displayName} foi expulso do servidor.`, 'info');
            } catch (err: unknown) {
              showError((err as Error).message || 'Erro ao expulsar usuário.');
            }
          }}
          onBanUser={async () => {
            if (!api) return;
            const reason = window.prompt(`Motivo para banir ${resolvedContextUser.user.displayName} (opcional):`, '');
            if (reason === null) return;
            try {
              await api.banUser(resolvedContextUser.user.id, reason);
              showToast(`${resolvedContextUser.user.displayName} foi banido do servidor.`, 'info');
            } catch (err: unknown) {
              showError((err as Error).message || 'Erro ao banir usuário.');
            }
          }}
          onClose={() => setContextMenuTarget(null)}
        />
      )}

      {/* Floating Profile Popout Card */}
      {profilePopout && resolvedPopoutUser && (
        <UserProfilePopout
          user={resolvedPopoutUser}
          selfUser={user}
          roles={roles}
          serverUrl={serverUrl}
          contextScope={navArea === 'dms' ? 'dm' : 'server'}
          anchor={{ x: profilePopout.x, y: profilePopout.y }}
          onClose={() => setProfilePopout(null)}
          onSetStatus={(st) => {
            autoAwayActiveRef.current = false;
            applySelfStatus(st);
            setProfilePopout(null);
          }}
          onOpenFullProfile={(editMode) => {
            setProfilePopout(null);
            setProfileModal({ userId: resolvedPopoutUser.id, edit: Boolean(editMode) });
          }}
          onOpenDm={() => {
            setProfilePopout(null);
            handleOpenDmWithUser(resolvedPopoutUser);
          }}
          onStartPrivateCall={() => {
            setProfilePopout(null);
            handleStartPrivateCall(resolvedPopoutUser);
          }}
        />
      )}

      {/* Full Discord Profile & Nitro-Free Global Profile Editor Modal */}
      {profileModal && resolvedModalUser && (
        <LazyBoundary>
        <UserProfileModal
          user={resolvedModalUser}
          selfUser={user}
          initialEdit={profileModal.edit}
          api={api}
          serverUrl={serverUrl}
          roles={roles}
          contextScope={navArea === 'dms' ? 'dm' : 'server'}
          onClose={() => setProfileModal(null)}
          onUserUpdated={(updatedUser, globalPatch) => {
            if (updatedUser.id === user.id) setUser(updatedUser);
            if (globalPatch) {
              persistLocalGlobalProfile(globalPatch).catch(() => {});
            }
          }}
          onOpenDm={(u) => {
            setProfileModal(null);
            handleOpenDmWithUser(u);
          }}
          onStartPrivateCall={(u) => {
            setProfileModal(null);
            handleStartPrivateCall(u);
          }}
        />
        </LazyBoundary>
      )}

      {/* Server Directory Modal ("+" Button: Create Server or Join IPv4/LAN) */}
      <ImageContextMenu onNotify={showToast} />
      {recConsentAsk && (
        <div className="fixed inset-0 z-[150] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-[400px] bg-[#313338] rounded-lg shadow-2xl border border-[#1e1f22] p-5 space-y-3 animate-fade-up">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="relative flex w-3 h-3">
                <span className="absolute inline-flex w-full h-full rounded-full bg-[#f23f42] opacity-75 animate-ping" />
                <span className="relative inline-flex w-3 h-3 rounded-full bg-[#f23f42]" />
              </span>
              Pedido de gravação
            </div>
            <p className="text-sm text-[#dbdee1]">
              <strong>{recConsentAsk.from}</strong> quer gravar esta chamada (sua voz e a de todos). A gravação só começa se todos
              permitirem.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  (p2pCallSocketRef.current || socketRef.current)?.emit('voice:record-consent', { requestId: recConsentAsk.requestId, accept: false });
                  setRecConsentAsk(null);
                }}
                className="px-4 py-2 rounded text-sm font-semibold text-white bg-[#4e5058] hover:bg-[#6d6f78] cursor-pointer"
              >
                Não permitir
              </button>
              <button
                type="button"
                onClick={() => {
                  (p2pCallSocketRef.current || socketRef.current)?.emit('voice:record-consent', { requestId: recConsentAsk.requestId, accept: true });
                  setRecConsentAsk(null);
                }}
                className="px-4 py-2 rounded text-sm font-semibold text-white bg-[#da373c] hover:bg-[#a12828] cursor-pointer"
              >
                Permitir gravação
              </button>
            </div>
          </div>
        </div>
      )}
      {recJoinPrompt && (
        <div className="fixed inset-0 z-[150] bg-black/70 flex items-center justify-center p-4" onClick={() => setRecJoinPrompt(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[400px] bg-[#313338] rounded-lg shadow-2xl border border-[#1e1f22] p-5 space-y-3 animate-fade-up"
          >
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="relative flex w-3 h-3">
                <span className="absolute inline-flex w-full h-full rounded-full bg-[#f23f42] opacity-75 animate-ping" />
                <span className="relative inline-flex w-3 h-3 rounded-full bg-[#f23f42]" />
              </span>
              Esta chamada está sendo gravada
            </div>
            <p className="text-sm text-[#dbdee1]">
              <strong>{recJoinPrompt.names.join(', ')}</strong> {recJoinPrompt.names.length > 1 ? 'estão' : 'está'} gravando esta chamada. Se você
              entrar, sua voz também vai ser gravada. Quer entrar mesmo assim?
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRecJoinPrompt(null)}
                className="px-4 py-2 rounded text-sm font-semibold text-white bg-[#4e5058] hover:bg-[#6d6f78] cursor-pointer"
              >
                Não entrar
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  const cid = recJoinPrompt.channelId;
                  setRecJoinPrompt(null);
                  handleJoinOrFocusVoiceChannel(cid, { recordingOk: true });
                }}
                className="px-4 py-2 rounded text-sm font-semibold text-white bg-[#248046] hover:bg-[#1a6334] cursor-pointer"
              >
                Entrar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}
      <LinkContextMenu
        inVoiceCall={Boolean(activeVoiceChannelId)}
        onNotify={showToast}
        onPlayVideo={(url) => {
          handleAddVideoUrlToVoice(url).then((r) => r?.error && showToast(r.error, 'error'));
        }}
        onPlayMusic={(url) => {
          handleAddMusicUrlToVoice(url).then((r) => r?.error && showToast(r.error, 'error'));
        }}
      />

      {showServerDirectory && (
        <LazyBoundary>
        <ServerDirectoryModal
          initialTab="create"
          lanServers={lanServers}
          onScanLan={handleScanLan}
          onCreateServer={handleCreateServerFromDirectory}
          onJoinServer={handleJoinServerFromDirectory}
          onClose={() => setShowServerDirectory(false)}
        />
        </LazyBoundary>
      )}

      {/* Modals */}
      {showHostModal && server && (
        <LazyBoundary>
        <HostControlModal
          api={api}
          appMode={appMode}
          hostStatus={hostStatus}
          serverUrl={serverUrl}
          onSwitchToHost={handleSwitchToHostInApp}
          onSwitchToClient={async () => {
            setShowHostModal(false);
            await handleLeaveServer();
          }}
          onStartTunnel={handleStartTunnel}
          onStopTunnel={handleStopTunnel}
          onClose={() => setShowHostModal(false)}
        />
        </LazyBoundary>
      )}

      {show3DViewer && (
        <LazyBoundary
          fallback={
            <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center text-white text-xs font-bold">
              Carregando motor 3D...
            </div>
          }
        >
          <Model3DViewerModal
            initialTarget={model3DTarget}
            api={api}
            serverUrl={serverUrl}
            onClose={() => setShow3DViewer(false)}
          />
        </LazyBoundary>
      )}

      {pendingShareFiles.length > 0 && (
        <ShareTargetModal
          files={pendingShareFiles}
          channels={channels}
          members={members}
          selfId={user.id}
          busy={shareBusy}
          onPick={handlePickShareTarget}
          onClose={() => {
            setPendingShareFiles([]);
            window.electronAPI?.clearPendingShares?.().catch(() => {});
          }}
        />
      )}

      {showSearch && api && (
        <SearchModal
          api={api}
          channels={channels}
          currentChannel={navArea === 'server' ? activeTextChannel : null}
          onJump={handleSearchJump}
          onClose={() => setShowSearch(false)}
        />
      )}

      {showEvents && api && (
        <EventsModal
          events={serverEvents}
          channels={channels}
          members={members}
          selfId={user.id}
          canManageAll={Boolean(serverPermissions.manageChannels || serverPermissions.administrator || user.role === 'host')}
          onCreate={async (p) => {
            const r = await api.createEvent(p);
            setServerEvents((prev) => (prev.some((e) => e.id === r.event.id) ? prev : [...prev, r.event].sort((a, b) => a.startsAt - b.startsAt)));
          }}
          onRsvp={(id, status: RsvpStatus | null) =>
            api
              .rsvpEvent(id, status)
              .then((r) => setServerEvents((prev) => prev.map((e) => (e.id === r.event.id ? r.event : e))))
              .catch((err: Error) => showError(err.message))
          }
          onDelete={(id) =>
            api
              .deleteEvent(id)
              .then(() => setServerEvents((prev) => prev.filter((e) => e.id !== id)))
              .catch((err: Error) => showError(err.message))
          }
          onJoinVoice={(cid) => {
            setShowEvents(false);
            handleJoinOrFocusVoiceChannel(cid);
          }}
          onClose={() => setShowEvents(false)}
        />
      )}

      {pollComposerOpen && activeTextChannel && (
        <PollComposerModal
          channelName={activeTextChannel.name}
          onSubmit={(d) => handleSubmitPoll(activeTextChannel.id, d)}
          onClose={() => setPollComposerOpen(false)}
        />
      )}

      {createChannelMeta && api && (
        <CreateChannelModal
          initialType={createChannelMeta.type}
          categoryId={createChannelMeta.categoryId}
          canCreatePrivate={Boolean(serverPermissions.manageChannels || user.role === 'host')}
          onClose={() => setCreateChannelMeta(null)}
          onCreate={async (payload) => {
            const { channel } = await api.createChannel(payload);
            if (channel.type === 'text') {
              setNavArea('server');
              setActiveTextChannelId(channel.id);
              setViewMode('chat');
            }
          }}
        />
      )}

      {showScreenModal && (
        <ScreenShareModal onClose={() => setShowScreenModal(false)} onStart={handleStartScreenShare} />
      )}

      {settingsTab && (
        <LazyBoundary>
        <SettingsModal
          initialTab={settingsTab}
          api={api}
          serverUrl={serverUrl}
          user={user}
          users={members}
          server={server}
          roles={roles}
          permissions={serverPermissions}
          audioSettings={audioSettings}
          onUpdateAudioSettings={setAudioSettings}
          themeConfig={themeConfig}
          onUpdateThemeConfig={handleUpdateThemeConfig}
          updateManifest={updateManifest}
          localVersion={localUpdateInfo?.appVersion || '4.0.0'}
          onCheckUpdates={checkUpdates}
          onApplyUpdate={handleApplyUpdate}
          onOpenFullProfileEditor={() => setProfileModal({ userId: user.id, edit: true })}
          onServerUpdated={(s) => setServer(s)}
          onRolesUpdated={setRoles}
          onUsersUpdated={setMembers}
          onLogout={handleLogout}
          onClose={() => setSettingsTab(null)}
        />
        </LazyBoundary>
      )}

      {channelContextMenu && (
        <ChannelContextMenu
          channel={channelContextMenu.channel}
          x={channelContextMenu.x}
          y={channelContextMenu.y}
          categories={categories}
          isFavorite={favoriteChannelIds.has(channelContextMenu.channel.id)}
          isPinnedTop={pinnedChannelIds.has(channelContextMenu.channel.id)}
          isMuted={mutedChannelIds.has(channelContextMenu.channel.id)}
          notifyLevel={channelNotifyMap[channelContextMenu.channel.id] || 'mentions'}
          canManageChannels={Boolean(serverPermissions.manageChannels || user.role === 'host')}
          onMarkRead={() => showToast(`Canal #${channelContextMenu.channel.name} marcado como lido.`, 'info')}
          onToggleFavorite={() => {
            const id = channelContextMenu.channel.id;
            setFavoriteChannelIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onTogglePinTop={() => {
            const id = channelContextMenu.channel.id;
            setPinnedChannelIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onCopyInvite={() => {
            const inviteAddr = hostStatus?.addresses?.[0]?.address || serverUrl;
            navigator.clipboard.writeText(inviteAddr).catch(() => {});
            showToast(`Convite copiado: ${inviteAddr}`, 'info');
          }}
          onCopyLink={() => {
            const link = `${serverUrl}/#${channelContextMenu.channel.id}`;
            navigator.clipboard.writeText(link).catch(() => {});
            showToast('Link do canal copiado!', 'info');
          }}
          onSetMuted={(mutedFlag) => {
            const id = channelContextMenu.channel.id;
            setMutedChannelIds((prev) => {
              const next = new Set(prev);
              if (mutedFlag) next.add(id);
              else next.delete(id);
              return next;
            });
          }}
          onSetNotifyLevel={(lvl) => {
            const id = channelContextMenu.channel.id;
            setChannelNotifyMap((prev) => ({ ...prev, [id]: lvl }));
          }}
          onMoveToCategory={(catId) => {
            api
              ?.updateChannel(channelContextMenu.channel.id, { categoryId: catId })
              .catch((err) => showError(err?.message || 'Erro ao mover canal.'));
          }}
          onEditChannel={() => setEditingChannel(channelContextMenu.channel)}
          onDuplicateChannel={() => {
            api
              ?.duplicateChannel(channelContextMenu.channel.id)
              .then((res) => showToast(`Canal #${res.channel.name} duplicado!`, 'info'))
              .catch((err) => showError(err?.message || 'Erro ao duplicar canal.'));
          }}
          onCreateSameTypeChannel={() =>
            setCreateChannelMeta({
              type: channelContextMenu.channel.type,
              categoryId: channelContextMenu.channel.categoryId,
            })
          }
          onDeleteChannel={() => handleDeleteChannel(channelContextMenu.channel)}
          onClose={() => setChannelContextMenu(null)}
        />
      )}

      {serverContextMenu && server && (
        <ServerContextMenu
          x={serverContextMenu.x}
          y={serverContextMenu.y}
          isHosting={appMode === 'host' && Boolean(hostStatus?.running)}
          isMuted={serverMutedNotify}
          hideMutedChannels={hideMutedChannels}
          notifyLevel={serverNotifyLevel}
          permissions={serverPermissions}
          onMarkAllRead={() => showToast('Todos os canais do servidor marcados como lidos!', 'info')}
          onInviteToServer={() => {
            const inviteAddr = hostStatus?.addresses?.[0]?.address || serverUrl;
            navigator.clipboard.writeText(inviteAddr).catch(() => {});
            showToast(`Endereço do servidor copiado: ${inviteAddr}`, 'info');
          }}
          onSetMuted={setServerMutedNotify}
          onSetNotifyLevel={setServerNotifyLevel}
          onToggleHideMuted={() => setHideMutedChannels((v) => !v)}
          onOpenServerSettings={(subtab) => setSettingsTab(subtab || 'server')}
          onOpenPrivacy={() => setSettingsTab('network')}
          onEditServerProfile={() => setSettingsTab('server')}
          onCreateChannel={() => setCreateChannelMeta({ type: 'text' })}
          onCreateCategory={handleCreateCategoryPrompt}
          onLeaveServer={handleLeaveServer}
          onClose={() => setServerContextMenu(null)}
        />
      )}

      {editingChannel && api && (
        <LazyBoundary>
        <ChannelSettingsModal
          channel={editingChannel}
          categories={categories}
          roles={roles}
          members={members}
          api={api}
          onUpdated={() => {
            setEditingChannel(null);
            showToast('Canal atualizado com sucesso!', 'info');
          }}
          onDeleted={(chId) => {
            setEditingChannel(null);
            if (activeTextChannelId === chId) setActiveTextChannelId('');
          }}
          onClose={() => setEditingChannel(null)}
        />
        </LazyBoundary>
      )}

      {groupModal && (
        <GroupModal
          mode={groupModal.mode}
          group={groupModal.group || null}
          selfUserId={user.id}
          availablePeers={availableGroupPeers}
          preselectedIds={groupModal.preselectedIds}
          serverUrl={server ? serverUrl : localPeerInfo?.p2pUrl || serverUrl}
          onSave={handleSaveGroupModal}
          onLeaveGroup={handleLeaveGroup}
          onClose={() => setGroupModal(null)}
        />
      )}

      {trelloModal && (
        <LazyBoundary>
        <TrelloBoardModal
          scopeKey={trelloModal.scopeKey}
          scopeTitle={trelloModal.scopeTitle}
          boards={trelloBoardsByScope[trelloModal.scopeKey] || []}
          members={members.length > 0 ? members : [user]}
          currentUser={user}
          canEdit={trelloModal.scopeKey === 'server' ? Boolean(serverPermissions.useTrello) : true}
          onSaveBoards={(nextBoards) => handleSaveTrelloBoards(trelloModal.scopeKey, nextBoards)}
          onClose={() => setTrelloModal(null)}
        />
        </LazyBoundary>
      )}
      </div>
    </div>
  );
}
