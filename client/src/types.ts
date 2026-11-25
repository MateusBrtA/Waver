export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export interface ActivityEntry {
  name: string;
  icon: string;
  category: 'game' | 'music' | 'app';
  color: string;
  startedAt?: number;
  lastPlayedAt?: number;
  totalMinutes?: number;
}

export interface UserConnection {
  platform: string;
  handle: string;
}

export type PermissionKey =
  | 'viewChannels'
  | 'viewPrivateChannels'
  | 'manageChannels'
  | 'manageRoles'
  | 'manageExpressions'
  | 'viewAuditLog'
  | 'manageServer'
  | 'createInvite'
  | 'changeNickname'
  | 'kickMembers'
  | 'banMembers'
  | 'sendMessages'
  | 'attachFiles'
  | 'embedLinks'
  | 'pinMessages'
  | 'manageMessages'
  | 'connectVoice'
  | 'speakVoice'
  | 'streamVideo'
  | 'useSoundboard'
  | 'useMediaQueue'
  | 'useWhiteboard'
  | 'useTrello'
  | 'muteMembers'
  | 'deafenMembers'
  | 'moveMembers'
  | 'administrator';

export type RolePermissions = Record<PermissionKey, boolean>;

export type PermissionTriState = 'allow' | 'deny' | 'inherit';

export interface ChannelPermissionOverwrite {
  id: string; // roleId or userId
  targetType: 'role' | 'member';
  targetName?: string;
  allow: PermissionKey[];
  deny: PermissionKey[];
}

export interface ChannelCategory {
  id: string;
  name: string;
  position: number;
  isPrivate?: boolean;
  overwrites?: ChannelPermissionOverwrite[];
}

export interface Role {
  id: string;
  name: string;
  color: string;
  isSystem?: boolean;
  isEveryone?: boolean;
  hoist?: boolean;
  position?: number;
  permissions?: Partial<RolePermissions>;
}

export type AuditLogType =
  | 'member_join'
  | 'member_leave'
  | 'member_kick'
  | 'member_ban'
  | 'member_unban'
  | 'voice_join'
  | 'voice_leave'
  | 'voice_mod'
  | 'channel_create'
  | 'channel_update'
  | 'channel_delete'
  | 'role_create'
  | 'role_update'
  | 'role_delete'
  | 'member_role'
  | 'message_delete'
  | 'message_pin'
  | 'server_update';

export interface AuditLogEntry {
  id: string;
  type: AuditLogType | string;
  actorId: string;
  actorName: string;
  actorAvatar?: string | null;
  targetId?: string;
  targetName?: string;
  details?: string;
  reason?: string;
  createdAt: number;
}

export interface BanEntry {
  userId: string;
  username: string;
  displayName: string;
  reason: string;
  bannedBy: string;
  bannedAt: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  avatarHash?: string | null;
  bannerColor?: string;
  bannerUrl?: string | null;
  bannerHash?: string | null;
  avatarDecoration?: string;
  nameStyle?: string;
  /** efeito animado atrás do cartão de perfil (galáxia, aurora...) */
  profileEffect?: string;
  /** imagem/GIF de fundo do cartão de perfil (não é o banner) */
  profileBgUrl?: string | null;
  profileBgHash?: string | null;
  bio?: string;
  pronouns?: string;
  statusType?: PresenceStatus;
  customStatusEmoji?: string;
  customStatusText?: string;
  role: 'host' | 'member';
  roleIds?: string[];
  badges?: string[];
  connections?: UserConnection[];
  currentActivity?: ActivityEntry | null;
  recentActivities?: ActivityEntry[];
  serverMuted?: boolean;
  serverDeafened?: boolean;
  createdAt: number;
  online?: boolean;
  actuallyConnected?: boolean;
}

export interface GlobalProfile {
  displayName?: string;
  avatarColor?: string;
  bannerColor?: string;
  avatarDataUrl?: string | null;
  avatarHash?: string | null;
  bannerDataUrl?: string | null;
  bannerHash?: string | null;
  profileEffect?: string;
  profileBgDataUrl?: string | null;
  profileBgHash?: string | null;
  avatarDecoration?: string;
  nameStyle?: string;
  bio?: string;
  pronouns?: string;
  statusType?: PresenceStatus;
  customStatusEmoji?: string;
  customStatusText?: string;
  connections?: UserConnection[];
}

