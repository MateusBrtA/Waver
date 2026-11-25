import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Mic, Settings, Volume2 } from 'lucide-react';
import { AudioSettings } from '../types';

interface AudioQuickPopoutProps {
  kind: 'mic' | 'output' | 'camera';
  audioSettings: AudioSettings;
  onUpdateAudioSettings: (next: AudioSettings) => void;
  onOpenVoiceSettings: () => void;
  onClose: () => void;
}

const PROFILE_LABELS: Record<AudioSettings['inputProfile'], string> = {
  'voice-isolation': 'Isolamento de Voz',
  studio: 'Estúdio (Sem filtros)',
  custom: 'Personalizado',
};

export const AudioQuickPopout: React.FC<AudioQuickPopoutProps> = ({
  kind,
  audioSettings,
  onUpdateAudioSettings,
  onOpenVoiceSettings,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [expanded, setExpanded] = useState<'none' | 'device' | 'profile'>(kind === 'camera' ? 'device' : 'none');

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((list) => {
        setDevices(
          list.filter((d) => d.kind === (kind === 'mic' ? 'audioinput' : kind === 'camera' ? 'videoinput' : 'audiooutput'))
        );
      })
      .catch(() => {});
  }, [kind]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const currentDeviceId =
    kind === 'mic' ? audioSettings.inputDeviceId : kind === 'camera' ? audioSettings.videoDeviceId : audioSettings.outputDeviceId;
  const withDevice = (deviceId: string): AudioSettings =>
    kind === 'mic'
      ? { ...audioSettings, inputDeviceId: deviceId }
      : kind === 'camera'
      ? { ...audioSettings, videoDeviceId: deviceId }
      : { ...audioSettings, outputDeviceId: deviceId };
  const currentDeviceLabel =
    devices.find((d) => d.deviceId === currentDeviceId)?.label || 'Padrão do Sistema';

  return (
    <div
      ref={ref}
      className="fixed bottom-16 left-[120px] z-[96] w-[268px] bg-[#111214] border border-[#2b2d31] rounded-lg shadow-[0_14px_38px_rgba(0,0,0,0.8)] p-2 text-[13px] text-[#dbdee1] select-none animate-fade-up"
    >
      {/* Device selector section (Print 3 top block!) */}
      <button
        type="button"
        onClick={() => setExpanded((e) => (e === 'device' ? 'none' : 'device'))}
        className="w-full flex items-center justify-between px-2.5 py-2 rounded-[4px] hover:bg-[#2b2d31] text-left transition cursor-pointer"
      >
        <div className="min-w-0 pr-2">
          <div className="font-bold text-white text-[13px]">
            {kind === 'mic' ? 'Dispositivo de entrada' : kind === 'camera' ? 'Câmera' : 'Dispositivo de saída'}
          </div>
          <div className="text-[11px] text-[#949ba4] truncate">{currentDeviceLabel}</div>
        </div>
        <ChevronRight
          className={`w-4 h-4 text-[#949ba4] shrink-0 transition-transform ${
            expanded === 'device' ? 'rotate-90' : ''
          }`}
        />
      </button>

      {expanded === 'device' && (
        <div className="my-1 ml-1 pl-2 border-l border-[#35373c] space-y-0.5 max-h-40 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onUpdateAudioSettings(withDevice(''));
              setExpanded('none');
            }}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-[#35373c] cursor-pointer text-left"
          >
            <span className="truncate">Padrão do Sistema</span>
            {!currentDeviceId && <Check className="w-3.5 h-3.5 text-[#5865f2] shrink-0" />}
          </button>
          {devices.map((d) => (
            <button
              key={d.deviceId}
              type="button"
              onClick={() => {
                onUpdateAudioSettings(withDevice(d.deviceId));
                setExpanded('none');
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-[#35373c] cursor-pointer text-left"
            >
              <span className="truncate">{d.label || `Dispositivo ${d.deviceId.slice(0, 6)}`}</span>
              {currentDeviceId === d.deviceId && <Check className="w-3.5 h-3.5 text-[#5865f2] shrink-0" />}
            </button>
          ))}
        </div>
      )}

      {/* MIC ONLY: Input Profile & Input Mode (VAD vs PTT) */}
      {kind === 'mic' && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((e) => (e === 'profile' ? 'none' : 'profile'))}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-[4px] hover:bg-[#2b2d31] text-left transition cursor-pointer"
          >
            <div className="min-w-0 pr-2">
              <div className="font-bold text-white text-[13px]">Perfil de entrada</div>
              <div className="text-[11px] text-[#949ba4]">{PROFILE_LABELS[audioSettings.inputProfile]}</div>
            </div>
            <ChevronRight
              className={`w-4 h-4 text-[#949ba4] shrink-0 transition-transform ${
                expanded === 'profile' ? 'rotate-90' : ''
              }`}
            />
          </button>

          {expanded === 'profile' && (
            <div className="my-1 ml-1 pl-2 border-l border-[#35373c] space-y-0.5">
              {(['voice-isolation', 'studio', 'custom'] as const).map((prof) => (
                <button
                  key={prof}
                  type="button"
                  onClick={() => {
                    onUpdateAudioSettings({
                      ...audioSettings,
                      inputProfile: prof,
                      echoCancellation: prof !== 'studio',
                      noiseSuppression: prof !== 'studio',
                      autoGainControl: prof !== 'studio',
                    });
                    setExpanded('none');
                  }}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-[#35373c] cursor-pointer"
                >
                  <span>{PROFILE_LABELS[prof]}</span>
                  {audioSettings.inputProfile === prof && <Check className="w-3.5 h-3.5 text-[#5865f2]" />}
                </button>
              ))}
            </div>
          )}

          {/* Quick VAD vs PTT toggle */}
          <div className="my-1.5 border-t border-[#2b2d31] pt-2 px-2">
            <div className="text-[11px] font-bold text-[#949ba4] mb-1.5 flex items-center gap-1">
              <Mic className="w-3 h-3" />
              Modo de entrada
            </div>
            <div className="grid grid-cols-2 gap-1 bg-[#1e1f22] p-0.5 rounded-md text-[11px] font-bold">
              <button
                type="button"
                onClick={() => onUpdateAudioSettings({ ...audioSettings, inputMode: 'vad' })}
                className={`py-1 rounded cursor-pointer transition ${
                  audioSettings.inputMode === 'vad' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4] hover:text-white'
                }`}
              >
                Detecção de Voz
              </button>
              <button
                type="button"
                onClick={() => onUpdateAudioSettings({ ...audioSettings, inputMode: 'ptt' })}
                className={`py-1 rounded cursor-pointer transition ${
                  audioSettings.inputMode === 'ptt' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4] hover:text-white'
                }`}
              >
                Pressione ({audioSettings.pttKey.replace('Key', '')})
              </button>
            </div>
          </div>

          {/* Input Volume Slider (Print 3!) */}
          <div className="my-1.5 border-t border-[#2b2d31] pt-2.5 px-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white">Volume de entrada</span>
              <span className="font-mono text-[11px] text-[#b5bac1]">
                {Math.round((audioSettings.inputVolume ?? 1) * 100)}%
              </span>
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
        </>
      )}

      {/* OUTPUT ONLY: Master Output Volume, Soundboard & Music sliders */}
      {kind === 'output' && (
        <div className="my-1.5 border-t border-[#2b2d31] pt-2.5 px-2.5 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5" />
                Volume de saída
              </span>
              <span className="font-mono text-[11px] text-[#b5bac1]">
                {Math.round((audioSettings.outputVolume ?? 1) * 100)}%
              </span>
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

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[#b5bac1]">
              <span>Soundboard</span>
              <span className="font-mono">{Math.round(audioSettings.soundboardVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={audioSettings.soundboardVolume}
              onChange={(e) =>
                onUpdateAudioSettings({ ...audioSettings, soundboardVolume: Number(e.target.value) })
              }
              className="w-full accent-[#f0b232] cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[#b5bac1]">
              <span>Músicas</span>
              <span className="font-mono">{Math.round(audioSettings.musicVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={audioSettings.musicVolume}
              onChange={(e) => onUpdateAudioSettings({ ...audioSettings, musicVolume: Number(e.target.value) })}
              className="w-full accent-[#5865f2] cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Footer: Configurações de voz (Print 3 exact footer!) */}
      <div className="mt-2 pt-1.5 border-t border-[#2b2d31]">
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenVoiceSettings();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[4px] hover:bg-[#4752c4] hover:text-white font-semibold transition cursor-pointer"
        >
          <Settings className="w-4 h-4" />
          <span>Configurações de voz</span>
        </button>
      </div>
    </div>
  );
};
