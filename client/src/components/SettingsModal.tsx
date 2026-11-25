import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  Globe,
  HardDrive,
  Headphones,
  Keyboard,
  Loader2,
  LogOut,
  Mic,
  Palette,
  RefreshCw,
  ScrollText,
  Server,
  Shield,
  Sparkles,
  Trash2,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { ApiClient } from '../lib/api';
import { computeServerPermissions } from '../lib/permissions';
import {
  AudioSettings,
  Role,
  RolePermissions,
  ServerInfo,
  StorageStats,
  ThemeConfig,
  UpdateManifest,
  User,
} from '../types';
import { AppearanceSettingsTab } from './AppearanceSettingsTab';
import { formatBytes } from './FileTransferModal';
import { ServerAdminPanel } from './ServerAdminPanel';

export type SettingsTabId =
  | 'profile'
  | 'audio'
  | 'appearance'
  | 'network'
  | 'storage'
  | 'server'
  | 'roles'
  | 'members'
  | 'audit'
  | 'bans';

interface SettingsModalProps {
  initialTab: SettingsTabId;
  api?: ApiClient | null;
  serverUrl: string;
  user: User;
  users?: User[];
  server: ServerInfo | null;
  roles: Role[];
  permissions?: RolePermissions;
  audioSettings: AudioSettings;
  onUpdateAudioSettings: (next: AudioSettings) => void;
  themeConfig?: ThemeConfig;
  onUpdateThemeConfig?: (next: ThemeConfig) => void;
  updateManifest?: UpdateManifest | null;
  localVersion?: string;
  onCheckUpdates?: () => void;
  onApplyUpdate?: () => void;
  onOpenFullProfileEditor: () => void;
  onServerUpdated: (s: ServerInfo) => void;
  onRolesUpdated?: (r: Role[]) => void;
  onUsersUpdated?: (u: User[]) => void;
  onLogout?: () => void;
  onClose: () => void;
}