export interface ServerTag {
  emoji: string;
  label: string;
}

export interface ServerInfo {
  name: string;
  description: string;
  iconColor: string;
  iconUrl?: string | null;
  bannerColor?: string;
  bannerUrl?: string | null;
  tags?: ServerTag[];
  createdAt?: number;
  hasInvitePassword: boolean;
  allowMembersCreateChannels: boolean;
  hasTenorKey: boolean;
  hasGiphyKey: boolean;
  hasYoutubeCookies?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  topic: string;
  categoryId?: string | null;
  position?: number;
  slowModeSec?: number;
  visibility?: 'default' | 'spoiler' | 'nsfw';
  isPrivate?: boolean;
  bitrateKbps?: number;
  userLimit?: number;
  overwrites?: ChannelPermissionOverwrite[];
  createdAt: number;
  createdBy: string;
}

export type WhiteboardBrush = 'pen' | 'airbrush' | 'marker' | 'calligraphy' | 'spray' | 'pixel' | 'eraser';
export type WhiteboardTool = WhiteboardBrush | 'select' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eyedropper' | 'fill';

export interface WhiteboardLayer {
  id: string;
  name: string;
  visible: boolean;
  locked?: boolean;
  opacity: number;
  /** modo de mesclagem (globalCompositeOperation): normal, multiply, screen... */
  blend?: string;
}

export interface WhiteboardPoint {
  x: number;
  y: number;
  p: number; // stylus pressure 0.05..1
}

export interface WhiteboardElement {
  id: string;
  kind: 'stroke' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'image';
  layerId: string;
  color: string;
  size: number;
  opacity: number;
  hardness?: number;
  brush?: WhiteboardBrush;
  points?: WhiteboardPoint[];
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  w?: number;
  h?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  dataUrl?: string;
  seed?: number;
  /** deslocamento aplicado por "mover" (traços/formas/texto) */
  tx?: number;
  ty?: number;
  /** rotação em radianos (imagens) */
  rot?: number;
  /** retângulo/elipse preenchidos */
  filled?: boolean;
  authorId: string;
  authorName: string;
  createdAt: number;
}

export interface WhiteboardState {
  channelId: string;
  background: 'dark' | 'light' | 'grid' | 'transparent';
  layers: WhiteboardLayer[];
  elements: WhiteboardElement[];
  seq: number;
}

export interface WhiteboardCursor {
  socketId: string;
  userId: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  size: number;
  tool: string;
  isDrawing: boolean;
}

export interface TrelloLabel {
  id: string;
  name: string;
  color: string;
}

export interface TrelloChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TrelloCard {
  id: string;
  title: string;
  description: string;
  labelIds: string[];
  dueDate?: string | null;
  completed?: boolean;
  checklist: TrelloChecklistItem[];
  memberIds: string[];
  createdBy: string;
  createdAt: number;
}

export interface TrelloList {
  id: string;
  title: string;
  cards: TrelloCard[];
}

export interface TrelloBoard {
  id: string;
  scopeKey: string;
  name: string;
  background: string;
  lists: TrelloList[];
  labels: TrelloLabel[];
  updatedAt: number;
  createdBy: string;
}

export interface PrivateGroupMemberMeta {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string | null;
  p2pUrl?: string;
}

export interface PrivateGroup {
  id: string;
  name: string;
  iconUrl?: string | null;
  ownerId: string;
  memberIds: string[];
  membersMeta?: PrivateGroupMemberMeta[];
  isLanP2p?: boolean;
  hostP2pUrl?: string;
  createdAt: number;
}

export interface Attachment {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'gif' | 'audio' | 'video' | 'file';
  prunedByCache?: boolean;
  waveform?: number[];
  durationSec?: number;
  isVoiceMessage?: boolean;
}

export interface FileTransfer {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  oneTime: boolean;
  downloadedCount: number;
  burned: boolean;
  expiredByCache: boolean;
  uploadedBy: string;
  uploadedById: string;
  downloadUrl: string;
  createdAt: number;
}

export interface StorageStats {
  totalBytes: number;
  maxBytes: number;
  softCapBytes: number;
  percentUsed: number;
  fileCount: number;
  breakdown: {
    imagesBytes: number;
    transfersBytes: number;
    soundsBytes: number;
    musicBytes: number;
    avatarsBytes: number;
    messagesVaultBytes: number;
  };
}

