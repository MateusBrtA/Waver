import React, { useState } from 'react';
import { Camera, Check, Loader2, Phone, Trash2, UserPlus, Users, X } from 'lucide-react';
import { resolveMediaUrl } from '../lib/api';
import { PrivateGroup, PrivateGroupMemberMeta } from '../types';

function readFileAsCompressedDataUrl(file: File, maxDim = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx?.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/webp', 0.85));
      };
      img.onerror = () => resolve(String(reader.result || ''));
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

interface GroupModalProps {
  mode: 'create' | 'settings';
  group?: PrivateGroup | null;
  selfUserId: string;
  availablePeers: PrivateGroupMemberMeta[];
  preselectedIds?: string[];
  serverUrl: string;
  onSave: (payload: {
    id?: string;
    name: string;
    memberIds: string[];
    membersMeta: PrivateGroupMemberMeta[];
    iconDataUrl?: string | null;
    clearIcon?: boolean;
    startCallNow?: boolean;
  }) => Promise<void>;
  onLeaveGroup?: (groupId: string) => Promise<void>;
  onClose: () => void;
}

export const GroupModal: React.FC<GroupModalProps> = ({
  mode,
  group = null,
  selfUserId,
  availablePeers,
  preselectedIds = [],
  serverUrl,
  onSave,
  onLeaveGroup,
  onClose,
}) => {
  const [name, setName] = useState(group?.name || 'Chamada da Galera');
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (group) return group.memberIds.filter((id) => id !== selfUserId);
    return preselectedIds.filter((id) => id !== selfUserId);
  });
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [clearIcon, setClearIcon] = useState(false);
  const [startCallNow, setStartCallNow] = useState(mode === 'create');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const previewUrl = clearIcon
    ? null
    : iconDataUrl
    ? iconDataUrl
    : group?.iconUrl
    ? resolveMediaUrl(serverUrl, group.iconUrl)
    : null;

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handlePickIcon = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsCompressedDataUrl(file, 256);
      setIconDataUrl(dataUrl);
      setClearIcon(false);
    } catch {
      setError('Não foi possível ler esta imagem.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0 && mode === 'create') {
      setError('Selecione pelo menos 1 amigo para criar o grupo.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const metaList = availablePeers.filter((p) => selectedIds.includes(p.id));
      await onSave({
        ...(group?.id ? { id: group.id } : {}),
        name: name.trim() || 'Grupo Privado',
        memberIds: [selfUserId, ...selectedIds],
        membersMeta: metaList,
        ...(iconDataUrl ? { iconDataUrl } : {}),
        ...(clearIcon ? { clearIcon: true } : {}),
        startCallNow: mode === 'create' ? startCallNow : false,
      });
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || 'Erro ao salvar grupo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[125] bg-black/75 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#181a24] border border-white/10 rounded-lg shadow-2xl overflow-hidden animate-fade-up"
      >
        <div className="px-5 py-4 bg-[#1e1f22] border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#23a55a]" />
            <h3 className="text-sm font-bold text-white">
              {mode === 'create' ? 'Criar Grupo & Chamada Privada' : 'Configurações do Grupo'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[#949ba4] hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Group Image + Name */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <label className="relative w-16 h-16 rounded-lg bg-[#5865f2] overflow-hidden flex items-center justify-center cursor-pointer group border-2 border-white/15 shadow-lg">
                {previewUrl ? (
                  <img src={previewUrl} alt="Grupo" className="w-full h-full object-cover" />
                ) : (
                  <Users className="w-7 h-7 text-white" />
                )}
                <span className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                  <Camera className="w-5 h-5 text-white" />
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePickIcon(e.target.files?.[0])} />
              </label>
              {previewUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setIconDataUrl(null);
                    setClearIcon(true);
                  }}
                  className="text-[10px] text-[#f23f42] hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  Remover foto
                </button>
              )}
            </div>

            <div className="flex-1 space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1]">
                Nome do Grupo
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Ex: Squad Sexta-Feira"
                className="w-full bg-[#1e1f22] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-3.5 py-2.5 text-sm text-white outline-none"
              />
              <p className="text-[10px] text-[#949ba4]">Clique na imagem para colocar ou trocar a foto do grupo.</p>
            </div>
          </div>

          {/* Friends Selector */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5 text-[#5865f2]" />
                Participantes ({selectedIds.length + 1})
              </span>
              <span className="text-[10px] text-[#4ade80] font-normal">Chat + Call + Trello do Grupo</span>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1 bg-[#1e1f22] border border-white/5 rounded-lg p-2">
              {availablePeers.filter((p) => p.id !== selfUserId).length === 0 ? (
                <p className="text-xs text-[#949ba4] text-center py-4">
                  Nenhum amigo disponível na rede ou servidor ainda.
                </p>
              ) : (
                availablePeers
                  .filter((p) => p.id !== selfUserId)
                  .map((p) => {
                    const checked = selectedIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleMember(p.id)}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition cursor-pointer ${
                          checked ? 'bg-[#5865f2]/20 border border-[#5865f2]/50' : 'hover:bg-[#1e2230] border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white overflow-hidden"
                            style={{ backgroundColor: p.avatarColor || '#5865F2' }}
                          >
                            {p.avatarUrl ? (
                              <img src={resolveMediaUrl(p.p2pUrl || serverUrl, p.avatarUrl)} alt="" className="w-full h-full object-cover" />
                            ) : (
                              p.displayName.slice(0, 2).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">{p.displayName}</div>
                            <div className="text-[10px] text-[#949ba4]">@{p.username}</div>
                          </div>
                        </div>
                        <span
                          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                            checked ? 'bg-[#23a55a] border-[#23a55a] text-white' : 'border-[#4e5058]'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </span>
                      </button>
                    );
                  })
              )}
            </div>
          </div>

          {mode === 'create' && (
            <label className="flex items-center justify-between bg-[#1e1f22] border border-white/5 rounded-lg px-3.5 py-2.5 cursor-pointer">
              <span className="flex items-center gap-2 text-xs font-semibold text-white">
                <Phone className="w-4 h-4 text-[#23a55a]" />
                Já tocar chamada em grupo ao criar
              </span>
              <input
                type="checkbox"
                checked={startCallNow}
                onChange={(e) => setStartCallNow(e.target.checked)}
                className="w-4 h-4 accent-[#23a55a]"
              />
            </label>
          )}

          {error && (
            <div className="bg-[#da373c]/15 border border-[#da373c]/40 text-[#ff9396] text-xs px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-[#1e1f22] border-t border-white/5 flex items-center justify-between gap-2">
          {mode === 'settings' && group && onLeaveGroup ? (
            <button
              type="button"
              onClick={async () => {
                await onLeaveGroup(group.id);
                onClose();
              }}
              className="px-3 py-2 rounded-lg text-xs font-bold text-[#f23f42] hover:bg-[#da373c]/15 cursor-pointer"
            >
              Sair do Grupo
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-[#b5bac1] hover:text-white cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#23a55a] hover:bg-[#1a8245] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {mode === 'create' ? 'Criar Grupo' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
