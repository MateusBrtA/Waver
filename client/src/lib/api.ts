import {
  ActivityEntry,
  Attachment,
  AuditLogEntry,
  BanEntry,
  BlendMetadata,
  Channel,
  ChannelCategory,
  ChannelPermissionOverwrite,
  ChatMessage,
  FileTransfer,
  GifItem,
  GlobalProfile,
  MediaEmbedInfo,
  MusicTrack,
  PrivateGroup,
  Role,
  RolePermissions,
  ServerInfo,
  ServerTag,
  SoundItem,
  StorageStats,
  TrelloBoard,
  UpdateManifest,
  User,
  VideoQueueItem,
} from '../types';

export function normalizeServerUrl(input: string): string {
  let url = (input || '').trim().replace(/\s+/g, '');
  if (!url) {
    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http') && window.location.port !== '5173') {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  }
  if (!/^https?:\/\//i.test(url)) {
    const isIpOrLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|26\.|100\.|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i.test(
      url
    );
    url = `${isIpOrLocal ? 'http' : 'https'}://${url}`;
  }
  url = url.replace(/\/+$/, '');

  try {
    const parsed = new URL(url);
    const isBareIpOrLocal =
      parsed.hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname);
    if (isBareIpOrLocal && !parsed.port && parsed.protocol === 'http:') {
      parsed.port = '3000';
      return parsed.origin;
    }
    return parsed.origin;
  } catch {
    return url;
  }
}

let localP2pBaseUrl = '';

export function setLocalP2pBaseUrl(url: string) {
  localP2pBaseUrl = (url || '').replace(/\/+$/, '');
}