const SERVER_TABS = new Set<SettingsTabId>(['server', 'roles', 'members', 'audit', 'bans']);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  initialTab,
  api = null,
  serverUrl,
  user,
  users = [],
  server,
  roles,
  permissions,
  audioSettings,
  onUpdateAudioSettings,
  themeConfig,
  onUpdateThemeConfig,
  updateManifest,
  localVersion,
  onCheckUpdates,
  onApplyUpdate,
  onOpenFullProfileEditor,
  onServerUpdated,
  onRolesUpdated,
  onUsersUpdated,
  onLogout,
  onClose,
}) => {
  const effectivePerms = useMemo(
    () => permissions || computeServerPermissions(user, roles),
    [permissions, user, roles]
  );

  const [tab, setTab] = useState<SettingsTabId>(
    SERVER_TABS.has(initialTab) && !server ? 'profile' : initialTab
  );
  const [closeToTray, setCloseToTray] = useState<boolean>(true);

  // Devices & Mic Test + PTT capture
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [testingMic, setTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [capturingPtt, setCapturingPtt] = useState(false);
  const micTestCleanupRef = useRef<(() => void) | null>(null);

  // Storage (2 GB cap!)
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  const [networkAddresses, setNetworkAddresses] = useState<Array<{ name: string; address: string; url: string }>>([]);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((devs) => {
        setInputs(devs.filter((d) => d.kind === 'audioinput'));
        setOutputs(devs.filter((d) => d.kind === 'audiooutput'));
        setCameras(devs.filter((d) => d.kind === 'videoinput'));
      })
      .catch(() => {});

    window.electronAPI?.getCloseToTray?.().then((enabled) => {
      if (typeof enabled === 'boolean') setCloseToTray(enabled);
    }).catch(() => {});

    if (api && server) {
      api.getNetworkInfo().then((res) => setNetworkAddresses(res.addresses || [])).catch(() => {});
      api.getStorageStats().then((res) => setStorageStats(res.storage)).catch(() => {});
    }

    return () => {
      micTestCleanupRef.current?.();
    };
  }, [api, server]);

  // Capture custom Push-to-Talk hotkey
  useEffect(() => {
    if (!capturingPtt) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onUpdateAudioSettings({ ...audioSettings, pttKey: e.code });
      setCapturingPtt(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturingPtt, audioSettings, onUpdateAudioSettings]);

  const toggleMicTest = async () => {
    if (testingMic) {
      micTestCleanupRef.current?.();
      micTestCleanupRef.current = null;
      setTestingMic(false);
      setMicLevel(0);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: audioSettings.inputDeviceId ? { ideal: audioSettings.inputDeviceId } : undefined,
          echoCancellation: audioSettings.echoCancellation,
          noiseSuppression: audioSettings.noiseSuppression,
          autoGainControl: audioSettings.autoGainControl,
        },
      });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = audioSettings.inputVolume ?? 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(gain);
      gain.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const timer = window.setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setMicLevel(Math.min(100, Math.round((sum / data.length) * 2.1)));
      }, 60);
      setTestingMic(true);
      micTestCleanupRef.current = () => {
        window.clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
      };
    } catch {
      setStatusMsg('Não foi possível acessar o microfone para teste.');
    }
  };

  const handleClearCache = async () => {
    if (!api) return;
    setClearingCache(true);
    setStatusMsg('');
    try {
      const res = await api.clearStorageCache();
      setStorageStats(res.stats);
      setStatusMsg(`Cache limpo! ${res.prunedCount} arquivo(s) removido(s) (${formatBytes(res.freedBytes)} liberados). Mensagens antigas preservadas!`);
    } catch (err: unknown) {
      setStatusMsg((err as Error).message);
    } finally {
      setClearingCache(false);
    }
  };

  const copyText = (val: string) => {
    navigator.clipboard.writeText(val).catch(() => {});
    setCopiedUrl(val);
    window.setTimeout(() => setCopiedUrl(''), 1800);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[86vh] max-h-[720px] bg-[#313338] pc-modal border border-white/10 rounded-lg shadow-2xl overflow-hidden flex"
      >
        {/* Left Navigation */}
        <div className="w-54 shrink-0 bg-[#232428] border-r border-white/10 p-3 flex flex-col gap-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4] px-2.5 py-2">
            Configurações
          </div>
          <button
            type="button"
            onClick={() => setTab('profile')}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'profile' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            Meu Perfil & Nitro
          </button>
          <button
            type="button"
            onClick={() => setTab('audio')}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'audio' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
            }`}
          >
            <Headphones className="w-4 h-4" />
            Voz & Vídeo (PTT/VAD)
          </button>
          <button
            type="button"
            onClick={() => setTab('appearance')}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'appearance' ? 'bg-[#5865f2] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
            }`}
          >
            <Palette className="w-4 h-4" />
            Aparência & CSS IA
          </button>
          <button
            type="button"
            onClick={() => setTab('storage')}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'storage' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            Cache & Cofre (2 GB)
          </button>
          <button
            type="button"
            onClick={() => setTab('network')}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'network' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
            }`}
          >
            <Globe className="w-4 h-4" />
            Rede P2P / TURN
          </button>
          {server && (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4] px-2.5 pt-3 pb-1 border-t border-white/10 mt-2">
                Servidor
              </div>
              <button
                type="button"
                onClick={() => setTab('server')}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === 'server' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
                }`}
              >
                <Server className="w-4 h-4" />
                Perfil do Servidor
              </button>
              <button
                type="button"
                onClick={() => setTab('roles')}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === 'roles' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
                }`}
              >
                <Shield className="w-4 h-4" />
                Cargos & Permissões
              </button>
              <button
                type="button"
                onClick={() => setTab('members')}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === 'members' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
                }`}
              >
                <Users className="w-4 h-4" />
                Membros & Kick
              </button>
              {effectivePerms.viewAuditLog && (
                <button
                  type="button"
                  onClick={() => setTab('audit')}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                    tab === 'audit' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
                  }`}
                >
                  <ScrollText className="w-4 h-4" />
                  Registro de Auditoria
                </button>
              )}
              {effectivePerms.banMembers && (
                <button
                  type="button"
                  onClick={() => setTab('bans')}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                    tab === 'bans' ? 'bg-[#404249] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]'
                  }`}
                >
                  <Ban className="w-4 h-4" />
                  Banimentos
                </button>
              )}
            </>
          )}

          {onLogout && (
            <div className="mt-auto pt-3 border-t border-[#2b2d31]">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold text-[#f23f42] hover:bg-[#da373c]/15 cursor-pointer"
              >
                <span>Sair / Trocar Servidor</span>
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 py-4 border-b border-[#1e1f22] flex items-center justify-between">
            <h3 className="text-base font-bold text-white">
              {tab === 'profile' && 'Perfil Global & Personalização Nitro Grátis'}
              {tab === 'audio' && 'Voz e Vídeo (Estilo Discord)'}
              {tab === 'appearance' && 'Aparência, Temas Linux & Estúdio CSS com IA'}
              {tab === 'storage' && 'Armazenamento, Criptografia e Limite de 2 GB'}
              {tab === 'network' && 'Rede P2P & Atualizações pelo App'}
              {tab === 'server' && 'Perfil do Servidor, Banner, Tags & Acesso'}
              {tab === 'roles' && 'Cargos & Permissões do Servidor'}
              {tab === 'members' && 'Membros, Cargos & Expulsões'}
              {tab === 'audit' && 'Registro de Auditoria do Servidor'}
              {tab === 'bans' && 'Banimentos do Servidor'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#949ba4] hover:text-white hover:bg-[#383a40] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
            {statusMsg && (
              <div className="bg-[#5865f2]/20 border border-[#5865f2]/40 text-[#c7ccff] px-3 py-2 rounded-lg">
                {statusMsg}
              </div>
            )}

            {/* PROFILE TAB */}
            {tab === 'profile' && (
              <div className="bg-[#1e1f22] rounded-lg p-5 space-y-3 border border-[#35373c]">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Sparkles className="w-5 h-5 text-[#eb459e]" />
                  Editor Completo de Perfil & PulseNitro Grátis
                </div>
                <p className="text-[#b5bac1] leading-relaxed">
                  Altere sua foto de perfil, capa/banner, decoração animada do avatar, estilo do nome, status em balão,
                  bio e conexões (Steam, Twitch, Xbox). Tudo fica salvo no seu PC e{' '}
                  <strong>sincroniza automaticamente em qualquer servidor LAN</strong> que você entrar!
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenFullProfileEditor();
                  }}
                  className="px-4 py-2.5 bg-[#5865f2] hover:bg-[#4752c4] text-white font-bold rounded-lg cursor-pointer"
                >
                  Abrir Editor de Perfil Completo
                </button>
              </div>
            )}

            {/* VOICE & VIDEO TAB (Discord complete!) */}
            {tab === 'audio' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-bold uppercase text-[#b5bac1]">Dispositivo de Entrada</label>
                    <select
                      value={audioSettings.inputDeviceId}
                      onChange={(e) => onUpdateAudioSettings({ ...audioSettings, inputDeviceId: e.target.value })}
                      className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="">Padrão do Sistema</option>
                      {inputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microfone (${d.deviceId.slice(0, 6)})`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold uppercase text-[#b5bac1]">Dispositivo de Saída</label>
                    <select
                      value={audioSettings.outputDeviceId}
                      onChange={(e) => onUpdateAudioSettings({ ...audioSettings, outputDeviceId: e.target.value })}
                      className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="">Padrão do Sistema</option>
                      {outputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Saída (${d.deviceId.slice(0, 6)})`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Input & Output Volume Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#1e1f22] p-4 rounded-lg">
                  <div className="space-y-1.5">
                    <div className="flex justify-between font-bold text-white">
                      <span>Volume de Entrada</span>
                      <span className="font-mono text-[#4ade80]">{Math.round((audioSettings.inputVolume ?? 1) * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={audioSettings.inputVolume ?? 1}
                      onChange={(e) => onUpdateAudioSettings({ ...audioSettings, inputVolume: Number(e.target.value) })}
                      className="w-full accent-[#5865f2] cursor-pointer"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between font-bold text-white">
                      <span>Volume de Saída</span>
                      <span className="font-mono text-[#4ade80]">{Math.round((audioSettings.outputVolume ?? 1) * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={audioSettings.outputVolume ?? 1}
                      onChange={(e) => onUpdateAudioSettings({ ...audioSettings, outputVolume: Number(e.target.value) })}
                      className="w-full accent-[#5865f2] cursor-pointer"
                    />
                  </div>
                </div>

                {/* Input Mode: Voice Activity Detection vs Push-to-Talk! */}
                <div className="bg-[#1e1f22] p-4 rounded-lg space-y-3">
                  <div className="font-bold text-white text-sm">Modo de Entrada</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => onUpdateAudioSettings({ ...audioSettings, inputMode: 'vad' })}
                      className={`p-3 rounded-lg border text-left cursor-pointer ${
                        audioSettings.inputMode === 'vad'
                          ? 'bg-[#5865f2]/20 border-[#5865f2] text-white'
                          : 'bg-[#2b2d31] border-transparent text-[#b5bac1]'
                      }`}
                    >
                      <div className="font-bold">Detecção de Voz</div>
                      <div className="text-[11px] text-[#949ba4]">Transmite automaticamente ao falar</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateAudioSettings({ ...audioSettings, inputMode: 'ptt' })}
                      className={`p-3 rounded-lg border text-left cursor-pointer ${
                        audioSettings.inputMode === 'ptt'
                          ? 'bg-[#5865f2]/20 border-[#5865f2] text-white'
                          : 'bg-[#2b2d31] border-transparent text-[#b5bac1]'
                      }`}
                    >
                      <div className="font-bold">Pressione para Falar (PTT)</div>
                      <div className="text-[11px] text-[#949ba4]">Segure uma tecla para falar</div>
                    </button>
                  </div>

                  {audioSettings.inputMode === 'vad' ? (
                    <div className="space-y-2.5 pt-1">
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-white font-semibold">Determinar automaticamente sensibilidade de entrada</span>
                        <input
                          type="checkbox"
                          checked={audioSettings.vadAuto}
                          onChange={(e) => onUpdateAudioSettings({ ...audioSettings, vadAuto: e.target.checked })}
                          className="w-4 h-4 accent-[#5865f2]"
                        />
                      </label>
                      {!audioSettings.vadAuto && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[#b5bac1]">
                            <span>Sensibilidade manual (limite de abertura)</span>
                            <span className="font-mono text-white">{audioSettings.vadThreshold}%</span>
                          </div>
                          <input
                            type="range"
                            min={4}
                            max={80}
                            value={audioSettings.vadThreshold}
                            onChange={(e) =>
                              onUpdateAudioSettings({ ...audioSettings, vadThreshold: Number(e.target.value) })
                            }
                            className="w-full accent-[#23a55a] cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-[#2b2d31] px-3.5 py-2.5 rounded-lg">
                      <div>
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <Keyboard className="w-4 h-4 text-[#5865f2]" />
                          Tecla de Atalho (Pressione para Falar)
                        </div>
                        <div className="text-[11px] text-[#949ba4]">
                          Atual: <code className="text-[#4ade80] font-bold">{audioSettings.pttKey}</code>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCapturingPtt(true)}
                        className={`px-3 py-1.5 rounded-md font-bold cursor-pointer ${
                          capturingPtt ? 'bg-[#da373c] text-white animate-pulse' : 'bg-[#5865f2] text-white'
                        }`}
                      >
                        {capturingPtt ? 'Aperte qualquer tecla...' : 'Alterar Tecla'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Live Mic Test Meter */}
                <div className="bg-[#1e1f22] rounded-lg p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center gap-2">
                      <Mic className="w-4 h-4 text-[#23a55a]" />
                      Teste de Microfone
                    </span>
                    <button
                      type="button"
                      onClick={toggleMicTest}
                      className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                        testingMic ? 'bg-[#f23f42] text-white' : 'bg-[#5865f2] text-white'
                      }`}
                    >
                      {testingMic ? 'Parar Teste' : 'Testar Microfone'}
                    </button>
                  </div>
                  <div className="h-3 bg-[#2b2d31] rounded-full overflow-hidden relative">
                    <div
                      className="h-full bg-gradient-to-r from-[#23a55a] via-[#4ade80] to-[#f0b232] transition-all duration-75"
                      style={{ width: `${micLevel}%` }}
                    />
                    {audioSettings.inputMode === 'vad' && !audioSettings.vadAuto && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-white"
                        style={{ left: `${audioSettings.vadThreshold}%` }}
                      />
                    )}
                  </div>
                </div>

                {/* Audio Profile & Processing */}
                <div className="bg-[#1e1f22] rounded-lg p-4 space-y-2.5">
                  <div className="font-bold text-white">Processamento de Voz (Perfil: {audioSettings.inputProfile})</div>
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-sm text-white">Supressão de Ruído</span>
                    <input
                      type="checkbox"
                      checked={audioSettings.noiseSuppression}
                      onChange={(e) =>
                        onUpdateAudioSettings({
                          ...audioSettings,
                          inputProfile: 'custom',
                          noiseSuppression: e.target.checked,
                        })
                      }
                      className="w-4 h-4 accent-[#5865f2]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-sm text-white">Cancelamento de Eco</span>
                    <input
                      type="checkbox"
                      checked={audioSettings.echoCancellation}
                      onChange={(e) =>
                        onUpdateAudioSettings({
                          ...audioSettings,
                          inputProfile: 'custom',
                          echoCancellation: e.target.checked,
                        })
                      }
                      className="w-4 h-4 accent-[#5865f2]"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-sm text-white">Controle Automático de Ganho (AGC)</span>
                    <input
                      type="checkbox"
                      checked={audioSettings.autoGainControl}
                      onChange={(e) =>
                        onUpdateAudioSettings({
                          ...audioSettings,
                          inputProfile: 'custom',
                          autoGainControl: e.target.checked,
                        })
                      }
                      className="w-4 h-4 accent-[#5865f2]"
                    />
                  </label>
                </div>

                {/* Camera selector */}
                <div className="space-y-1">
                  <label className="font-bold uppercase text-[#b5bac1]">Câmera</label>
                  <select
                    value={audioSettings.videoDeviceId}
                    onChange={(e) => onUpdateAudioSettings({ ...audioSettings, videoDeviceId: e.target.value })}
                    className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="">Padrão do Sistema</option>
                    {cameras.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Câmera (${d.deviceId.slice(0, 6)})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* STORAGE & 2 GB AUTO-CACHE CAP TAB */}
            {tab === 'storage' && (
              <div className="space-y-4">
                <div className="bg-[#1e1f22] p-5 rounded-lg border border-[#35373c] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">Uso Atual de Cache no Servidor</span>
                    <span className="font-mono font-bold text-[#4ade80]">
                      {storageStats ? `${formatBytes(storageStats.totalBytes)} / 2.00 GB` : 'Carregando...'}
                    </span>
                  </div>

                  <div className="h-3.5 bg-[#2b2d31] rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        (storageStats?.percentUsed || 0) > 85 ? 'bg-[#f23f42]' : 'bg-gradient-to-r from-[#5865f2] to-[#23a55a]'
                      }`}
                      style={{ width: `${Math.max(2, storageStats?.percentUsed || 0)}%` }}
                    />
                  </div>

                  {storageStats && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                      <div className="bg-[#2b2d31] p-2.5 rounded-lg">
                        <div className="text-[#949ba4]">Arquivos Pesados</div>
                        <div className="font-mono font-bold text-white mt-0.5">
                          {formatBytes(storageStats.breakdown.transfersBytes)}
                        </div>
                      </div>
                      <div className="bg-[#2b2d31] p-2.5 rounded-lg">
                        <div className="text-[#949ba4]">Imagens & GIFs</div>
                        <div className="font-mono font-bold text-white mt-0.5">
                          {formatBytes(storageStats.breakdown.imagesBytes)}
                        </div>
                      </div>
                      <div className="bg-[#2b2d31] p-2.5 rounded-lg">
                        <div className="text-[#949ba4]">Músicas & Sons</div>
                        <div className="font-mono font-bold text-white mt-0.5">
                          {formatBytes(storageStats.breakdown.musicBytes + storageStats.breakdown.soundsBytes)}
                        </div>
                      </div>
                      <div className="bg-[#2b2d31] p-2.5 rounded-lg col-span-2 sm:col-span-3 flex items-center justify-between">
                        <span className="text-[#949ba4]">
                          🔐 Cofre de Mensagens (Comprimido gzip + Criptografado AES-256-GCM)
                        </span>
                        <span className="font-mono font-bold text-[#4ade80]">
                          {formatBytes(storageStats.breakdown.messagesVaultBytes)}
                        </span>
                      </div>
                    </div>
                  )}

                  <p className="text-[#949ba4] leading-relaxed">
                    O PulseCord limpa automaticamente os arquivos de mídia mais antigos antes de atingir 2 GB —{' '}
                    <strong>mas nunca apaga seu histórico de mensagens de texto antigas!</strong>
                  </p>

                  {effectivePerms.manageServer && (
                    <button
                      type="button"
                      disabled={clearingCache}
                      onClick={handleClearCache}
                      className="px-4 py-2 bg-[#da373c] hover:bg-[#b92d31] text-white font-bold rounded-lg flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {clearingCache ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Limpar Cache de Arquivos e Imagens Agora
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* APPEARANCE & CSS AI STUDIO TAB */}
            {tab === 'appearance' && themeConfig && onUpdateThemeConfig && (
              <AppearanceSettingsTab themeConfig={themeConfig} onUpdateTheme={onUpdateThemeConfig} />
            )}

            {/* NETWORK & IN-APP UPDATES TAB */}
            {tab === 'network' && (
              <div className="space-y-4">
                <div className="bg-[#232428] border border-[#5865f2]/35 p-4 rounded-lg space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm text-white">Atualizações Diretas pelo App (LAN OTA)</div>
                      <div className="text-[11px] text-[#949ba4] mt-0.5">
                        Sua versão: <code className="text-white font-bold">v{localVersion || '4.0.0'}</code>
                        {updateManifest && (
                          <>
                            {' '}• Servidor Host: <code className="text-[#4ade80] font-bold">v{updateManifest.version}</code>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {onCheckUpdates && (
                        <button
                          type="button"
                          onClick={onCheckUpdates}
                          className="px-3 py-1.5 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-white font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Verificar Agora
                        </button>
                      )}
                      {onApplyUpdate && updateManifest && (updateManifest.hasInstaller || updateManifest.hasUiBundle) && (
                        <button
                          type="button"
                          onClick={onApplyUpdate}
                          className="px-3 py-1.5 rounded-lg bg-[#23a55a] hover:bg-[#1a8245] text-white font-bold cursor-pointer"
                        >
                          Atualizar pelo App
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-[#949ba4]">
                    Sempre que o Host gerar ou carregar uma nova versão do PulseCord, você atualiza com 1 clique aqui
                    mesmo sem precisar reinstalar manualmente!
                  </p>
                </div>

                {Boolean(window.electronAPI?.isElectron) && (
                  <div className="bg-[#232428] border border-white/10 p-4 rounded-lg flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-sm text-white">Minimizar nos Ícones Ocultos ao Fechar (X)</div>
                      <p className="text-[11px] text-[#949ba4] mt-0.5">
                        Mantém sua chamada de voz e servidor ativos em segundo plano com consumo mínimo de RAM e FPS.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={closeToTray}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        setCloseToTray(next);
                        await window.electronAPI?.setCloseToTray?.(next);
                      }}
                      className="w-4 h-4 accent-[#23a55a] cursor-pointer shrink-0"
                    />
                  </div>
                )}

                <div className="bg-[#232428] p-4 rounded-lg space-y-2">
                  <div className="font-bold text-sm text-white">Rotas Rápidas LAN & P2P Adaptativo</div>
                  <p className="text-[#b5bac1] leading-relaxed">
                    O áudio, vídeo 1080p60 e controle remoto AnyDesk usam rotas P2P diretas com buffer de atraso mínimo
                    (<code className="text-white">playoutDelayHint = 0</code>) e DataChannel dedicado para respostas em
                    ~1 ms na LAN.
                  </p>
                  <div className="text-[11px] text-[#949ba4]">
                    Servidor atual: <code className="text-white">{serverUrl}</code>
                  </div>
                </div>

                <div className="bg-[#1e1f22] p-4 rounded-lg space-y-3">
                  <div className="font-bold text-white">Servidor TURN Opcional (NAT estrito na internet)</div>
                  <input
                    type="text"
                    value={audioSettings.customTurnUrl}
                    onChange={(e) => onUpdateAudioSettings({ ...audioSettings, customTurnUrl: e.target.value })}
                    placeholder="turn:global.relay.metered.ca:80"
                    className="w-full bg-[#2b2d31] border border-[#3f4147] rounded-lg px-3 py-2 text-white outline-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={audioSettings.customTurnUser}
                      onChange={(e) => onUpdateAudioSettings({ ...audioSettings, customTurnUser: e.target.value })}
                      placeholder="Usuário TURN"
                      className="bg-[#2b2d31] border border-[#3f4147] rounded-lg px-3 py-2 text-white outline-none"
                    />
                    <input
                      type="password"
                      value={audioSettings.customTurnCred}
                      onChange={(e) => onUpdateAudioSettings({ ...audioSettings, customTurnCred: e.target.value })}
                      placeholder="Credencial TURN"
                      className="bg-[#2b2d31] border border-[#3f4147] rounded-lg px-3 py-2 text-white outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SERVER ADMIN SECTIONS (Perfil do Servidor, Cargos & Permissões, Membros, Auditoria, Bans) */}
            {SERVER_TABS.has(tab) && server && api && (
              <div className="space-y-5">
                {tab === 'server' && networkAddresses.length > 0 && (
                  <div className="bg-[#1e1f22] p-4 rounded-lg space-y-2 border border-[#2e3035]">
                    <div className="font-bold text-sm text-white">IPv4s deste Servidor na Rede</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {networkAddresses.map((a) => (
                        <div key={a.url} className="flex items-center justify-between bg-[#2b2d31] px-3 py-2 rounded-lg">
                          <div>
                            <div className="text-[10px] text-[#949ba4]">{a.name}</div>
                            <code className="text-xs font-bold text-[#4ade80]">{a.address}</code>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyText(a.address)}
                            className="px-2.5 py-1 bg-[#383a40] hover:bg-[#5865f2] text-white rounded flex items-center gap-1 cursor-pointer"
                          >
                            {copiedUrl === a.address ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedUrl === a.address ? 'Copiado' : 'Copiar'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <ServerAdminPanel
                  section={tab as 'server' | 'roles' | 'members' | 'audit' | 'bans'}
                  server={server}
                  user={user}
                  users={users}
                  roles={roles}
                  permissions={effectivePerms}
                  api={api}
                  serverUrl={serverUrl}
                  onServerUpdated={onServerUpdated}
                  onRolesUpdated={(r) => onRolesUpdated?.(r)}
                  onUsersUpdated={(u) => onUsersUpdated?.(u)}
                  onNotify={(m) => setStatusMsg(m)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
