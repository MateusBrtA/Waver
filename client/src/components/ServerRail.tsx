import React, { useMemo, useState } from 'react';
import { Box, Download, Headphones, Loader2, Plus, Radio, Settings } from 'lucide-react';
import { resolveMediaUrl } from '../lib/api';
import { SavedServer, serverKey } from '../lib/savedServers';
import { AppMode, HostStatus, ServerInfo } from '../types';

interface ServerRailProps {
  server: ServerInfo | null;
  appMode: AppMode;
  hostStatus: HostStatus | null;
  serverUrl: string;
  navArea: 'server' | 'dms';
  unreadDmCount: number;
  inVoice: boolean;
  onSelectDms: () => void;
  onSelectServer: () => void;
  onOpenServerDirectory: () => void;
  onServerContextMenu?: (e: React.MouseEvent) => void;
  onOpen3DViewer: () => void;
  onOpenSettings: () => void;
  savedServers: SavedServer[];
  onSwitchServer: (entry: SavedServer) => Promise<unknown>;
  onRemoveSavedServer: (entry: SavedServer) => void;
}

export const ServerRail: React.FC<ServerRailProps> = ({
  server,
  appMode,
  hostStatus,
  serverUrl,
  navArea,
  unreadDmCount,
  inVoice,
  onSelectDms,
  onSelectServer,
  onOpenServerDirectory,
  onServerContextMenu,
  onOpen3DViewer,
  onOpenSettings,
  savedServers,
  onSwitchServer,
  onRemoveSavedServer,
}) => {
  const isElectron = Boolean(window.electronAPI?.isElectron);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const [brokenIcons, setBrokenIcons] = useState<Set<string>>(() => new Set());
  const activeKey = serverKey(serverUrl || '');
  // o servidor conectado sempre aparece, mesmo que ainda não esteja na lista salva
  const railEntries = useMemo(() => {
    if (!server || savedServers.some((s) => serverKey(s.serverUrl) === activeKey)) return savedServers;
    return [
      ...savedServers,
      { serverUrl, token: '', mode: appMode, name: server.name, iconColor: server.iconColor, iconUrl: server.iconUrl, lastUsedAt: 0 },
    ];
  }, [savedServers, server, serverUrl, activeKey, appMode]);

  return (
    <nav className="w-[72px] shrink-0 bg-[#1e1f22] pc-rail flex flex-col items-center py-3 gap-2 select-none z-20">
      {/* Authentic Discord Top Home / Direct Messages Button */}
      <div className="relative flex items-center justify-center w-full">
        {navArea === 'dms' && <span className="absolute left-0 w-1 h-10 bg-white rounded-r-full transition-all" />}
        <button
          type="button"
          onClick={onSelectDms}
          title="Mensagens Diretas e Chamadas Privadas (LAN)"
          className={`group relative w-12 h-12 flex items-center justify-center transition-all duration-200 cursor-pointer ${
            navArea === 'dms'
              ? 'rounded-[16px] bg-[#5865f2] text-white shadow-md'
              : 'rounded-[24px] hover:rounded-[16px] bg-[#313338] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white'
          }`}
        >
          <Headphones className="w-6 h-6" />
          {unreadDmCount > 0 && (
            <span className="absolute -bottom-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#f23f42] border-[3px] border-[#1e1f22] text-[10px] font-bold text-white flex items-center justify-center">
              {unreadDmCount > 9 ? '9+' : unreadDmCount}
            </span>
          )}
        </button>
      </div>

      {/* Thin divider */}
      <div className="w-8 h-[2px] rounded-full bg-[#35373c]" />

      {/* Servidores salvos: o conectado fica destacado, os outros trocam com um clique */}
      {railEntries.map((entry) => {
        const active = Boolean(server) && activeKey === serverKey(entry.serverUrl);
        const name = active && server ? server.name : entry.name;
        const iconUrl = active && server ? server.iconUrl : entry.iconUrl;
        const iconColor = (active && server ? server.iconColor : entry.iconColor) || '#5865F2';
        const hostingThis = entry.mode === 'host' && Boolean(hostStatus?.running);
        const busy = switchingKey === serverKey(entry.serverUrl);
        return (
          <div key={serverKey(entry.serverUrl)} className="group/srv relative flex items-center justify-center w-full">
            <span
              className={`absolute left-0 w-1 bg-white rounded-r-full transition-all ${
                active && navArea === 'server' ? 'h-10' : active ? 'h-2' : 'h-0 group-hover/srv:h-5'
              }`}
            />
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (active) {
                  onSelectServer();
                  return;
                }
                setSwitchingKey(serverKey(entry.serverUrl));
                try {
                  await onSwitchServer(entry);
                } finally {
                  setSwitchingKey(null);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (active && onServerContextMenu) {
                  onServerContextMenu(e);
                  return;
                }
                if (window.confirm(`Remover "${name}" da sua lista de servidores?`)) onRemoveSavedServer(entry);
              }}
              title={
                active
                  ? `${name}${hostingThis ? ' (você hospeda)' : ''} • clique direito para opções`
                  : `${name}${hostingThis ? ' (você hospeda)' : ''} • clique para entrar • clique direito para remover`
              }
              className={`relative w-12 h-12 flex items-center justify-center font-bold text-base text-white transition-all cursor-pointer overflow-hidden ${
                active && navArea === 'server' ? 'rounded-[16px]' : 'rounded-[24px] hover:rounded-[16px]'
              } ${busy ? 'opacity-60' : ''}`}
              style={{ backgroundColor: iconUrl ? '#1e1f22' : iconColor }}
            >
              {iconUrl && !brokenIcons.has(serverKey(entry.serverUrl)) ? (
                <img
                  src={resolveMediaUrl(active ? serverUrl : entry.serverUrl, iconUrl)}
                  alt={name}
                  className="w-full h-full object-cover"
                  onError={() =>
                    setBrokenIcons((prev) => new Set(prev).add(serverKey(entry.serverUrl)))
                  }
                />
              ) : (
                name.slice(0, 2).toUpperCase()
              )}
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </span>
              )}
            </button>
            {active && inVoice && (
              <span className="pointer-events-none absolute bottom-[-2px] right-[10px] w-4 h-4 rounded-full bg-[#23a55a] border-2 border-[#1e1f22] flex items-center justify-center">
                <Radio className="w-2.5 h-2.5 text-white" />
              </span>
            )}
            {hostingThis && !(active && inVoice) && (
              <span
                className="pointer-events-none absolute bottom-[-2px] right-[10px] w-3.5 h-3.5 rounded-full bg-[#23a55a] border-[3px] border-[#1e1f22]"
                title="Você hospeda este servidor"
              />
            )}
          </div>
        );
      })}

      {/* Discord-style "+" Add / Create or Join Server Button */}
      <button
        type="button"
        onClick={onOpenServerDirectory}
        title="Criar ou Entrar em um Servidor"
        className="group relative w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-[#2b2d31] hover:bg-[#23a55a] text-[#23a55a] hover:text-white flex items-center justify-center transition-all duration-200 cursor-pointer"
      >
        <Plus className="w-6 h-6" />
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onOpen3DViewer}
        title="Visualizador 3D / Blender Studio (.blend, .glb, .fbx, .obj)"
        className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-[#313338] hover:bg-[#ea7600] text-[#fb923c] hover:text-white flex items-center justify-center transition-all cursor-pointer"
      >
        <Box className="w-5 h-5" />
      </button>

      {!isElectron && Boolean(serverUrl) && (
        <a
          href={`${serverUrl}/api/download-client`}
          title="Baixar PulseCord (.exe) para Windows"
          className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-[#2b2d31] hover:bg-[#23a55a] text-[#23a55a] hover:text-white flex items-center justify-center transition-all"
        >
          <Download className="w-5 h-5" />
        </a>
      )}

      <button
        type="button"
        onClick={onOpenSettings}
        title="Configurações"
        className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-[#2b2d31] hover:bg-[#3f4147] text-[#b5bac1] hover:text-white flex items-center justify-center transition-all cursor-pointer"
      >
        <Settings className="w-5 h-5" />
      </button>
    </nav>
  );
};
