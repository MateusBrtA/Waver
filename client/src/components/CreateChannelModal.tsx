import React, { useState } from 'react';
import { Hash, Loader2, Lock, Volume2, X } from 'lucide-react';
import { useEscapeToClose } from '../lib/useEscapeToClose';

interface CreateChannelModalProps {
  initialType: 'text' | 'voice';
  categoryId?: string | null;
  canCreatePrivate?: boolean;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    type: 'text' | 'voice';
    topic?: string;
    categoryId?: string | null;
    isPrivate?: boolean;
  }) => Promise<void>;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  initialType,
  categoryId = null,
  canCreatePrivate = false,
  onClose,
  onCreate,
}) => {
  useEscapeToClose(onClose);
  const [type, setType] = useState<'text' | 'voice'>(initialType);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onCreate({ name: name.trim(), type, topic: topic.trim(), categoryId, isPrivate });
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || 'Erro ao criar canal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#2b2d31] border border-[#3f4147] rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[#1e1f22] flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Criar Novo Canal</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#949ba4] hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Type selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[#b5bac1]">Tipo de Canal</label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setType('text')}
                className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                  type === 'text'
                    ? 'bg-[#5865f2]/20 border-[#5865f2] text-white'
                    : 'bg-[#1e1f22] border-[#3f4147] text-[#b5bac1] hover:border-[#6d6f78]'
                }`}
              >
                <Hash className="w-5 h-5 mb-1.5 text-[#5865f2]" />
                <div className="text-sm font-bold">Texto</div>
                <div className="text-[11px] text-[#949ba4]">Chat, imagens e GIFs</div>
              </button>

              <button
                type="button"
                onClick={() => setType('voice')}
                className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                  type === 'voice'
                    ? 'bg-[#23a55a]/20 border-[#23a55a] text-white'
                    : 'bg-[#1e1f22] border-[#3f4147] text-[#b5bac1] hover:border-[#6d6f78]'
                }`}
              >
                <Volume2 className="w-5 h-5 mb-1.5 text-[#23a55a]" />
                <div className="text-sm font-bold">Voz e Vídeo</div>
                <div className="text-[11px] text-[#949ba4]">Call, tela 1080p e sons</div>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-[#b5bac1]">Nome do Canal</label>
            <div className="relative">
              {type === 'text' ? (
                <Hash className="w-4 h-4 text-[#949ba4] absolute left-3 top-2.5" />
              ) : (
                <Volume2 className="w-4 h-4 text-[#949ba4] absolute left-3 top-2.5" />
              )}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === 'text' ? 'ex: memes-e-prints' : 'ex: Valorant Squad'}
                maxLength={36}
                autoFocus
                required
                className="w-full bg-[#1e1f22] border border-[#3f4147] focus:border-[#5865f2] rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-[#b5bac1]">
              Descrição / Tópico (opcional)
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Sobre o que é este canal?"
              maxLength={140}
              className="w-full bg-[#1e1f22] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-3 py-2 text-sm text-white outline-none"
            />
          </div>

          {canCreatePrivate && (
            <label className="flex items-center justify-between p-3 rounded-lg bg-[#1e1f22] border border-[#3f4147] cursor-pointer">
              <div className="flex items-center gap-2.5 pr-2">
                <Lock className="w-4 h-4 text-[#f0b232] shrink-0" />
                <div>
                  <div className="text-xs font-bold text-white">Canal Privado</div>
                  <div className="text-[11px] text-[#949ba4]">
                    Apenas membros ou cargos selecionados terão acesso a este canal.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="accent-[#5865f2] w-4 h-4 shrink-0"
              />
            </label>
          )}

          {error && (
            <div className="text-xs bg-[#f23f42]/15 border border-[#f23f42]/40 text-[#ff8b8d] px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-[#232428] border-t border-[#1e1f22] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[#dbdee1] hover:underline cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Criar Canal
          </button>
        </div>
      </form>
    </div>
  );
};
