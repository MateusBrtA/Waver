import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  Lock,
  Plus,
  Radar,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { ApiClient, normalizeServerUrl } from '../lib/api';
import { LanServer, ServerInfo } from '../types';

interface ServerDirectoryModalProps {
  initialTab?: 'create' | 'join';
  lanServers: LanServer[];
  onScanLan: () => void;
  onCreateServer: (opts: {
    serverName: string;
    iconColor: string;
    iconDataUrl?: string | null;
    password: string;
  }) => Promise<void>;
  onJoinServer: (opts: { serverUrl: string; password: string }) => Promise<void>;
  onClose: () => void;
}

const COLORS = ['#5865F2', '#23A55A', '#F43F5E', '#F97316', '#8B5CF6', '#0EA5E9', '#EC4899'];

export const ServerDirectoryModal: React.FC<ServerDirectoryModalProps> = ({
  initialTab = 'create',
  lanServers,
  onScanLan,
  onCreateServer,
  onJoinServer,
  onClose,
}) => {
  const isElectron = Boolean(window.electronAPI?.isElectron);
  const [tab, setTab] = useState<'create' | 'join'>(isElectron ? initialTab : 'join');

  // Create server form
  const [serverName, setServerName] = useState('Servidor da Galera');
  const [iconColor, setIconColor] = useState('#5865F2');
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [createPassword, setCreatePassword] = useState('');
  const iconFileRef = useRef<HTMLInputElement | null>(null);

  // Join server form
  const [ipv4, setIpv4] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [probeOk, setProbeOk] = useState<ServerInfo | null>(null);
  const [probing, setProbing] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onScanLan();
  }, [onScanLan]);

  useEffect(() => {
    if (tab !== 'join') return;
    const raw = ipv4.trim();
    if (raw.length < 4) {
      setProbeOk(null);
      setNeedsPassword(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setProbing(true);
      try {
        const res = await new ApiClient(normalizeServerUrl(raw)).health();
        if (cancelled) return;
        setProbeOk(res.server);
        setNeedsPassword(Boolean(res.server?.hasInvitePassword));
        setError('');
      } catch {
        if (cancelled) return;
        setProbeOk(null);
      } finally {
        if (!cancelled) setProbing(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [tab, ipv4]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onCreateServer({
        serverName: serverName.trim() || 'Servidor da Galera',
        iconColor,
        iconDataUrl,
        password: createPassword.trim(),
      });
    } catch (err: unknown) {
      setError((err as Error).message || 'Não foi possível criar e hospedar o servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async (e?: React.FormEvent, overrideUrl?: string, requirePass?: boolean) => {
    e?.preventDefault();
    const target = (overrideUrl || ipv4).trim();
    if (!target) {
      setError('Digite o IPv4 do servidor ou escolha um encontrado na LAN.');
      return;
    }
    if ((requirePass || needsPassword) && !joinPassword.trim()) {
      setError('Este servidor exige senha. Digite a senha abaixo.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onJoinServer({
        serverUrl: normalizeServerUrl(target),
        password: joinPassword,
      });
    } catch (err: unknown) {
      setError((err as Error).message || 'Falha ao entrar no servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#2b2d31] border border-white/10 rounded-lg shadow-2xl overflow-hidden animate-fade-up"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-[#232428]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#5865f2]/20 text-[#5865f2] flex items-center justify-center">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Servidores</h3>
              <p className="text-[11px] text-[#949ba4]">
                Crie um servidor (você vira Host automaticamente) ou entre em um servidor na rede
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[#949ba4] hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isElectron && (
          <div className="grid grid-cols-2 p-2 gap-1.5 bg-[#232428] border-b border-white/10">
            <button
              type="button"
              onClick={() => {
                setTab('create');
                setError('');
              }}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                tab === 'create' ? 'bg-[#23a55a] text-white shadow' : 'bg-[#313338] text-[#b5bac1] hover:text-white'
              }`}
            >
              <Plus className="w-4 h-4" />
              Criar um Servidor
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('join');
                setError('');
                onScanLan();
              }}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                tab === 'join' ? 'bg-[#5865f2] text-white shadow' : 'bg-[#313338] text-[#b5bac1] hover:text-white'
              }`}
            >
              <Wifi className="w-4 h-4" />
              Entrar em um Servidor
            </button>
          </div>
        )}

        <div className="p-5 space-y-4">
          {tab === 'create' && isElectron ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-[#b5bac1] mb-1.5">
                  Nome do Servidor
                </label>
                <input
                  type="text"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  maxLength={40}
                  required
                  className="w-full bg-[#313338] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#23a55a]"
                  placeholder="Ex: Base dos Parças"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-[#b5bac1] mb-1.5">
                  Ícone e Cor do Servidor
                </label>
                <div className="flex items-center gap-3 mb-2.5">
                  <input
                    ref={iconFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = () => setIconDataUrl(typeof reader.result === 'string' ? reader.result : null);
                      reader.readAsDataURL(f);
                    }}
                  />
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center text-lg font-bold text-white overflow-hidden border border-white/10 shrink-0"
                    style={{ backgroundColor: iconColor }}
                  >
                    {iconDataUrl ? (
                      <img src={iconDataUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (serverName || 'S').slice(0, 1).toUpperCase()
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => iconFileRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-[#313338] hover:bg-[#1e222e] border border-white/10 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <ImagePlus className="w-3.5 h-3.5 text-[#5865f2]" />
                    Escolher foto do servidor
                  </button>
                  {iconDataUrl && (
                    <button
                      type="button"
                      onClick={() => setIconDataUrl(null)}
                      className="p-1.5 rounded-lg bg-[#f23f42]/15 text-[#f23f42] hover:bg-[#f23f42]/25 cursor-pointer"
                      title="Remover foto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setIconColor(c)}
                      className={`w-8 h-8 rounded-lg transition cursor-pointer ${
                        iconColor === c ? 'ring-2 ring-white scale-110' : 'opacity-75 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-[#b5bac1] mb-1.5">
                  Senha de Entrada (Opcional)
                </label>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Deixe vazio para acesso livre na LAN"
                  className="w-full bg-[#313338] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#23a55a]"
                />
              </div>

              <div className="bg-[#23a55a]/10 border border-[#23a55a]/30 rounded-lg px-3.5 py-2.5 text-[11px] text-[#b9f6ca] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#4ade80] shrink-0" />
                O servidor será hospedado automaticamente no seu PC e ficará visível na LAN para seus amigos!
              </div>

              {error && (
                <div className="bg-[#f23f42]/15 border border-[#f23f42]/40 text-[#ff8b8d] text-xs px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 rounded-lg bg-[#23a55a] hover:bg-[#1e8e4c] disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
                {submitting ? 'Iniciando servidor...' : 'Criar e Hospedar Agora'}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => handleJoin(e)} className="space-y-4">
              {/* Auto LAN Servers List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase text-[#b5bac1]">
                  <span className="flex items-center gap-1.5">
                    <Radar className="w-3.5 h-3.5 text-[#4ade80]" />
                    Servidores na Rede Local ({lanServers.length})
                  </span>
                  <button
                    type="button"
                    onClick={onScanLan}
                    className="text-[#00a8fc] hover:underline flex items-center gap-1 cursor-pointer normal-case font-semibold"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Buscar
                  </button>
                </div>

                {lanServers.length === 0 ? (
                  <div className="bg-[#313338] border border-white/5 rounded-lg p-3 text-xs text-[#949ba4]">
                    Nenhum servidor anunciado na rede local agora. Peça ao seu amigo o IPv4 dele!
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {lanServers.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-2 bg-[#313338] hover:bg-[#1c212d] border border-white/10 rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white flex items-center gap-1.5 truncate">
                            {s.hasPassword && <Lock className="w-3 h-3 text-[#f0b232] shrink-0" />}
                            {s.serverName}
                          </div>
                          <div className="text-[10px] text-[#949ba4] font-mono">
                            {s.ip}:{s.port} • {s.onlineCount} online
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIpv4(`${s.ip}:${s.port}`);
                            setNeedsPassword(s.hasPassword);
                            if (!s.hasPassword) handleJoin(undefined, s.url, false);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold cursor-pointer shrink-0"
                        >
                          {s.hasPassword ? 'Selecionar' : 'Entrar'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Manual IPv4 */}
              <div>
                <label className="block text-[11px] font-bold uppercase text-[#b5bac1] mb-1.5">
                  Ou cole o IPv4 do Host
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={ipv4}
                    onChange={(e) => setIpv4(e.target.value)}
                    placeholder="Ex: 26.15.40.12 ou 192.168.0.15"
                    className="w-full bg-[#313338] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono outline-none focus:border-[#5865f2]"
                  />
                  {probing && <Loader2 className="w-4 h-4 animate-spin text-[#949ba4] absolute right-3 top-3" />}
                  {!probing && probeOk && <CheckCircle2 className="w-4 h-4 text-[#4ade80] absolute right-3 top-3" />}
                </div>
                {probeOk && (
                  <div className="mt-1 text-[11px] text-[#4ade80]">
                    Servidor encontrado: <strong>{probeOk.name}</strong>
                  </div>
                )}
              </div>

              {(needsPassword || joinPassword) && (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-[#b5bac1] mb-1.5">
                    Senha do Servidor
                  </label>
                  <input
                    type="password"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    placeholder="Digite a senha fornecida pelo Host..."
                    className="w-full bg-[#313338] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#5865f2]"
                  />
                </div>
              )}

              {error && (
                <div className="bg-[#f23f42]/15 border border-[#f23f42]/40 text-[#ff8b8d] text-xs px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !ipv4.trim()}
                className="w-full py-2.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                {submitting ? 'Conectando...' : 'Entrar no Servidor'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