export interface ChatMessage {
  id: string;
  channelId: string;
  pairKey?: string;
  toUserId?: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  authorColor: string;
  content: string;
  attachments: Attachment[];
  gifUrl: string | null;
  transfer?: FileTransfer | null;
  replyTo: {
    id: string;
    authorName: string;
    snippet: string;
  } | null;
  pinned?: boolean;
  pinnedAt?: number | null;
  pinnedBy?: string | null;
  createdAt: number;
}

export interface StreamsMeta {
  micStreamId: string | null;
  micAudioTrackId: string | null;
  camStreamId: string | null;
  camVideoTrackId: string | null;
  screenStreamId: string | null;
  screenVideoTrackId: string | null;
  screenAudioTrackId: string | null;
  screenLabel?: string;
}

export interface VoiceParticipant {
  socketId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  avatarDecoration?: string;
  muted: boolean;
  deafened: boolean;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  screenLabel: string;
  streamsMeta?: StreamsMeta | null;
  joinedAt: number;
}

export interface StreamStats {
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  codec: string;
  rttMs: number;
  adaptiveTargetMbps?: number;
}

export interface RemotePeerMedia {
  socketId: string;
  micStream: MediaStream | null;
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
  screenAudioStream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  speaking: boolean;
  screenStats: StreamStats | null;
  camStats: StreamStats | null;
  dataChannelOpen?: boolean;
}

export interface ScreenShareConfig {
  sourceId?: string;
  label?: string;
  qualityMode: 'auto' | 'manual';
  resolution: '720p' | '1080p' | '1440p' | 'source';
  fps: 30 | 60 | 120;
  maxBitrateMbps: number;
  contentMode: 'motion' | 'detail';
  shareAudio: boolean;
  lowLatencyGaming?: boolean;
}

export interface RcPermissions {
  mouse: boolean;
  keyboard: boolean;
  gamepad: boolean;
}

export interface RcPeerSession {
  socketId: string;
  userId?: string;
  name: string;
  permissions: RcPermissions;
  gamepadSlot: number;
}

export interface RemoteInputEvent {
  type: 'mousemove' | 'mouserel' | 'mousedown' | 'mouseup' | 'wheel' | 'keydown' | 'keyup' | 'gamepad' | 'rumble' | 'host-busy';
  /** host-busy: o host está usando o mouse/teclado físico (controle remoto pausado) */
  busy?: boolean;
  nx?: number;
  ny?: number;
  dx?: number;
  dy?: number;
  button?: number;
  deltaY?: number;
  code?: string;
  slot?: number;
  buttonsMask?: number;
  lt?: number;
  rt?: number;
  lx?: number;
  ly?: number;
  rx?: number;
  ry?: number;
  largeMotor?: number;
  smallMotor?: number;
  seq?: number;
}

export interface SoundItem {
  id: string;
  name: string;
  emoji: string;
  color: string;
  url: string;
  volume: number;
  createdBy: string;
  createdAt: number;
  isStarter?: boolean;
}

export interface SoundPlayedToast {
  id: string;
  sound: SoundItem;
  playedBy: {
    userId: string;
    displayName: string;
    avatarColor: string;
  };
  playedAt: number;
}

export interface MusicTrack {
  id: string;
  mediaId?: string;
  queueId?: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: number;
  platform?: 'youtube' | 'spotify' | 'soundcloud' | string;
  url: string;
  source?: string;
  playlistBlockId?: string;
  playlistTitle?: string;
  playlistThumbnail?: string;
  playlistPlatform?: string;
  addedBy?: string;
  createdAt?: number;
}

export interface VideoQueueItem {
  queueId: string;
  id: string;
  mediaId: string;
  platform: 'youtube' | 'twitter' | 'instagram' | 'tiktok';
  youtubeId?: string | null;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  originalUrl: string;
  /** null = só toca pelo player do YouTube (yt-dlp bloqueado) */
  streamPath: string | null;
  audioStreamPath?: string | null;
  addedBy?: string;
}

export interface VideoState {
  channelId: string;
  queue: VideoQueueItem[];
  currentIndex: number;
  isPlaying: boolean;
  positionSec: number;
  updatedAt: number;
  seq?: number;
  lastAction?: string;
  actorName?: string;
  /** velocidade da sala (0.25–2), igual para todos */
  rate?: number;
  serverNow: number;
  /** Date.now() local quando este estado chegou (posição conta a partir daqui) */
  receivedAt?: number;
}

