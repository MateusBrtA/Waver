import React from 'react';
import { Box, Download, Headphones, Plus, Radio, Settings } from 'lucide-react';
import { resolveMediaUrl } from '../lib/api';
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
}) => {
  const isHosting = appMode === 'host' && Boolean(hostStatus?.running);
  const isElectron = Boolean(window.electronAPI?.isElectron);

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

      {/* Active Connected/Hosted Server Icon (only when in/hosting a server) */}
      {server && (
        <div className="relative flex items-center justify-center w-full">
          {navArea === 'server' && <span className="absolute left-0 w-1 h-10 bg-white rounded-r-full transition-all" />}
          <button
            type="button"
            onClick={onSelectServer}
            onContextMenu={(e) => {
              if (!onServerContextMenu) return;
              e.preventDefault();
              e.stopPropagation();
              onServerContextMenu(e);
            }}
            title={`${server.name}${isHosting ? ' (Você está hospedando)' : ''} • Clique direito para opções`}
            className={`relative w-12 h-12 flex items-center justify-center font-bold text-base text-white shadow-md transition-all cursor-pointer overflow-hidden ${
              navArea === 'server' ? 'rounded-[16px]' : 'rounded-[24px] hover:rounded-[16px]'
            } ${isHosting ? 'ring-2 ring-[#23a55a]/70 ring-offset-2 ring-offset-[#1e1f22]' : ''}`}
            style={{ backgroundColor: server.iconUrl ? '#1e1f22' : server.iconColor || '#5865F2' }}
          >
            {server.iconUrl ? (
              <img
                src={resolveMediaUrl(serverUrl, server.iconUrl)}
                alt={server.name}
                className="w-full h-full object-cover"
              />
            ) : (
              server.name.slice(0, 2).toUpperCase()
            )}
            {inVoice && (
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#23a55a] border-2 border-[#1e1f22] flex items-center justify-center">
                <Radio className="w-2.5 h-2.5 text-white" />
              </span>
            )}
          </button>
        </div>
      )}

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
