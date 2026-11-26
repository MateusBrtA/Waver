const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  // Atalhos globais, notificações nativas e "Compartilhar no PulseCord"
  setGlobalShortcuts: (map) => ipcRenderer.invoke('shortcuts:set', map),
  setOverlayConfig: (cfg) => ipcRenderer.invoke('overlay:config', cfg),
  sendOverlayState: (state) => ipcRenderer.send('overlay:state', state),
  toggleOverlay: () => ipcRenderer.invoke('overlay:toggle'),
  setMediaActivity: (enabled) => ipcRenderer.invoke('media-activity:set', enabled),
  saveMediaFile: (name, bytes, kind) => ipcRenderer.invoke('media:save-file', name, bytes, kind),
  recordingOpen: (name) => ipcRenderer.invoke('recording:open', name),
  recordingAppend: (token, bytes) => ipcRenderer.invoke('recording:append', token, bytes),
  recordingClose: (token) => ipcRenderer.invoke('recording:close', token),
  revealMediaFile: (file) => ipcRenderer.invoke('media:reveal', file),
  onGlobalShortcut: (cb) => {
    const listener = (_e, action) => cb(action);
    ipcRenderer.on('shortcut:fired', listener);
    return () => ipcRenderer.removeListener('shortcut:fired', listener);
  },
  showNotification: (opts) => ipcRenderer.invoke('notify:show', opts),
  onNotificationClicked: (cb) => {
    const listener = (_e, route) => cb(route);
    ipcRenderer.on('notify:clicked', listener);
    return () => ipcRenderer.removeListener('notify:clicked', listener);
  },
  getShareMenu: () => ipcRenderer.invoke('share-menu:get'),
  setShareMenu: (enabled) => ipcRenderer.invoke('share-menu:set', enabled),
  takePendingShares: () => ipcRenderer.invoke('share:take-pending'),
  readSharedFile: (p) => ipcRenderer.invoke('share:read', p),
  clearPendingShares: () => ipcRenderer.invoke('share:clear'),
  onSharedFiles: (cb) => {
    const listener = (_e, list) => cb(list);
    ipcRenderer.on('share:files', listener);
    return () => ipcRenderer.removeListener('share:files', listener);
  },
  platform: process.platform,
  getDesktopSources: () => ipcRenderer.invoke('desktop:get-sources'),
  prepareScreenCapture: (opts) => ipcRenderer.invoke('desktop:prepare-screen-capture', opts),
  // Zero-Echo Process-Excluded WASAPI Loopback
  startProcessLoopback: () => ipcRenderer.invoke('loopback:start'),
  stopProcessLoopback: () => ipcRenderer.invoke('loopback:stop'),
  onLoopbackPcm: (cb) => {
    const listener = (_e, chunk) => cb(chunk);
    ipcRenderer.on('loopback:pcm', listener);
    return () => ipcRenderer.removeListener('loopback:pcm', listener);
  },
  // In-App Auto-Updater
  getLocalUpdateInfo: () => ipcRenderer.invoke('update:get-local-info'),
  applyUiUpdate: (serverUrl) => ipcRenderer.invoke('update:apply-ui-bundle', serverUrl),
  downloadAndInstallUpdate: (opts) => ipcRenderer.invoke('update:download-and-install', opts),
  onUpdateProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },
  // 3D Blender fallback & Theme persistence
  convertLocalBlend: (opts) => ipcRenderer.invoke('blender:convert-local', opts),
  loadThemeConfig: () => ipcRenderer.invoke('theme:load'),
  saveThemeConfig: (cfg) => ipcRenderer.invoke('theme:save', cfg),
  // Parsec-Grade Remote Control + Virtual Xbox 360 Controller (ViGEmBus)
  rcEnable: () => ipcRenderer.invoke('rc:enable'),
  rcDisable: () => ipcRenderer.invoke('rc:disable'),
  rcGetStatus: () => ipcRenderer.invoke('rc:get-status'),
  rcSetPermissions: (perms) => ipcRenderer.invoke('rc:set-permissions', perms),
  rcDisconnectGamepad: (slot) => ipcRenderer.invoke('rc:disconnect-gamepad', slot),
  rcRetryViGEm: () => ipcRenderer.invoke('rc:retry-vigem'),
  rcInstallViGEmBus: () => ipcRenderer.invoke('rc:install-vigembus'),
  rcExecuteInput: (evt) => ipcRenderer.send('rc:execute-input', evt),
  rcSetHostPriority: (enabled) => ipcRenderer.invoke('rc:set-host-priority', enabled),
  onRcHostActivity: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('rc:host-activity', listener);
    return () => ipcRenderer.removeListener('rc:host-activity', listener);
  },
  onRcEmergencyStopped: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('rc:emergency-stopped', listener);
    return () => ipcRenderer.removeListener('rc:emergency-stopped', listener);
  },
  onRcRumble: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('rc:rumble', listener);
    return () => ipcRenderer.removeListener('rc:rumble', listener);
  },
  onRcStatusChanged: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('rc:status-changed', listener);
    return () => ipcRenderer.removeListener('rc:status-changed', listener);
  },
  // Global Profile & Local Encrypted DM Archive
  loadGlobalProfile: () => ipcRenderer.invoke('profile:load'),
  saveGlobalProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  loadLocalDmVault: () => ipcRenderer.invoke('dm-vault:load'),
  saveLocalDmVault: (dmMap) => ipcRenderer.invoke('dm-vault:save', dmMap),
  // Automatic Game/App Activity Detector
  getActivityState: () => ipcRenderer.invoke('activity:get'),
  onActivityUpdated: (cb) => {
    const listener = (_e, st) => cb(st);
    ipcRenderer.on('activity:updated', listener);
    return () => ipcRenderer.removeListener('activity:updated', listener);
  },
  // Serverless LAN P2P Direct Messages & 1-on-1 Calls
  lanPeersGetSelf: () => ipcRenderer.invoke('lan-peers:self'),
  lanPeersGet: () => ipcRenderer.invoke('lan-peers:get'),
  lanPeersScan: () => ipcRenderer.invoke('lan-peers:scan'),
  lanPeersUpdateIdentity: (identity) => ipcRenderer.invoke('lan-peers:update-identity', identity),
  lanPeersSendDm: (payload) => ipcRenderer.invoke('lan-peers:send-dm', payload),
  lanPeersPinDm: (payload) => ipcRenderer.invoke('lan-peers:pin-dm', payload),
  lanPeersCallInvite: (payload) => ipcRenderer.invoke('lan-peers:call-invite', payload),
  lanPeersCallRespond: (payload) => ipcRenderer.invoke('lan-peers:call-respond', payload),
  lanCallTicket: (url, room) => ipcRenderer.invoke('lan-peers:call-ticket', { url, room }),
  onLanPeersUpdated: (cb) => {
    const listener = (_e, list) => cb(list);
    ipcRenderer.on('lan-peers:list', listener);
    return () => ipcRenderer.removeListener('lan-peers:list', listener);
  },
  onLanDmMessage: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('lan-peers:dm-message', listener);
    return () => ipcRenderer.removeListener('lan-peers:dm-message', listener);
  },
  onLanDmPinned: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('lan-peers:dm-pinned', listener);
    return () => ipcRenderer.removeListener('lan-peers:dm-pinned', listener);
  },
  onLanCallIncoming: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('lan-peers:call-incoming', listener);
    return () => ipcRenderer.removeListener('lan-peers:call-incoming', listener);
  },
  onLanCallResponded: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('lan-peers:call-responded', listener);
    return () => ipcRenderer.removeListener('lan-peers:call-responded', listener);
  },
  lanPeersGetGroups: () => ipcRenderer.invoke('lan-peers:get-groups'),
  lanPeersSaveGroup: (g) => ipcRenderer.invoke('lan-peers:save-group', g),
  lanPeersSendGroupMessage: (p) => ipcRenderer.invoke('lan-peers:send-group-dm', p),
  lanPeersPinGroupMessage: (p) => ipcRenderer.invoke('lan-peers:pin-group-dm', p),
  lanPeersGroupCallInvite: (p) => ipcRenderer.invoke('lan-peers:group-call-invite', p),
  lanPeersGetTrello: (scopeKey) => ipcRenderer.invoke('lan-peers:get-trello', scopeKey),
  lanPeersSyncTrello: (p) => ipcRenderer.invoke('lan-peers:sync-trello', p),
  onLanGroupUpdated: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('lan-peers:group-updated', listener);
    return () => ipcRenderer.removeListener('lan-peers:group-updated', listener);
  },
  onLanGroupMessage: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('lan-peers:group-message', listener);
    return () => ipcRenderer.removeListener('lan-peers:group-message', listener);
  },
  onLanGroupPinned: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('lan-peers:group-pinned', listener);
    return () => ipcRenderer.removeListener('lan-peers:group-pinned', listener);
  },
  onLanTrelloUpdated: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('lan-peers:trello-updated', listener);
    return () => ipcRenderer.removeListener('lan-peers:trello-updated', listener);
  },
  // Embedded Host & LAN Discovery
  hostStart: (opts) => ipcRenderer.invoke('host:start', opts),
  hostStop: () => ipcRenderer.invoke('host:stop'),
  hostStatus: () => ipcRenderer.invoke('host:status'),
  hostSetPassword: (password) => ipcRenderer.invoke('host:set-password', password),
  hostStartTunnel: () => ipcRenderer.invoke('host:start-tunnel'),
  hostStopTunnel: () => ipcRenderer.invoke('host:stop-tunnel'),
  onHostStatusChange: (cb) => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('host:status-changed', listener);
    return () => ipcRenderer.removeListener('host:status-changed', listener);
  },
  lanGetServers: () => ipcRenderer.invoke('lan:get-servers'),
  lanScanNow: () => ipcRenderer.invoke('lan:scan-now'),
  onLanServersUpdate: (cb) => {
    const listener = (_event, list) => cb(list);
    ipcRenderer.on('lan:servers-updated', listener);
    return () => ipcRenderer.removeListener('lan:servers-updated', listener);
  },
  // Window & System Tray controls
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  getCloseToTray: () => ipcRenderer.invoke('app:get-close-to-tray'),
  setCloseToTray: (enabled) => ipcRenderer.invoke('app:set-close-to-tray', enabled),
  quitApp: () => ipcRenderer.send('app:quit'),
  // tecla do push-to-talk chega pelo processo principal mesmo com foco num iframe (player do YouTube)
  copyImage: (url) => ipcRenderer.invoke('image:copy', url),
  copyImagePng: (dataUrl) => ipcRenderer.invoke('image:copy-png', dataUrl),
  saveImage: (url, name) => ipcRenderer.invoke('image:save', url, name),
  setPttKey: (code) => ipcRenderer.send('ptt:set-key', code || null),
  onPttKey: (cb) => {
    const listener = (_e, ev) => cb(ev);
    ipcRenderer.on('ptt:key', listener);
    return () => ipcRenderer.removeListener('ptt:key', listener);
  },
  onTrayToggleMute: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('tray:toggle-mute', listener);
    return () => ipcRenderer.removeListener('tray:toggle-mute', listener);
  },
  onTrayToggleDeafen: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('tray:toggle-deafen', listener);
    return () => ipcRenderer.removeListener('tray:toggle-deafen', listener);
  },
});