export interface MediaEmbedInfo {
  url: string;
  platform: 'youtube' | 'twitter' | 'instagram' | 'tiktok' | 'spotify' | 'soundcloud' | 'unknown';
  providerName: string;
  accentColor: string;
  authorName: string;
  title: string;
  thumbnailUrl: string;
  duration: number;
  canPlayVideo: boolean;
  canPlayAudio: boolean;
  youtubeId?: string | null;
}

export interface BlendMetadata {
  version: string;
  pointerBits: number;
  compressed: boolean;
  counts: {
    scenes: number;
    objects: number;
    meshes: number;
    materials: number;
    cameras: number;
    lights: number;
    armatures: number;
  };
  objectNames: string[];
  meshNames: string[];
  materialNames: string[];
}

export interface Model3DViewerTarget {
  name: string;
  url: string;
  ext: string;
  /** Arquivos enviados junto (texturas .png/.jpg, .mtl, .bin) usados para resolver referências do modelo */
  companions?: { name: string; url: string }[];
}

export interface UpdateManifest {
  version: string;
  serverAppVersion: string;
  uiHash: string;
  hasUiBundle: boolean;
  hasInstaller: boolean;
  installerName: string | null;
  installerSize: number;
  installerSha256: string;
  releaseNotes: string;
  updatedAt: number;
}

export interface ThemeConfig {
  presetId: string;
  accentColor: string;
  borderRadiusPx: number;
  glassOpacity: number;
  wallpaperUrl: string;
  wallpaperBlurPx: number;
  fontFamily: string;
  customCss: string;
  safeMode: boolean;
}

export interface MusicState {
  channelId: string;
  queue: MusicTrack[];
  currentIndex: number;
  isPlaying: boolean;
  positionSec: number;
  updatedAt: number;
  loopMode: 'none' | 'one' | 'all';
  seq?: number;
  lastAction?: string;
  actorName?: string;
  serverNow: number;
}

export interface GifItem {
  id: string;
  title: string;
  url: string;
  previewUrl?: string;
  tags?: string;
  addedBy?: string;
  createdAt?: number;
}

export interface AudioSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  videoDeviceId: string;
  inputProfile: 'voice-isolation' | 'studio' | 'custom';
  inputMode: 'vad' | 'ptt';
  vadAuto: boolean;
  vadThreshold: number; // 0 to 100
  pttKey: string; // KeyboardEvent.code e.g. 'KeyV', 'CapsLock', 'Backquote'
  inputVolume: number; // 0 to 2 (0% - 200%)
  outputVolume: number; // 0 to 2 (0% - 200%)
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  soundboardVolume: number;
  musicVolume: number;
  customTurnUrl: string;
  customTurnUser: string;
  customTurnCred: string;
}

export interface DesktopSourceItem {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  displayId?: string;
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
}

export interface HostAddress {
  name: string;
  address: string;
  url: string;
}

export interface LanServer {
  id: string;
  serverName: string;
  hostName: string;
  ip: string;
  port: number;
  url: string;
  hasPassword: boolean;
  onlineCount: number;
  networkLabel: string;
  isSelf: boolean;
}

export interface HostStatus {
  running: boolean;
  starting: boolean;
  port: number;
  localUrl: string;
  addresses: HostAddress[];
  hasPassword?: boolean;
  externalExisting: boolean;
  error: string;
  tunnelStatus: 'idle' | 'downloading' | 'connecting' | 'connected' | 'error';
  tunnelUrl: string;
  tunnelError: string;
}

export type AppMode = 'host' | 'client';

