import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Headphones,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  Sparkles,
  Users,
  Wifi,
} from 'lucide-react';
import { ApiClient, normalizeServerUrl } from '../lib/api';
import { AppMode, GlobalProfile, LanServer, ServerInfo, User } from '../types';

interface LoginScreenProps {
  initialServerUrl: string;
  lanServers: LanServer[];
  onScanLan: () => void;
  onLocalEnter: (identity: {
    displayName: string;
    username: string;
    avatarColor: string;
    avatarDataUrl?: string;
  }) => void;
  onAuthenticated: (data: {
    mode: AppMode;
    serverUrl: string;
    token: string;
    user: User;
    server: ServerInfo;
  }) => void;
}

type Step = 'local' | 'client';

const PROFILE_COLORS = ['#5865F2', '#23A55A', '#EB459E', '#F97316', '#0EA5E9', '#8B5CF6'];

function formatDisplayIpv4(ip: string, port: number): string {
  return port && port !== 3000 ? `${ip}:${port}` : ip;
}

function loadInitialGlobalProfile(): GlobalProfile {
  try {
    const raw = localStorage.getItem('pulsecord_global_profile');
    if (raw) return JSON.parse(raw) || {};
  } catch {
    // ignore
  }
  return {};
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  initialServerUrl,
  lanServers,
  onScanLan,
  onLocalEnter,
  onAuthenticated,
}) => {
  const isElectron = Boolean(window.electronAPI?.isElectron);
  const isDirectBrowserHost =
    !isElectron &&
    typeof window !== 'undefined' &&
    window.location.protocol.startsWith('http') &&
    window.location.port !== '5173';

  const savedGlobal = loadInitialGlobalProfile();

  const [step, setStep] = useState<Step>(() => (isDirectBrowserHost ? 'client' : 'local'));
  const [nick, setNick] = useState(() => savedGlobal.displayName || localStorage.getItem('pulsecord_last_nick') || '');
  const [avatarColor, setAvatarColor] = useState(savedGlobal.bannerColor || '#5865F2');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(savedGlobal.avatarDataUrl || undefined);

  // Direct IPv4 join state (for browser or direct-IP shortcut)
  const [clientIpv4, setClientIpv4] = useState(() => {
    if (isDirectBrowserHost) return window.location.host;
    const saved = initialServerUrl.replace(/^https?:\/\//i, '').replace(/:3000$/, '');
    return saved === 'localhost' || saved === '127.0.0.1' ? '' : saved;
  });
  const [clientServerPassword, setClientServerPassword] = useState('');
  const [showClientPass, setShowClientPass] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    info?: ServerInfo;
    hasExe?: boolean;
    error?: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanningPulse, setScanningPulse] = useState(false);

  const clientPassInputRef = useRef<HTMLInputElement>(null);
  const clientNickInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step !== 'client') return;
    const raw = clientIpv4.trim();
    if (raw.length < 4) {
      setProbeResult(null);
      setPasswordRequired(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setProbing(true);
      try {
        const normalized = normalizeServerUrl(raw);
        const client = new ApiClient(normalized);
        const res = await client.health();
        if (cancelled) return;
        setProbeResult({
          ok: true,
          info: res.server,
          hasExe: Boolean((res as { hasDownloadableExe?: boolean }).hasDownloadableExe),
        });
        setPasswordRequired(Boolean(res.server?.hasInvitePassword));
        setError('');
      } catch {
        if (cancelled) return;
        setProbeResult({ ok: false, error: 'Nenhum servidor encontrado neste IPv4 ainda.' });
      } finally {
        if (!cancelled) setProbing(false);
      }
    }, 360);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, clientIpv4]);

  const handlePickAvatar = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setAvatarDataUrl(dataUrl);
    } catch {
      // ignore
    }
  };

  const handleLocalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = nick.trim();
    if (trimmed.length < 2) {
      setError('Digite um nick com pelo menos 2 caracteres.');
      return;
    }
    const cleanUser =
      trimmed
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '')
        .slice(0, 24) || trimmed.toLowerCase().slice(0, 24);
    try {
      localStorage.setItem('pulsecord_last_nick', trimmed);
      const nextGlobal: GlobalProfile = {
        ...savedGlobal,
        displayName: trimmed,
        bannerColor: savedGlobal.bannerColor || avatarColor,
        avatarDataUrl,
      };
      localStorage.setItem('pulsecord_global_profile', JSON.stringify(nextGlobal));
    } catch {
      // ignore
    }
    onLocalEnter({
      displayName: trimmed,
      username: cleanUser,
      avatarColor,
      avatarDataUrl,
    });
  };

  const handleSelectLanServer = (srv: LanServer) => {
    setError('');
    setClientIpv4(formatDisplayIpv4(srv.ip, srv.port));
    setPasswordRequired(srv.hasPassword);
    setProbeResult({
      ok: true,
      info: {
        name: srv.serverName,
        description: '',
        iconColor: '#5865F2',
        hasInvitePassword: srv.hasPassword,
        allowMembersCreateChannels: true,
        hasTenorKey: false,
        hasGiphyKey: false,
      },
    });
    setStep('client');
    window.setTimeout(() => {
      if (!nick.trim()) clientNickInputRef.current?.focus();
      else if (srv.hasPassword) clientPassInputRef.current?.focus();
    }, 80);
  };

  const handleManualLanRefresh = () => {
    setScanningPulse(true);
    onScanLan();
    window.setTimeout(() => setScanningPulse(false), 900);
  };

  const handleClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedIp = clientIpv4.trim();
    const trimmedNick = nick.trim();

    if (!trimmedIp) {
      setError('Cole o IPv4 do Host ou clique em um servidor encontrado na rede.');
      return;
    }
    if (trimmedNick.length < 2) {
      setError('Digite um nick com pelo menos 2 letras.');
      return;
    }

    setLoading(true);
    try {
      const targetUrl = normalizeServerUrl(trimmedIp);
      const client = new ApiClient(targetUrl);
      const res = await client.login({
        username: trimmedNick,
        displayName: trimmedNick,
        invitePassword: clientServerPassword.trim() || undefined,
      });

      localStorage.setItem('pulsecord_last_nick', trimmedNick);
      onAuthenticated({
        mode: 'client',
        serverUrl: targetUrl,
        token: res.token,
        user: res.user,
        server: res.server,
      });
    } catch (err: unknown) {
      const eObj = err as Error & { code?: string; status?: number };
      if (eObj.code === 'SERVER_PASSWORD_REQUIRED' || eObj.status === 403) {
        setPasswordRequired(true);
        window.setTimeout(() => clientPassInputRef.current?.focus(), 60);
      }
      setError(eObj.message || 'Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center relative overflow-y-auto p-4 sm:p-6 bg-[#111216]">
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        style={{
          background:
            'radial-gradient(ellipse at 18% 15%, rgba(88, 101, 242, 0.34) 0%, transparent 48%), radial-gradient(ellipse at 85% 85%, rgba(35, 165, 90, 0.22) 0%, transparent 48%), linear-gradient(155deg, #161826 0%, #14161e 50%, #232428 100%)',
        }}
      />

      <div className="relative z-10 w-full max-w-[520px] animate-fade-up">
        {step === 'local' && (
          <form
            onSubmit={handleLocalSubmit}
            className="bg-[#2b2d31]/95 rounded-lg border border-white/10 shadow-[0_24px_65px_rgba(0,0,0,0.65)] overflow-hidden"
          >
            <div className="px-7 pt-7 pb-5 text-center border-b border-white/5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#5865f2]/15 border border-[#5865f2]/35 text-[#a5b4fc] text-[11px] font-bold tracking-wide mb-3.5">
                <Sparkles className="w-3.5 h-3.5" />
                Chat Privado LAN P2P • Parsec Gaming • 1080p120
              </div>

              <div className="flex items-center justify-center gap-3 mb-1.5">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#5865f2] to-[#4752c4] flex items-center justify-center shadow-xl shadow-[#5865f2]/30 relative">
                  <Headphones className="w-6 h-6 text-white" />
                  <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#23a55a] border-[3px] border-[#2b2d31]" />
                </div>
                <div className="text-left">
                  <h1 className="text-2xl font-bold text-white tracking-tight">PulseCord v4</h1>
                  <p className="text-xs text-[#949ba4]">Entre direto e crie servidores ou chame no privado pela LAN</p>
                </div>
              </div>
            </div>

            <div className="p-7 space-y-5">
              {/* Avatar Preview & Color Picker */}
              <div className="flex items-center gap-4 bg-[#1e1f22] border border-white/5 rounded-lg p-3.5">
                <label className="relative w-16 h-16 rounded-full shrink-0 cursor-pointer group overflow-hidden flex items-center justify-center text-xl font-bold text-white border-2 border-white/15" style={{ backgroundColor: avatarColor }}>
                  {avatarDataUrl ? (
                    <img src={avatarDataUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    (nick.trim() || 'PC').slice(0, 2).toUpperCase()
                  )}
                  <span className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                    <Camera className="w-5 h-5 text-white" />
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handlePickAvatar(e.target.files?.[0])}
                  />
                </label>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-xs font-semibold text-white">Foto Global para Servidores e LAN</div>
                  <div className="flex items-center gap-1.5">
                    {PROFILE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setAvatarColor(c)}
                        className={`w-5 h-5 rounded-full cursor-pointer transition ${
                          avatarColor === c ? 'ring-2 ring-white scale-110' : 'opacity-75 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1]">
                  Seu Apelido (Nick) <span className="text-[#f23f42]">*</span>
                </label>
                <input
                  type="text"
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  placeholder="Como seus amigos vão te ver (ex: Alex)"
                  maxLength={24}
                  autoFocus
                  required
                  className="w-full bg-[#1e1f22] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-4 py-3 text-sm text-white placeholder-[#6d6f78] outline-none transition"
                />
              </div>

              {error && (
                <div className="bg-[#da373c]/15 border border-[#da373c]/40 text-[#ff9396] text-xs px-3.5 py-2.5 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3.5 bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-bold text-sm rounded-lg transition shadow-lg shadow-[#5865f2]/25 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Entrar no PulseCord</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="flex items-center justify-between text-[11px] text-[#949ba4] pt-1">
                <span>Você decide dentro do app se quer criar servidor (+).</span>
                <button
                  type="button"
                  onClick={() => {
                    onScanLan();
                    setStep('client');
                  }}
                  className="text-[#808cf8] hover:underline font-semibold cursor-pointer shrink-0 ml-2"
                >
                  Entrar por IPv4 →
                </button>
              </div>
            </div>
          </form>
        )}

        {step === 'client' && (
          <form
            onSubmit={handleClientSubmit}
            className="bg-[#2b2d31]/95 rounded-lg border border-white/10 shadow-[0_24px_65px_rgba(0,0,0,0.65)] overflow-hidden"
          >
            <div className="px-6 py-4 bg-[#2b2d31] border-b border-white/5 flex items-center justify-between">
              {!isDirectBrowserHost ? (
                <button
                  type="button"
                  onClick={() => setStep('local')}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#b5bac1] hover:text-white transition cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Voltar
                </button>
              ) : (
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Headphones className="w-4 h-4 text-[#5865f2]" />
                  PulseCord
                </div>
              )}

              <div className="flex items-center gap-2">
                {!isElectron && probeResult?.hasExe && (
                  <a
                    href={`${normalizeServerUrl(clientIpv4)}/api/download-client`}
                    className="px-2.5 py-1 rounded-md bg-[#23a55a] hover:bg-[#1e8e4c] text-white text-[11px] font-bold flex items-center gap-1 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar App (.exe)
                  </a>
                )}
                <span className="text-xs font-bold text-[#a5b4fc] bg-[#5865f2]/20 px-2.5 py-1 rounded-full">
                  Conectar a Servidor
                </span>
              </div>
            </div>

            <div className="p-7 space-y-5">
              {lanServers.length > 0 && (
                <div className="bg-[#1e1f22] rounded-lg border border-[#23a55a]/35 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#4ade80] flex items-center gap-1.5">
                      <Wifi className="w-3.5 h-3.5" />
                      Servidores na Rede ({lanServers.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleManualLanRefresh}
                      className="text-[11px] text-[#949ba4] hover:text-white cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${scanningPulse ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {lanServers.map((srv) => {
                      const disp = formatDisplayIpv4(srv.ip, srv.port);
                      const isSelected = clientIpv4.trim() === disp;
                      return (
                        <button
                          key={srv.id}
                          type="button"
                          onClick={() => handleSelectLanServer(srv)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition cursor-pointer border ${
                            isSelected
                              ? 'bg-[#23a55a]/15 border-[#23a55a] text-white'
                              : 'bg-[#2b2d31] hover:bg-[#252936] border-transparent text-[#dbdee1]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white flex items-center gap-1.5">
                              <span>{srv.serverName}</span>
                              {srv.hasPassword ? (
                                <Lock className="w-3 h-3 text-[#f0b232]" />
                              ) : (
                                <LockOpen className="w-3 h-3 text-[#23a55a]" />
                              )}
                            </div>
                            <div className="text-[11px] text-[#949ba4] flex items-center gap-1.5">
                              <code>{disp}</code>
                              <span>•</span>
                              <span>{srv.networkLabel}</span>
                              <span>•</span>
                              <span className="inline-flex items-center gap-0.5">
                                <Users className="w-3 h-3" />
                                {srv.onlineCount}
                              </span>
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-[#4ade80] shrink-0">
                            {isSelected ? 'Selecionado ✓' : 'Usar'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1]">
                  IPv4 do Servidor <span className="text-[#f23f42]">*</span>
                </label>
                <input
                  type="text"
                  value={clientIpv4}
                  onChange={(e) => setClientIpv4(e.target.value)}
                  placeholder="Ex: 26.15.40.12 ou 192.168.1.10"
                  autoFocus={!clientIpv4}
                  required
                  className="w-full bg-[#1e1f22] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-4 py-3 text-base font-mono text-white placeholder-[#6d6f78] outline-none transition"
                />
                <div className="min-h-[20px] flex items-center">
                  {probing ? (
                    <span className="text-[11px] text-[#949ba4] flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin text-[#5865f2]" />
                      Verificando servidor...
                    </span>
                  ) : probeResult?.ok && probeResult.info ? (
                    <span className="text-xs text-[#4ade80] flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Conectável: {probeResult.info.name}
                    </span>
                  ) : probeResult && !probeResult.ok ? (
                    <span className="text-[11px] text-[#f0b232]">{probeResult.error}</span>
                  ) : (
                    <span className="text-[11px] text-[#949ba4]">Aceita IPv4 direto ou link trycloudflare.com.</span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1]">
                  Seu Nick <span className="text-[#f23f42]">*</span>
                </label>
                <input
                  ref={clientNickInputRef}
                  type="text"
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  placeholder="Como você quer aparecer na call"
                  maxLength={24}
                  autoFocus={Boolean(clientIpv4)}
                  required
                  className="w-full bg-[#1e1f22] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-4 py-3 text-sm text-white outline-none transition"
                />
              </div>

              {passwordRequired && (
                <div className="space-y-1.5 animate-fade-up">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#f0b232] flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    Senha do Servidor <span className="text-[#f23f42]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      ref={clientPassInputRef}
                      type={showClientPass ? 'text' : 'password'}
                      value={clientServerPassword}
                      onChange={(e) => setClientServerPassword(e.target.value)}
                      placeholder="Digite a senha do servidor..."
                      required
                      className="w-full bg-[#1e1f22] border border-[#f0b232]/60 focus:border-[#f0b232] rounded-lg pl-4 pr-10 py-3 text-sm text-white outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowClientPass((v) => !v)}
                      className="absolute right-3 top-3 text-[#949ba4] hover:text-white cursor-pointer"
                    >
                      {showClientPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-[#da373c]/15 border border-[#da373c]/40 text-[#ff9396] text-xs px-3.5 py-2.5 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] disabled:opacity-50 text-white font-bold text-sm rounded-lg transition shadow-lg shadow-[#5865f2]/25 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Entrar no Servidor</span>
                {!loading && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
