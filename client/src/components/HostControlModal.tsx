import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Globe,
  Link2,
  Loader2,
  Power,
  Radio,
  Server,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { ApiClient } from '../lib/api';
import { AppMode, HostStatus } from '../types';
import { useEscapeToClose } from '../lib/useEscapeToClose';

interface HostControlModalProps {
  api?: ApiClient | null;
  appMode: AppMode;
  hostStatus: HostStatus | null;
  serverUrl: string;
  onSwitchToHost: () => Promise<void>;
  onSwitchToClient: () => Promise<void>;
  onStartTunnel: () => Promise<void>;
  onStopTunnel: () => Promise<void>;
  onClose: () => void;
}

export const HostControlModal: React.FC<HostControlModalProps> = ({
  api,
  appMode,
  hostStatus,
  serverUrl,
  onSwitchToHost,
  onSwitchToClient,
  onStartTunnel,
  onStopTunnel,
  onClose,
}) => {
  useEscapeToClose(onClose);
  const isElectron = Boolean(window.electronAPI?.isElectron);
  const [switching, setSwitching] = useState(false);
  const [copied, setCopied] = useState('');
  const [publishingUpdate, setPublishingUpdate] = useState(false);
  const [publishStatus, setPublishStatus] = useState('');

  const copy = (val: string) => {
    navigator.clipboard.writeText(val).catch(() => {});
    setCopied(val);
    window.setTimeout(() => setCopied(''), 1800);
  };

  const handleSelectHost = async () => {
    if (appMode === 'host' && hostStatus?.running) return;
    setSwitching(true);
    try {
      await onSwitchToHost();
    } finally {
      setSwitching(false);
    }
  };

  const handleSelectClient = async () => {
    setSwitching(true);
    try {
      await onSwitchToClient();
      onClose();
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#313338] border border-[#1e1f22] rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 bg-[#2b2d31] border-b border-[#1e1f22] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Modo do Aplicativo: Host ou Cliente</h3>
            <p className="text-xs text-[#949ba4] mt-0.5">
              Alterne entre hospedar o servidor automaticamente ou entrar no servidor de um amigo.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-[#949ba4] hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Mode Cards */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={switching || !isElectron}
              onClick={handleSelectHost}
              className={`p-3.5 rounded-lg border-2 text-left transition cursor-pointer disabled:opacity-60 ${
                appMode === 'host' && hostStatus?.running
                  ? 'bg-[#23a55a]/15 border-[#23a55a] text-white'
                  : 'bg-[#2b2d31] border-[#3f4147] hover:border-[#5865f2] text-[#dbdee1]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-lg bg-[#23a55a]/20 text-[#23a55a]">
                  <Server className="w-5 h-5" />
                </div>
                {appMode === 'host' && hostStatus?.running && (
                  <span className="text-[10px] font-bold bg-[#23a55a] text-white px-2 py-0.5 rounded-full">
                    ATIVO
                  </span>
                )}
              </div>
              <div className="font-bold text-sm text-white">Hospedar Servidor</div>
              <div className="text-[11px] text-[#949ba4] mt-0.5">
                {isElectron
                  ? 'Liga o servidor automaticamente neste PC.'
                  : 'Disponível no app Desktop (.exe).'}
              </div>
            </button>

            <button
              type="button"
              disabled={switching}
              onClick={handleSelectClient}
              className={`p-3.5 rounded-lg border-2 text-left transition cursor-pointer disabled:opacity-60 ${
                appMode === 'client'
                  ? 'bg-[#5865f2]/20 border-[#5865f2] text-white'
                  : 'bg-[#2b2d31] border-[#3f4147] hover:border-[#5865f2] text-[#dbdee1]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-lg bg-[#5865f2]/20 text-[#5865f2]">
                  <UserCheck className="w-5 h-5" />
                </div>
                {appMode === 'client' && (
                  <span className="text-[10px] font-bold bg-[#5865f2] text-white px-2 py-0.5 rounded-full">
                    ATIVO
                  </span>
                )}
              </div>
              <div className="font-bold text-sm text-white">Ser Cliente</div>
              <div className="text-[11px] text-[#949ba4] mt-0.5">
                Conectar no servidor de um amigo pelo IP ou link.
              </div>
            </button>
          </div>

          {switching && (
            <div className="flex items-center justify-center gap-2 text-xs text-[#dbdee1] py-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#5865f2]" />
              Aplicando modo...
            </div>
          )}

          {/* Active Host Details & Shareable IPs */}
          {appMode === 'host' && hostStatus?.running && (
            <div className="bg-[#2b2d31] border border-[#1e1f22] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-[#23a55a]">
                  <Radio className="w-4 h-4 animate-pulse" />
                  Servidor Hospedado Automaticamente (Porta {hostStatus.port})
                </div>
              </div>

              {/* Detected Radmin / LAN Addresses */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">
                  Envie para seus amigos (Radmin VPN / Rede Local):
                </div>
                {hostStatus.addresses.length > 0 ? (
                  hostStatus.addresses.map((a) => {
                    const bareIpv4 = hostStatus.port && hostStatus.port !== 3000 ? `${a.address}:${hostStatus.port}` : a.address;
                    return (
                      <div
                        key={a.url}
                        className="flex items-center justify-between bg-[#1e1f22] px-3 py-2 rounded-md"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] text-[#949ba4]">{a.name}</div>
                          <code className="text-sm font-bold text-[#4ade80]">{bareIpv4}</code>
                        </div>
                        <button
                          type="button"
                          onClick={() => copy(bareIpv4)}
                          className="px-2.5 py-1 bg-[#383a40] hover:bg-[#5865f2] text-white text-xs font-semibold rounded flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          {copied === bareIpv4 ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copied === bareIpv4 ? 'Copiado' : 'Copiar IPv4'}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <code className="block bg-[#1e1f22] px-3 py-2 rounded text-xs text-white">127.0.0.1</code>
                )}
              </div>

              {/* Optional 1-click Free Cloudflare HTTPS Tunnel */}
              <div className="pt-2 border-t border-[#3f4147]/60 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Globe className="w-4 h-4 text-[#5865f2]" />
                    Link Público Grátis (sem Radmin)
                  </div>
                  {hostStatus.tunnelStatus === 'connected' ? (
                    <button
                      type="button"
                      onClick={onStopTunnel}
                      className="px-2.5 py-1 rounded bg-[#da373c]/20 hover:bg-[#da373c] text-[#ff8b8d] hover:text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Power className="w-3 h-3" />
                      Desligar Túnel
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        hostStatus.tunnelStatus === 'downloading' || hostStatus.tunnelStatus === 'connecting'
                      }
                      onClick={onStartTunnel}
                      className="px-3 py-1 rounded bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      {hostStatus.tunnelStatus === 'downloading' || hostStatus.tunnelStatus === 'connecting' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                      {hostStatus.tunnelStatus === 'downloading'
                        ? 'Baixando túnel...'
                        : hostStatus.tunnelStatus === 'connecting'
                        ? 'Gerando link...'
                        : 'Gerar Link HTTPS'}
                    </button>
                  )}
                </div>

                {hostStatus.tunnelUrl && (
                  <div className="flex items-center justify-between bg-[#1e1f22] border border-[#5865f2]/50 px-3 py-2 rounded-md">
                    <code className="text-xs font-bold text-[#a5b4fc] truncate">{hostStatus.tunnelUrl}</code>
                    <button
                      type="button"
                      onClick={() => copy(hostStatus.tunnelUrl)}
                      className="px-2.5 py-1 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded flex items-center gap-1 cursor-pointer shrink-0 ml-2"
                    >
                      {copied === hostStatus.tunnelUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied === hostStatus.tunnelUrl ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                )}

                {hostStatus.tunnelError && (
                  <p className="text-[11px] text-[#f23f42]">{hostStatus.tunnelError}</p>
                )}
              </div>

              {/* Publish In-App Update to Friends on LAN */}
              {api && (
                <div className="pt-2 border-t border-[#3f4147]/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                        <Download className="w-4 h-4 text-[#4ade80]" />
                        Distribuir Atualizações pelo App (para seus amigos)
                      </div>
                      <p className="text-[10px] text-[#949ba4]">
                        Selecione o novo <code>PulseCord-Setup.exe</code> junto com o <code>.exe.sig.json</code> dele (os
                        dois ficam em dist-app). Sem a assinatura, os apps dos amigos recusam instalar.
                      </p>
                    </div>
                    <label className="px-2.5 py-1.5 rounded bg-[#23a55a] hover:bg-[#1a8245] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0">
                      {publishingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {publishingUpdate ? 'Enviando...' : 'Publicar .exe'}
                      <input
                        type="file"
                        accept=".exe,.json"
                        multiple
                        disabled={publishingUpdate}
                        className="hidden"
                        onChange={async (e) => {
                          const picked = Array.from(e.target.files || []);
                          e.target.value = '';
                          const f = picked.find((x) => /\.exe$/i.test(x.name));
                          const sigFile = picked.find((x) => /\.sig\.json$/i.test(x.name)) || null;
                          if (!f) return;
                          setPublishingUpdate(true);
                          setPublishStatus('');
                          try {
                            let ver = '';
                            if (sigFile) {
                              try {
                                ver = String(JSON.parse(await sigFile.text())?.version || '');
                              } catch {}
                            }
                            if (!ver) ver = window.prompt('Qual a versão desta atualização?', '3.0.1') || '3.0.1';
                            const res = await api.publishInstallerUpdate(
                              f,
                              ver,
                              `Atualização v${ver} publicada pelo Host.`,
                              sigFile
                            );
                            if (!sigFile) {
                              setPublishStatus(
                                'Publicado SEM assinatura: os apps vão recusar instalar. Envie de novo com o arquivo .exe.sig.json.'
                              );
                              return;
                            }
                            setPublishStatus(`Atualização v${res.manifest.version} publicada para todos os amigos!`);
                          } catch (err: unknown) {
                            setPublishStatus((err as Error).message || 'Erro ao publicar atualização.');
                          } finally {
                            setPublishingUpdate(false);
                          }
                        }}
                      />
                    </label>
                  </div>
                  {publishStatus && (
                    <div className="text-[11px] text-[#4ade80] font-semibold bg-[#1e1f22] px-2.5 py-1.5 rounded">
                      {publishStatus}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {appMode === 'client' && (
            <div className="bg-[#2b2d31] border border-[#1e1f22] rounded-lg p-3.5 text-xs text-[#b5bac1]">
              Conectado como cliente em: <code className="text-white font-semibold">{serverUrl}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