export interface LanPeer {
  peerId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl: string | null;
  bannerColor?: string;
  bio?: string;
  statusType?: User['statusType'];
  customStatusEmoji?: string;
  customStatusText?: string;
  currentActivity?: ActivityEntry | null;
  ip: string;
  p2pPort: number;
  p2pUrl: string;
  shareUrl?: string;
  online: boolean;
}

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  getDesktopSources: () => Promise<DesktopSourceItem[]>;
  prepareScreenCapture: (opts: { sourceId: string; shareAudio: boolean; useProcessLoopback?: boolean }) => Promise<boolean>;
  // Zero-Echo WASAPI Process Loopback
  startProcessLoopback: () => Promise<{ ok: boolean; sampleRate?: number; channels?: number; error?: string }>;
  stopProcessLoopback: () => Promise<boolean>;
  onLoopbackPcm: (cb: (chunk: Uint8Array) => void) => () => void;
  // In-App Auto-Updater
  getLocalUpdateInfo: () => Promise<{ appVersion: string; uiHash: string; isPackaged: boolean; isPortable: boolean }>;
  applyUiUpdate: (serverUrl: string) => Promise<{ ok: boolean; uiHash: string }>;
  downloadAndInstallUpdate: (opts: {
    serverUrl: string;
    expectedSha256?: string;
    installerName?: string | null;
  }) => Promise<{ ok: boolean }>;
  onUpdateProgress: (cb: (p: { percent: number; loaded: number; total: number; speedMBps: number }) => void) => () => void;
  // 3D Blender & Theme Persistence
  convertLocalBlend: (opts: {
    bytes: ArrayBuffer | Uint8Array;
    fileName: string;
  }) => Promise<{ glbBytes: Uint8Array | null; metadata: BlendMetadata | null; hasLocalBlender?: boolean; error?: string }>;
  loadThemeConfig: () => Promise<ThemeConfig | null>;
  saveThemeConfig: (cfg: ThemeConfig) => Promise<boolean>;
  // Parsec Remote Control + Virtual Xbox Controller (ViGEmBus)
  rcEnable: () => Promise<boolean>;
  rcDisable: () => Promise<boolean>;
  rcGetStatus: () => Promise<{ enabled: boolean; ready: boolean; vigemStatus: string }>;
  rcSetPermissions: (perms: RcPermissions) => Promise<RcPermissions>;
  rcDisconnectGamepad: (slot?: number) => Promise<boolean>;
  rcRetryViGEm: () => Promise<{ vigemStatus: string }>;
  rcInstallViGEmBus: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  rcExecuteInput: (evt: RemoteInputEvent) => void;
  rcSetHostPriority?: (enabled: boolean) => Promise<unknown>;
  onRcHostActivity?: (cb: (data: { active: boolean }) => void) => () => void;
  onRcEmergencyStopped: (cb: () => void) => () => void;
  onRcRumble: (cb: (data: { slot: number; large: number; small: number }) => void) => () => void;
  onRcStatusChanged: (cb: (st: { enabled: boolean; ready: boolean; vigemStatus: string }) => void) => () => void;
  // Global Profile & Local Encrypted DM Archive
  loadGlobalProfile: () => Promise<GlobalProfile | null>;
  saveGlobalProfile: (profile: GlobalProfile) => Promise<boolean>;
  loadLocalDmVault: () => Promise<Record<string, ChatMessage[]>>;
  saveLocalDmVault: (dmMap: Record<string, ChatMessage[]>) => Promise<boolean>;
  // Automatic Game/App Activity Detector
  getActivityState: () => Promise<{ currentActivity: ActivityEntry | null; recentActivities: ActivityEntry[] }>;
  onActivityUpdated: (
    cb: (state: { currentActivity: ActivityEntry | null; recentActivities: ActivityEntry[] }) => void
  ) => () => void;
  // Serverless LAN P2P Direct Messages & 1-on-1 Calls
  lanPeersGetSelf: () => Promise<LanPeer | null>;
  lanPeersGet: () => Promise<LanPeer[]>;
  lanPeersScan: () => Promise<LanPeer[]>;
  lanPeersUpdateIdentity: (identity: Partial<GlobalProfile & { peerId: string; username: string; currentActivity: ActivityEntry | null }>) => Promise<LanPeer | null>;
  lanPeersSendDm: (payload: {
    toPeerId: string;
    peerUrl?: string;
    content: string;
    attachments?: Array<{
      name: string;
      mimeType: string;
      bytes?: ArrayBuffer | Uint8Array;
      url?: string;
      kind?: Attachment['kind'];
      waveform?: number[];
      durationSec?: number;
      isVoiceMessage?: boolean;
    }>;
    gifUrl?: string | null;
    replyTo?: ChatMessage['replyTo'];
  }) => Promise<{ ok: boolean; message: ChatMessage }>;
  lanPeersPinDm: (payload: { toPeerId: string; peerUrl?: string; pairKey: string; messageId: string; pinned: boolean }) => Promise<{ ok: boolean }>;
  lanPeersCallInvite: (payload: { toPeerId: string; peerUrl?: string; dmRoomId: string }) => Promise<{ ok: boolean; callServerUrl: string }>;
  lanPeersCallRespond: (payload: { toPeerId: string; peerUrl?: string; dmRoomId: string; accepted: boolean }) => Promise<{ ok: boolean }>;
  onLanPeersUpdated: (cb: (peers: LanPeer[]) => void) => () => void;
  onLanDmMessage: (cb: (data: { message: ChatMessage; fromPeerId: string }) => void) => () => void;
  onLanDmPinned: (cb: (data: { peerId: string; pairKey: string; messageId: string; pinned: boolean; pinnedAt?: number | null; pinnedBy?: string | null }) => void) => () => void;
  onLanCallIncoming: (cb: (data: { dmRoomId: string; callServerUrl: string; fromPeer: LanPeer; group?: PrivateGroup }) => void) => () => void;
  onLanCallResponded: (cb: (data: { dmRoomId: string; accepted: boolean; fromPeer: LanPeer }) => void) => () => void;
  // Serverless LAN P2P Groups & Shared Call Trello
  lanPeersGetGroups?: () => Promise<PrivateGroup[]>;
  lanPeersSaveGroup?: (group: Partial<PrivateGroup> & { name: string; memberIds: string[]; membersMeta?: PrivateGroupMemberMeta[]; iconDataUrl?: string | null; clearIcon?: boolean }) => Promise<{ ok: boolean; group: PrivateGroup }>;
  lanPeersSendGroupMessage?: (payload: {
    groupId: string;
    content: string;
    attachments?: Array<{
      name: string;
      mimeType: string;
      bytes?: ArrayBuffer | Uint8Array;
      url?: string;
      kind?: Attachment['kind'];
      waveform?: number[];
      durationSec?: number;
      isVoiceMessage?: boolean;
    }>;
    gifUrl?: string | null;
    replyTo?: ChatMessage['replyTo'];
  }) => Promise<{ ok: boolean; message: ChatMessage }>;
  lanPeersPinGroupMessage?: (payload: { groupId: string; messageId: string; pinned: boolean }) => Promise<{ ok: boolean }>;
  lanPeersGroupCallInvite?: (payload: { groupId: string }) => Promise<{ ok: boolean; dmRoomId: string; callServerUrl: string }>;
  lanPeersGetTrello?: (scopeKey: string) => Promise<TrelloBoard[]>;
  lanPeersSyncTrello?: (payload: { scopeKey: string; boards: TrelloBoard[]; peerUrls?: string[] }) => Promise<{ ok: boolean; boards: TrelloBoard[] }>;
  onLanGroupUpdated?: (cb: (data: { group: PrivateGroup }) => void) => () => void;
  onLanGroupMessage?: (cb: (data: { groupId: string; message: ChatMessage }) => void) => () => void;
  onLanGroupPinned?: (cb: (data: { groupId: string; messageId: string; pinned: boolean; pinnedAt?: number | null; pinnedBy?: string | null }) => void) => () => void;
  onLanTrelloUpdated?: (cb: (data: { scopeKey: string; boards: TrelloBoard[] }) => void) => () => void;
  // Embedded Host & LAN Discovery
  hostStart: (opts?: number | { port?: number; serverName?: string; iconColor?: string; iconDataUrl?: string | null; password?: string }) => Promise<HostStatus>;
  hostStop: () => Promise<HostStatus>;
  hostStatus: () => Promise<HostStatus>;
  hostSetPassword: (password: string) => Promise<HostStatus>;
  hostStartTunnel: () => Promise<HostStatus>;
  hostStopTunnel: () => Promise<HostStatus>;
  onHostStatusChange: (cb: (status: HostStatus) => void) => () => void;
  lanGetServers: () => Promise<LanServer[]>;
  lanScanNow: () => Promise<LanServer[]>;
  onLanServersUpdate: (cb: (servers: LanServer[]) => void) => () => void;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  getCloseToTray: () => Promise<boolean>;
  setCloseToTray: (enabled: boolean) => Promise<boolean>;
  quitApp: () => void;
  onTrayToggleMute: (cb: () => void) => () => void;
  setPttKey?: (code: string | null) => void;
  copyImage?: (url: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  copyImagePng?: (dataUrl: string) => Promise<{ ok: boolean }>;
  saveImage?: (url: string, name?: string) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>;
  onPttKey?: (cb: (ev: { down: boolean; repeat: boolean }) => void) => () => void;
  onTrayToggleDeafen: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
