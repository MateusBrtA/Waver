import React, { useState } from 'react';
import { Loader2, Plus, Trash2, Upload, Volume2, VolumeX, X, Zap } from 'lucide-react';
import { ApiClient } from '../lib/api';
import { SoundItem, User } from '../types';

const PRESET_EMOJIS = ['📢', '💥', '🥁', '🎺', '🏆', '🚨', '😂', '💀', '🔥', '🎵', '👻', '🐸', '⚡', '👏'];
const PRESET_COLORS = ['#5865F2', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#a855f7', '#ec4899'];

interface SoundboardPanelProps {
  api?: ApiClient | null;
  user: User;
  sounds: SoundItem[];
  volume: number;
  onVolumeChange: (val: number) => void;
  onPlaySound: (soundId: string) => void;
  onStopAll: () => void;
  onClose: () => void;
}

export const SoundboardPanel: React.FC<SoundboardPanelProps> = ({
  api,
  user,
  sounds,
  volume,
  onVolumeChange,
  onPlaySound,
  onStopAll,
  onClose,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🔥');
  const [color, setColor] = useState('#5865F2');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [recentlyPressed, setRecentlyPressed] = useState<string | null>(null);

  const handleTrigger = (soundId: string) => {
    onPlaySound(soundId);
    setRecentlyPressed(soundId);
    window.setTimeout(() => {
      setRecentlyPressed((prev) => (prev === soundId ? null : prev));
    }, 350);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !api) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadSound(file, {
        name: name.trim() || file.name.replace(/\.[^.]+$/, ''),
        emoji,
        color,
      });
      setName('');
      setFile(null);
      setShowAdd(false);
    } catch (err: unknown) {
      setError((err as Error).message || 'Erro ao enviar som.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, sound: SoundItem) => {
    e.stopPropagation();
    if (!api) return;
    try {
      await api.deleteSound(sound.id);
    } catch (err: unknown) {
      setError((err as Error).message || 'Erro ao remover som.');
    }
  };

  return (
    <div className="w-80 shrink-0 bg-[#2b2d31] border-l border-[#1e1f22] flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1e1f22] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#f0b232]" />
          <h3 className="text-sm font-bold text-white">Soundboard da Call</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className={`px-2 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
              showAdd ? 'bg-[#5865f2] text-white' : 'bg-[#383a40] hover:bg-[#4e5058] text-[#dbdee1]'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            Novo
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#949ba4] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Volume control */}
      <div className="px-4 py-2.5 bg-[#232428] border-b border-[#1e1f22] flex items-center gap-2.5">
        <Volume2 className="w-4 h-4 text-[#b5bac1] shrink-0" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="flex-1 accent-[#f0b232] cursor-pointer"
          title="Meu volume do Soundboard"
        />
        <span className="text-[11px] font-mono text-[#b5bac1] w-8 text-right">{Math.round(volume * 100)}%</span>
        <button
          type="button"
          onClick={onStopAll}
          className="p-1.5 rounded bg-[#383a40] hover:bg-[#f23f42] text-[#dbdee1] hover:text-white transition cursor-pointer"
          title="Parar sons tocando agora"
        >
          <VolumeX className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 text-xs bg-[#f23f42]/15 text-[#ff8b8d] border border-[#f23f42]/40 px-2.5 py-1.5 rounded-lg">
          {error}
        </div>
      )}

      {/* Upload custom sound form */}
      {showAdd && (
        <form onSubmit={handleUpload} className="p-3 bg-[#232428] border-b border-[#1e1f22] space-y-2.5 text-xs">
          <div className="font-bold text-white">Adicionar Som Personalizado</div>
          <label className="flex items-center justify-center gap-2 border border-dashed border-[#4e5058] hover:border-[#5865f2] rounded-lg p-2.5 cursor-pointer text-[#dbdee1]">
            <Upload className="w-4 h-4 text-[#5865f2]" />
            <span className="truncate">{file ? file.name : 'Escolher MP3, WAV ou OGG'}</span>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 28));
              }}
            />
          </label>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do efeito (ex: Cavalo!)"
            maxLength={32}
            className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-[#5865f2]"
            required
          />

          <div className="flex flex-wrap gap-1">
            {PRESET_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setEmoji(em)}
                className={`w-7 h-7 rounded flex items-center justify-center text-base cursor-pointer ${
                  emoji === em ? 'bg-[#5865f2]' : 'bg-[#1e1f22] hover:bg-[#383a40]'
                }`}
              >
                {em}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full cursor-pointer transition ${
                  color === c ? 'ring-2 ring-white scale-110' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <button
            type="submit"
            disabled={uploading || !file}
            className="w-full py-2 bg-[#23a55a] hover:bg-[#1e8e4c] disabled:opacity-50 text-white font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {uploading ? 'Enviando...' : 'Salvar no Soundboard'}
          </button>
        </form>
      )}

      {/* Sound Pads Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <p className="text-[11px] text-[#949ba4] mb-2.5">
          Clique em qualquer botão para tocar o efeito ao vivo para todos na sala de voz!
        </p>
        <div className="grid grid-cols-2 gap-2">
          {sounds.map((s) => {
            const pressed = recentlyPressed === s.id;
            const canDelete = !s.isStarter || user.role === 'host';
            return (
              <div
                key={s.id}
                onClick={() => handleTrigger(s.id)}
                className={`group relative rounded-lg p-3 bg-[#1e1f22] hover:bg-[#35373c] border transition cursor-pointer select-none flex flex-col items-center text-center gap-1.5 ${
                  pressed ? 'scale-95 ring-2 ring-[#f0b232]' : ''
                }`}
                style={{ borderColor: `${s.color}55` }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl shadow"
                  style={{ backgroundColor: `${s.color}25` }}
                >
                  {s.emoji}
                </div>
                <span className="text-xs font-semibold text-white line-clamp-2 leading-tight">{s.name}</span>
                {canDelete && (
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, s)}
                    className="opacity-0 group-hover:opacity-100 absolute top-1.5 right-1.5 p-1 rounded bg-[#2b2d31] text-[#949ba4] hover:text-[#f23f42] transition cursor-pointer"
                    title="Remover som"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
