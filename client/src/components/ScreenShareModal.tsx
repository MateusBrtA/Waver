import React, { useEffect, useState } from 'react';
import {
  AppWindow,
  Loader2,
  Monitor,
  MonitorPlay,
  RefreshCw,
  Sliders,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { DesktopSourceItem, ScreenShareConfig } from '../types';

interface ScreenShareModalProps {
  onClose: () => void;
  onStart: (config: ScreenShareConfig) => void;
}

export const ScreenShareModal: React.FC<ScreenShareModalProps> = ({ onClose, onStart }) => {
  const isElectron = Boolean(window.electronAPI?.isElectron);

  const [sources, setSources] = useState<DesktopSourceItem[]>([]);
  const [loadingSources, setLoadingSources] = useState(isElectron);
  const [sourceTab, setSourceTab] = useState<'screen' | 'window'>('screen');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');

  // Default to Automatic Adaptive 1080p60 Parsec-Speed Gaming Bitrate!
  const [qualityMode, setQualityMode] = useState<'auto' | 'manual'>('auto');
  const [resolution, setResolution] = useState<ScreenShareConfig['resolution']>('1080p');
  const [fps, setFps] = useState<30 | 60 | 120>(60);
  const [maxBitrateMbps, setMaxBitrateMbps] = useState<number>(22);
  const [contentMode, setContentMode] = useState<'motion' | 'detail'>('motion');
  const [shareAudio, setShareAudio] = useState<boolean>(true);
  const [lowLatencyGaming, setLowLatencyGaming] = useState<boolean>(true);

  const loadSources = async () => {
    if (!window.electronAPI?.getDesktopSources) return;
    setLoadingSources(true);
    try {
      const list = await window.electronAPI.getDesktopSources();
      setSources(list);
      const firstScreen = list.find((s) => s.kind === 'screen') || list[0];
      if (firstScreen && !selectedSourceId) setSelectedSourceId(firstScreen.id);
    } catch (err) {
      console.error('Erro ao listar telas:', err);
    } finally {
      setLoadingSources(false);
    }
  };

  useEffect(() => {
    if (isElectron) loadSources();
  }, [isElectron]);

  const filteredSources = sources.filter((s) => s.kind === sourceTab);
  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  const handleStart = () => {
    onStart({
      sourceId: isElectron ? selectedSourceId : undefined,
      label: selectedSource?.name || 'Transmissão de Tela',
      qualityMode,
      resolution: qualityMode === 'auto' ? '1080p' : resolution,
      fps: qualityMode === 'auto' ? 60 : fps,
      maxBitrateMbps: qualityMode === 'auto' ? (lowLatencyGaming ? 22 : 14) : maxBitrateMbps,
      contentMode,
      shareAudio,
      lowLatencyGaming,
    });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#2b2d31] border border-[#3f4147] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-5 py-4 border-b border-[#1e1f22] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#5865f2]/20 text-[#5865f2]">
              <MonitorPlay className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Transmitir Tela (1080p60 + Modo AnyDesk)</h3>
              <p className="text-xs text-[#949ba4]">
                Qualidade adaptativa automática para máxima velocidade em LAN e internet
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#949ba4] hover:text-white hover:bg-[#383a40] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {isElectron ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5 bg-[#1e1f22] p-1 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setSourceTab('screen')}
                    className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 cursor-pointer ${
                      sourceTab === 'screen' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4] hover:text-white'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    Telas ({sources.filter((s) => s.kind === 'screen').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceTab('window')}
                    className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 cursor-pointer ${
                      sourceTab === 'window' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4] hover:text-white'
                    }`}
                  >
                    <AppWindow className="w-3.5 h-3.5" />
                    Janelas / Jogos ({sources.filter((s) => s.kind === 'window').length})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={loadSources}
                  className="text-xs text-[#b5bac1] hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-[#383a40] cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingSources ? 'animate-spin' : ''}`} />
                  Atualizar
                </button>
              </div>

              {loadingSources ? (
                <div className="py-10 flex flex-col items-center justify-center text-[#949ba4] gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#5865f2]" />
                  <span className="text-xs">Capturando miniaturas das telas...</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-52 overflow-y-auto pr-1">
                  {filteredSources.map((src) => {
                    const selected = src.id === selectedSourceId;
                    return (
                      <button
                        key={src.id}
                        type="button"
                        onClick={() => setSelectedSourceId(src.id)}
                        className={`text-left rounded-lg overflow-hidden border-2 transition cursor-pointer bg-[#1e1f22] ${
                          selected
                            ? 'border-[#5865f2] ring-2 ring-[#5865f2]/40'
                            : 'border-[#3f4147] hover:border-[#6d6f78]'
                        }`}
                      >
                        <div className="aspect-video bg-black relative overflow-hidden">
                          <img src={src.thumbnailDataUrl} alt={src.name} className="w-full h-full object-contain" />
                        </div>
                        <div className="px-2 py-1.5 flex items-center gap-1.5">
                          {src.appIconDataUrl && (
                            <img src={src.appIconDataUrl} alt="" className="w-4 h-4 shrink-0 rounded-xs" />
                          )}
                          <span className="text-[11px] font-medium text-[#dbdee1] truncate">{src.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[#1e1f22] border border-[#3f4147] rounded-lg p-3.5 text-xs text-[#b5bac1] flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-[#5865f2] shrink-0 mt-0.5" />
              <p>Ao iniciar, escolha a tela ou janela desejada no seletor do navegador.</p>
            </div>
          )}

          {/* Auto vs Manual Quality Mode Switcher */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setQualityMode('auto')}
              className={`p-3 rounded-lg border-2 text-left transition cursor-pointer ${
                qualityMode === 'auto'
                  ? 'bg-[#23a55a]/15 border-[#23a55a] text-white'
                  : 'bg-[#232428] border-[#1e1f22] text-[#b5bac1] hover:border-[#4e5058]'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                <Sparkles className="w-4 h-4 text-[#4ade80]" />
                Automático (Recomendado)
              </div>
              <p className="text-[11px] text-[#949ba4] mt-1">
                1080p 60fps com ajuste inteligente de bitrate (até 20 Mbps na LAN, baixa latência para jogos e AnyDesk).
              </p>
            </button>

            <button
              type="button"
              onClick={() => setQualityMode('manual')}
              className={`p-3 rounded-lg border-2 text-left transition cursor-pointer ${
                qualityMode === 'manual'
                  ? 'bg-[#5865f2]/20 border-[#5865f2] text-white'
                  : 'bg-[#232428] border-[#1e1f22] text-[#b5bac1] hover:border-[#4e5058]'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                <Sliders className="w-4 h-4 text-[#a5b4fc]" />
                Manual (Avançado)
              </div>
              <p className="text-[11px] text-[#949ba4] mt-1">
                Escolha exatamente resolução (720p até 4K), FPS e teto fixo de bitrate.
              </p>
            </button>
          </div>

          {qualityMode === 'manual' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#232428] p-4 rounded-lg border border-[#1e1f22]">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1]">Resolução</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['720p', '1080p', '1440p', 'source'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setResolution(r)}
                      className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                        resolution === r ? 'bg-[#5865f2] text-white' : 'bg-[#1e1f22] text-[#b5bac1]'
                      }`}
                    >
                      {r === 'source' ? 'Fonte' : r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1]">FPS</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([30, 60, 120] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFps(f)}
                      className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                        fps === f ? 'bg-[#5865f2] text-white' : 'bg-[#1e1f22] text-[#b5bac1]'
                      }`}
                    >
                      {f} FPS
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1]">
                  Bitrate Máximo ({maxBitrateMbps} Mbps)
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[6, 12, 22, 28].map((mbps) => (
                    <button
                      key={mbps}
                      type="button"
                      onClick={() => setMaxBitrateMbps(mbps)}
                      className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                        maxBitrateMbps === mbps ? 'bg-[#23a55a] text-white' : 'bg-[#1e1f22] text-[#b5bac1]'
                      }`}
                    >
                      {mbps}M
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1]">Otimização</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setContentMode('motion')}
                    className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                      contentMode === 'motion' ? 'bg-[#5865f2] text-white' : 'bg-[#1e1f22] text-[#b5bac1]'
                    }`}
                  >
                    Jogos / Parsec
                  </button>
                  <button
                    type="button"
                    onClick={() => setContentMode('detail')}
                    className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                      contentMode === 'detail' ? 'bg-[#5865f2] text-white' : 'bg-[#1e1f22] text-[#b5bac1]'
                    }`}
                  >
                    Texto / Desktop
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Parsec ultra-low-latency gaming mode toggle */}
          <label className="flex items-center justify-between bg-[#232428] border border-[#5865f2]/35 rounded-lg px-4 py-3 cursor-pointer">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-[#22d3ee]" />
              <div>
                <div className="text-sm font-semibold text-white">Modo Parsec Ultra-Baixa Latência (Jogos & Controle)</div>
                <div className="text-xs text-[#949ba4]">
                  Jitter buffer 0ms, codec H.264/60-120fps e canal UDP paralelo para mouse, teclado e gamepad
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={lowLatencyGaming}
              onChange={(e) => setLowLatencyGaming(e.target.checked)}
              className="w-5 h-5 accent-[#22d3ee] cursor-pointer"
            />
          </label>

          {/* System audio toggle */}
          <label className="flex items-center justify-between bg-[#232428] border border-[#1e1f22] rounded-lg px-4 py-3 cursor-pointer">
            <div className="flex items-center gap-3">
              <Volume2 className="w-5 h-5 text-[#23a55a]" />
              <div>
                <div className="text-sm font-semibold text-white">Compartilhar áudio do sistema / jogo</div>
                <div className="text-xs text-[#949ba4]">
                  {isElectron ? 'Áudio estéreo nativo do Windows (WASAPI Loopback)' : 'Solicita áudio ao navegador'}
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={shareAudio}
              onChange={(e) => setShareAudio(e.target.checked)}
              className="w-5 h-5 accent-[#23a55a] cursor-pointer"
            />
          </label>
        </div>

        <div className="px-5 py-3.5 bg-[#232428] border-t border-[#1e1f22] flex items-center justify-between">
          <div className="text-xs text-[#949ba4]">
            Modo:{' '}
            <strong className="text-white">
              {qualityMode === 'auto'
                ? 'Automático • 1080p 60fps Adaptativo'
                : `${resolution === 'source' ? 'Nativa' : resolution} • ${fps} FPS • ${maxBitrateMbps} Mbps`}
            </strong>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#dbdee1] hover:underline cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={isElectron && !selectedSourceId}
              className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-lg cursor-pointer"
            >
              Iniciar Transmissão
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