export function resolveMediaUrl(serverUrl: string, pathOrUrl: string | null | undefined): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:') || pathOrUrl.startsWith('blob:')) {
    return pathOrUrl;
  }
  if (pathOrUrl.startsWith('/p2p/') && localP2pBaseUrl) {
    return `${localP2pBaseUrl}${pathOrUrl}`;
  }
  const base = normalizeServerUrl(serverUrl);
  return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export class ApiClient {
  serverUrl: string;
  token: string | null;

  constructor(serverUrl: string, token: string | null = null) {
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.token = token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let resp: Response;
    try {
      resp = await fetch(`${this.serverUrl}${endpoint}`, { ...options, headers });
    } catch {
      throw new Error(
        `Não foi possível conectar ao servidor (${this.serverUrl}). Verifique se o servidor está rodando e o endereço está correto.`
      );
    }

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data?.error || `Erro HTTP ${resp.status}`) as Error & { code?: string; status?: number };
      err.code = data?.code;
      err.status = resp.status;
      throw err;
    }
    return data as T;
  }

  health() {
    return this.request<{
      ok: boolean;
      version: string;
      server: ServerInfo;
      addresses: Array<{ name: string; address: string; url: string }>;
      hasDownloadableExe?: boolean;
    }>('/api/health');
  }

  login(payload: {
    username: string;
    displayName?: string;
    password?: string;
    invitePassword?: string;
    hostSelfJoin?: boolean;
  }) {
    return this.request<{ token: string; user: User; server: ServerInfo }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  me() {
    return this.request<{ user: User; server: ServerInfo }>('/api/auth/me');
  }

  logout() {
    return this.request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  }

  updateProfile(payload: Partial<User> & { clearBanner?: boolean }) {
    return this.request<{ user: User }>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  syncGlobalProfile(
    payload: GlobalProfile & {
      currentActivity?: ActivityEntry | null;
      recentActivities?: ActivityEntry[];
    }
  ) {
    return this.request<{ user: User }>('/api/users/sync-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  uploadAvatar(file: File) {
    const fd = new FormData();
    fd.append('avatar', file);
    return this.request<{ user: User }>('/api/upload/avatar', { method: 'POST', body: fd });
  }

  uploadBanner(file: File) {
    const fd = new FormData();
    fd.append('banner', file);
    return this.request<{ user: User }>('/api/upload/banner', { method: 'POST', body: fd });
  }

  // Roles & Moderation
  getRoles() {
    return this.request<{ roles: Role[] }>('/api/roles');
  }

  createRole(payload: { name: string; color: string; permissions?: Partial<RolePermissions>; hoist?: boolean }) {
    return this.request<{ role: Role }>('/api/roles', { method: 'POST', body: JSON.stringify(payload) });
  }

  updateRole(roleId: string, payload: { name?: string; color?: string; hoist?: boolean; position?: number; permissions?: Partial<RolePermissions> }) {
    return this.request<{ role: Role }>(`/api/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  reorderRoles(roleIds: string[]) {
    return this.request<{ roles: Role[] }>('/api/roles/reorder', { method: 'PUT', body: JSON.stringify({ roleIds }) });
  }

  deleteRole(roleId: string) {
    return this.request<{ ok: boolean }>(`/api/roles/${roleId}`, { method: 'DELETE' });
  }

  updateUserRole(userId: string, roleId: string, action: 'add' | 'remove') {
    return this.request<{ user: User }>(`/api/users/${userId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ roleId, action }),
    });
  }

  moderateVoice(payload: {
    targetUserId: string;
    serverMuted?: boolean;
    serverDeafened?: boolean;
    moveToChannelId?: string;
  }) {
    return this.request<{ ok: boolean; user: User }>('/api/moderation/voice', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  kickUser(targetUserId: string, reason = '') {
    return this.request<{ ok: boolean }>('/api/moderation/kick', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, reason }),
    });
  }

  getBans() {
    return this.request<{ bans: BanEntry[] }>('/api/moderation/bans');
  }

  banUser(targetUserId: string, reason = '') {
    return this.request<{ ok: boolean; bans: BanEntry[] }>('/api/moderation/ban', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, reason }),
    });
  }

  unbanUser(userId: string) {
    return this.request<{ ok: boolean; bans: BanEntry[] }>(`/api/moderation/bans/${userId}`, {
      method: 'DELETE',
    });
  }

  getAuditLogs(params?: { type?: string; q?: string }) {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.q) qs.set('q', params.q);
    return this.request<{ entries: AuditLogEntry[] }>(`/api/audit-logs?${qs.toString()}`);
  }

  // Storage & Cache Cap (2 GB)
  getStorageStats() {
    return this.request<{ storage: StorageStats }>('/api/storage');
  }

  clearStorageCache() {
    return this.request<{ ok: boolean; prunedCount: number; freedBytes: number; stats: StorageStats }>(
      '/api/storage/clear',
      { method: 'POST' }
    );
  }

  updateServer(payload: {
    name?: string;
    description?: string;
    iconColor?: string;
    bannerColor?: string;
    tags?: ServerTag[];
    clearIcon?: boolean;
    clearBanner?: boolean;
    invitePassword?: string;
    clearInvitePassword?: boolean;
    allowMembersCreateChannels?: boolean;
    tenorApiKey?: string;
    giphyApiKey?: string;
  }) {
    return this.request<{ server: ServerInfo }>('/api/server', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  uploadServerIcon(file: File) {
    const fd = new FormData();
    fd.append('icon', file);
    return this.request<{ server: ServerInfo }>('/api/server/icon', { method: 'POST', body: fd });
  }

  uploadServerBanner(file: File) {
    const fd = new FormData();
    fd.append('banner', file);
    return this.request<{ server: ServerInfo }>('/api/server/banner', { method: 'POST', body: fd });
  }

  getNetworkInfo() {
    return this.request<{ port: number; addresses: Array<{ name: string; address: string; url: string }> }>(
      '/api/network-info'
    );
  }

  getCategories() {
    return this.request<{ categories: ChannelCategory[] }>('/api/categories');
  }

  createCategory(payload: { name: string; isPrivate?: boolean }) {
    return this.request<{ category: ChannelCategory }>('/api/categories', { method: 'POST', body: JSON.stringify(payload) });
  }

  updateCategory(categoryId: string, payload: Partial<ChannelCategory>) {
    return this.request<{ category: ChannelCategory }>(`/api/categories/${categoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  deleteCategory(categoryId: string) {
    return this.request<{ ok: boolean }>(`/api/categories/${categoryId}`, { method: 'DELETE' });
  }

  createChannel(payload: { name: string; type: 'text' | 'voice'; topic?: string; categoryId?: string | null; isPrivate?: boolean }) {
    return this.request<{ channel: Channel }>('/api/channels', { method: 'POST', body: JSON.stringify(payload) });
  }

  updateChannel(
    channelId: string,
    payload: {
      name?: string;
      topic?: string;
      categoryId?: string | null;
      position?: number;
      slowModeSec?: number;
      visibility?: 'default' | 'spoiler' | 'nsfw';
      isPrivate?: boolean;
      bitrateKbps?: number;
      userLimit?: number;
      overwrites?: ChannelPermissionOverwrite[];
      syncWithCategory?: boolean;
    }
  ) {
    return this.request<{ channel: Channel }>(`/api/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  duplicateChannel(channelId: string) {
    return this.request<{ channel: Channel }>(`/api/channels/${channelId}/duplicate`, { method: 'POST' });
  }

  deleteChannel(channelId: string) {
    return this.request<{ ok: boolean }>(`/api/channels/${channelId}`, { method: 'DELETE' });
  }

  // Private Groups & Trello Boards
  getDmGroups() {
    return this.request<{ groups: PrivateGroup[] }>('/api/dm-groups');
  }

  createDmGroup(payload: { name: string; memberIds: string[]; iconDataUrl?: string | null }) {
    return this.request<{ group: PrivateGroup }>('/api/dm-groups', { method: 'POST', body: JSON.stringify(payload) });
  }

  updateDmGroup(
    groupId: string,
    payload: { name?: string; iconDataUrl?: string | null; clearIcon?: boolean; addMemberIds?: string[]; removeMemberId?: string }
  ) {
    return this.request<{ group: PrivateGroup }>(`/api/dm-groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  getDmGroupMessages(groupId: string) {
    return this.request<{ messages: ChatMessage[] }>(`/api/dm-groups/${groupId}/messages`);
  }

  getTrelloBoards(scopeKey: string) {
    return this.request<{ scopeKey: string; boards: TrelloBoard[] }>(`/api/trello?scopeKey=${encodeURIComponent(scopeKey)}`);
  }

  saveTrelloBoards(scopeKey: string, boards: TrelloBoard[]) {
    return this.request<{ ok: boolean; boards: TrelloBoard[] }>('/api/trello', {
      method: 'PUT',
      body: JSON.stringify({ scopeKey, boards }),
    });
  }

  getMessages(channelId: string) {
    return this.request<{ messages: ChatMessage[] }>(`/api/channels/${channelId}/messages`);
  }

  getChannelPins(channelId: string) {
    return this.request<{ pins: ChatMessage[] }>(`/api/channels/${channelId}/pins`);
  }

  pinChannelMessage(channelId: string, messageId: string, pinned?: boolean) {
    return this.request<{ ok: boolean; message: ChatMessage }>(
      `/api/channels/${channelId}/messages/${messageId}/pin`,
      {
        method: 'POST',
        body: JSON.stringify(typeof pinned === 'boolean' ? { pinned } : {}),
      }
    );
  }

  getDmMessages(peerUserId: string) {
    return this.request<{ messages: ChatMessage[]; pairKey: string }>(`/api/dms/${peerUserId}/messages`);
  }

  deleteMessage(channelId: string, messageId: string) {
    return this.request<{ ok: boolean }>(`/api/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
  }

  uploadChatFiles(
    files: File[],
    attachmentMeta?: Array<{ waveform?: number[]; durationSec?: number; isVoiceMessage?: boolean }>
  ) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (attachmentMeta && attachmentMeta.length > 0) {
      fd.append('attachmentMeta', JSON.stringify(attachmentMeta));
    }
    return this.request<{ attachments: Attachment[] }>('/api/upload/chat', { method: 'POST', body: fd });
  }

  /**
   * High-speed streaming upload up to 1.85 GB with live progress, speed (MB/s), and ETA!
   */
  uploadHeavyTransfer(
    file: File,
    oneTime: boolean,
    onProgress?: (info: { percent: number; loaded: number; total: number; speedMBps: number }) => void
  ): Promise<{ transfer: FileTransfer }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('oneTime', oneTime ? 'true' : 'false');
      fd.append('file', file);

      let lastTs = performance.now();
      let lastLoaded = 0;

      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const now = performance.now();
        const dt = Math.max(0.05, (now - lastTs) / 1000);
        const speedMBps = (evt.loaded - lastLoaded) / dt / (1024 * 1024);
        if (dt >= 0.25) {
          lastTs = now;
          lastLoaded = evt.loaded;
        }
        onProgress?.({
          percent: Math.min(100, Math.round((evt.loaded / evt.total) * 100)),
          loaded: evt.loaded,
          total: evt.total,
          speedMBps: Math.max(0, Number(speedMBps.toFixed(1))),
        });
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data?.error || `Falha no envio (HTTP ${xhr.status})`));
          }
        } catch {
          reject(new Error('Resposta inválida do servidor ao enviar arquivo.'));
        }
      };

      xhr.onerror = () => reject(new Error('Erro de rede ao enviar arquivo grande.'));
      xhr.open('POST', `${this.serverUrl}/api/transfers/upload?oneTime=${oneTime ? 'true' : 'false'}`);
      if (this.token) xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
      xhr.send(fd);
    });
  }

  uploadSound(file: File, meta: { name: string; emoji: string; color: string }) {
    const fd = new FormData();
    fd.append('audio', file);
    fd.append('name', meta.name);
    fd.append('emoji', meta.emoji);
    fd.append('color', meta.color);
    return this.request<{ sound: SoundItem }>('/api/upload/sound', { method: 'POST', body: fd });
  }

  deleteSound(soundId: string) {
    return this.request<{ ok: boolean }>(`/api/sounds/${soundId}`, { method: 'DELETE' });
  }

  uploadMusic(file: File, meta: { title?: string; artist?: string }) {
    const fd = new FormData();
    fd.append('audio', file);
    if (meta.title) fd.append('title', meta.title);
    if (meta.artist) fd.append('artist', meta.artist);
    return this.request<{ track: MusicTrack }>('/api/upload/music', { method: 'POST', body: fd });
  }

  deleteMusicTrack(trackId: string) {
    return this.request<{ ok: boolean }>(`/api/music/library/${trackId}`, { method: 'DELETE' });
  }

  searchGifs(query: string) {
    return this.request<{ provider: string; savedGifs: GifItem[]; results: GifItem[] }>(
      `/api/gifs?q=${encodeURIComponent(query)}`
    );
  }

  saveGif(payload: { title: string; tags?: string; url?: string; file?: File }) {
    const fd = new FormData();
    fd.append('title', payload.title);
    if (payload.tags) fd.append('tags', payload.tags);
    if (payload.url) fd.append('url', payload.url);
    if (payload.file) fd.append('gif', payload.file);
    return this.request<{ gif: GifItem }>('/api/gifs', { method: 'POST', body: fd });
  }

  deleteGif(gifId: string) {
    return this.request<{ ok: boolean }>(`/api/gifs/${gifId}`, { method: 'DELETE' });
  }

  // Media Unfurl & Watch-Party / Music URL Resolution
  unfurlMediaUrl(url: string) {
    return this.request<{ embed: MediaEmbedInfo | null }>(`/api/media/unfurl?url=${encodeURIComponent(url)}`);
  }

  resolveMediaUrl(url: string, mode: 'video' | 'audio') {
    return this.request<{
      mode: 'video' | 'audio';
      video?: VideoQueueItem;
      isPlaylist?: boolean;
      platform?: string;
      playlistTitle?: string;
      playlistThumbnail?: string;
      tracks?: MusicTrack[];
      track?: MusicTrack;
    }>('/api/media/resolve', {
      method: 'POST',
      body: JSON.stringify({ url, mode }),
    });
  }

  // 3D Blender Converter & Inspector
  convertBlendUrl(fileUrl: string) {
    return this.request<{
      convertedGlbUrl: string | null;
      metadata: BlendMetadata | null;
      hasHostBlender: boolean;
      conversionError?: string;
    }>('/api/3d/convert-blend', {
      method: 'POST',
      body: JSON.stringify({ fileUrl }),
    });
  }

  // In-App Auto-Updater
  getUpdateManifest() {
    return this.request<UpdateManifest>('/api/update/manifest');
  }

  publishInstallerUpdate(file: File, version: string, notes: string) {
    const fd = new FormData();
    fd.append('version', version);
    fd.append('notes', notes);
    fd.append('installer', file);
    return this.request<{ ok: boolean; manifest: UpdateManifest }>('/api/update/publish-installer', {
      method: 'POST',
      body: fd,
    });
  }
}
