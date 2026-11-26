import React, { useMemo, useState } from 'react';
import { Check, Hash, Loader2, Lock, Plus, Search, Shield, Trash2, Volume2, X } from 'lucide-react';
import { ApiClient } from '../lib/api';
import { PERMISSION_SECTIONS } from '../lib/permissions';
import {
  Channel,
  ChannelCategory,
  ChannelPermissionOverwrite,
  PermissionKey,
  PermissionTriState,
  Role,
  User,
} from '../types';
import { useEscapeToClose } from '../lib/useEscapeToClose';

interface ChannelSettingsModalProps {
  channel: Channel;
  categories: ChannelCategory[];
  roles: Role[];
  members: User[];
  api: ApiClient;
  onUpdated: (ch: Channel) => void;
  onDeleted: (chId: string) => void;
  onClose: () => void;
}

const SLOWMODE_OPTIONS = [
  { value: 0, label: 'Desligado' },
  { value: 5, label: '5 segundos' },
  { value: 10, label: '10 segundos' },
  { value: 30, label: '30 segundos' },
  { value: 60, label: '1 minuto' },
  { value: 300, label: '5 minutos' },
  { value: 900, label: '15 minutos' },
  { value: 3600, label: '1 hora' },
];

export const ChannelSettingsModal: React.FC<ChannelSettingsModalProps> = ({
  channel,
  categories,
  roles,
  members,
  api,
  onUpdated,
  onDeleted,
  onClose,
}) => {
  useEscapeToClose(onClose);
  const [tab, setTab] = useState<'overview' | 'permissions'>('overview');
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic || '');
  const [categoryId, setCategoryId] = useState<string>(channel.categoryId || '');
  const [slowModeSec, setSlowModeSec] = useState<number>(channel.slowModeSec || 0);
  const [visibility, setVisibility] = useState<'default' | 'spoiler' | 'nsfw'>(channel.visibility || 'default');
  const [bitrateKbps, setBitrateKbps] = useState<number>(channel.bitrateKbps || 128);
  const [userLimit, setUserLimit] = useState<number>(channel.userLimit || 0);
  const [isStage, setIsStage] = useState<boolean>(Boolean(channel.isStage));

  const [isPrivate, setIsPrivate] = useState<boolean>(Boolean(channel.isPrivate));
  const [overwrites, setOverwrites] = useState<ChannelPermissionOverwrite[]>(() =>
    JSON.parse(JSON.stringify(channel.overwrites || []))
  );
  const [selectedTargetId, setSelectedTargetId] = useState<string>('role-everyone');
  const [permSearch, setPermSearch] = useState('');
  const [showAddTarget, setShowAddTarget] = useState(false);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const availableTargets = useMemo(() => {
    const out: Array<{ id: string; targetType: 'role' | 'member'; label: string; color?: string }> = [
      { id: 'role-everyone', targetType: 'role', label: '@everyone', color: '#949ba4' },
    ];
    for (const ow of overwrites) {
      if (ow.id === 'role-everyone') continue;
      if (ow.targetType === 'role') {
        const r = roles.find((x) => x.id === ow.id);
        out.push({ id: ow.id, targetType: 'role', label: r?.name || ow.targetName || ow.id, color: r?.color });
      } else {
        const m = members.find((x) => x.id === ow.id);
        out.push({ id: ow.id, targetType: 'member', label: m?.displayName || ow.targetName || ow.id });
      }
    }
    return out;
  }, [overwrites, roles, members]);

  const unaddedRoles = roles.filter(
    (r) => !r.isEveryone && r.id !== 'role-host' && !overwrites.some((o) => o.id === r.id)
  );
  const unaddedMembers = members.filter((m) => m.role !== 'host' && !overwrites.some((o) => o.id === m.id));

  const getTriState = (targetId: string, permKey: PermissionKey): PermissionTriState => {
    const ow = overwrites.find((o) => o.id === targetId);
    if (!ow) return 'inherit';
    if (ow.allow.includes(permKey)) return 'allow';
    if (ow.deny.includes(permKey)) return 'deny';
    return 'inherit';
  };

  const setTriState = (
    targetId: string,
    targetType: 'role' | 'member',
    targetName: string,
    permKey: PermissionKey,
    next: PermissionTriState
  ) => {
    setOverwrites((prev) => {
      const nextList = [...prev];
      let idx = nextList.findIndex((o) => o.id === targetId);
      if (idx === -1) {
        nextList.push({ id: targetId, targetType, targetName, allow: [], deny: [] });
        idx = nextList.length - 1;
      }
      const cur = {
        ...nextList[idx],
        allow: nextList[idx].allow.filter((k) => k !== permKey),
        deny: nextList[idx].deny.filter((k) => k !== permKey),
      };
      if (next === 'allow') cur.allow.push(permKey);
      else if (next === 'deny') cur.deny.push(permKey);
      nextList[idx] = cur;
      return nextList;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const { channel: updated } = await api.updateChannel(channel.id, {
        name: name.trim() || channel.name,
        topic,
        categoryId: categoryId || null,
        slowModeSec,
        visibility,
        bitrateKbps,
        userLimit,
        isPrivate,
        overwrites,
        ...(channel.type === 'voice' ? { isStage } : {}),
      });
      onUpdated(updated);
      setMsg('Alterações do canal salvas!');
    } catch (err: unknown) {
      setMsg((err as Error).message || 'Erro ao salvar canal.');
    } finally {
      setSaving(false);
    }
  };

  const selectedTargetObj = availableTargets.find((t) => t.id === selectedTargetId) || availableTargets[0];

  const relevantSections = PERMISSION_SECTIONS.filter(
    (s) => s.section.includes('gerais') || s.section.includes('assinatura') || (channel.type === 'text' ? s.section.includes('texto') : s.section.includes('voz'))
  );

  return (
    <div onClick={onClose} className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl h-[86vh] max-h-[760px] bg-[#1e1f22] border border-white/10 rounded-lg shadow-2xl overflow-hidden flex"
      >
        {/* Left Navigation Column */}
        <div className="w-56 shrink-0 bg-[#1e1f22] border-r border-white/10 p-3 flex flex-col gap-1">
          <div className="px-2.5 py-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">
            {channel.type === 'voice' ? <Volume2 className="w-3.5 h-3.5" /> : <Hash className="w-3.5 h-3.5" />}
            <span className="truncate text-white">{channel.name}</span>
          </div>

          <button
            type="button"
            onClick={() => setTab('overview')}
            className={`text-left px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'overview' ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:bg-[#2b2d31]'
            }`}
          >
            Visão geral
          </button>
          <button
            type="button"
            onClick={() => setTab('permissions')}
            className={`text-left px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-between cursor-pointer ${
              tab === 'permissions' ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:bg-[#2b2d31]'
            }`}
          >
            <span>Permissões</span>
            {isPrivate && <Lock className="w-3.5 h-3.5 text-[#f0b232]" />}
          </button>

          <div className="my-2 border-t border-white/10" />

          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(`Excluir permanentemente #${channel.name}?`)) return;
              try {
                await api.deleteChannel(channel.id);
                onDeleted(channel.id);
                onClose();
              } catch (err: unknown) {
                setMsg((err as Error).message || 'Erro ao excluir canal.');
              }
            }}
            className="text-left px-3 py-2 rounded-lg text-xs font-bold text-[#f23f42] hover:bg-[#da373c]/15 flex items-center justify-between cursor-pointer"
          >
            <span>Excluir canal</span>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right Editor Pane */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-base font-bold text-white">
              {tab === 'overview' ? 'Visão geral' : 'Permissões do canal'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full border border-white/15 flex items-center justify-center text-[#b5bac1] hover:text-white hover:bg-[#35373c] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
            {msg && (
              <div className="bg-[#23a55a]/20 border border-[#23a55a]/45 text-[#86efac] px-3.5 py-2 rounded-lg font-semibold">
                {msg}
              </div>
            )}

            {tab === 'overview' && (
              <div className="space-y-5 max-w-2xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block font-bold uppercase tracking-wider text-[#b5bac1]">Nome do canal</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={36}
                      className="w-full bg-[#111214] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-3 py-2.5 text-sm text-white outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block font-bold uppercase tracking-wider text-[#b5bac1]">Categoria</label>
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full bg-[#111214] border border-[#3f4147] rounded-lg px-3 py-2.5 text-sm text-white outline-none"
                    >
                      <option value="">Sem categoria</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-bold uppercase tracking-wider text-[#b5bac1]">Assunto do canal</label>
                    <span className="text-[11px] text-[#949ba4]">{topic.length}/1024</span>
                  </div>
                  <textarea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    maxLength={1024}
                    rows={4}
                    placeholder="Mostre pra todo mundo como se usa este canal!"
                    className="w-full bg-[#111214] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-3.5 py-2.5 text-sm text-white outline-none resize-none"
                  />
                </div>

                {channel.type === 'text' ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="block font-bold uppercase tracking-wider text-[#b5bac1]">Modo Lento</label>
                      <select
                        value={slowModeSec}
                        onChange={(e) => setSlowModeSec(Number(e.target.value))}
                        className="w-full bg-[#111214] border border-[#3f4147] rounded-lg px-3 py-2.5 text-sm text-white outline-none"
                      >
                        {SLOWMODE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-[#949ba4]">
                        Membros só poderão enviar mensagens a cada intervalo definido (exceto cargos com Gerenciar mensagens).
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="block font-bold uppercase tracking-wider text-[#b5bac1]">
                        Visibilidade do conteúdo
                      </label>
                      {(
                        [
                          ['default', 'Padrão', 'O conteúdo do canal fica sempre visível.'],
                          ['spoiler', 'Canal de spoiler', 'Oculta imagens/textos sensíveis até que escolham visualizá-los.'],
                          ['nsfw', 'Canal com restrição de idade', 'Solicita confirmação de idade ao abrir o canal.'],
                        ] as const
                      ).map(([val, title, desc]) => (
                        <label
                          key={val}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                            visibility === val ? 'bg-[#5865f2]/15 border-[#5865f2]' : 'bg-[#111214] border-white/5'
                          }`}
                        >
                          <input
                            type="radio"
                            checked={visibility === val}
                            onChange={() => setVisibility(val)}
                            className="mt-0.5 accent-[#5865f2]"
                          />
                          <div>
                            <div className="font-bold text-white">{title}</div>
                            <div className="text-[11px] text-[#949ba4]">{desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#111214] p-4 rounded-lg border border-white/5">
                    <div className="space-y-1.5">
                      <div className="flex justify-between">
                        <span className="font-bold text-white">Bitrate de Áudio</span>
                        <span className="font-mono text-[#4ade80] font-bold">{bitrateKbps} kbps</span>
                      </div>
                      <input
                        type="range"
                        min={64}
                        max={384}
                        step={16}
                        value={bitrateKbps}
                        onChange={(e) => setBitrateKbps(Number(e.target.value))}
                        className="w-full accent-[#5865f2]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between">
                        <span className="font-bold text-white">Limite de usuários</span>
                        <span className="font-mono text-white font-bold">{userLimit === 0 ? 'Ilimitado' : userLimit}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={25}
                        step={1}
                        value={userLimit}
                        onChange={(e) => setUserLimit(Number(e.target.value))}
                        className="w-full accent-[#23a55a]"
                      />
                    </div>
                    <label className="sm:col-span-2 flex items-start justify-between gap-3 cursor-pointer">
                      <span>
                        <span className="block font-bold text-white">Modo palco</span>
                        <span className="block text-[11px] text-[#949ba4]">
                          Quem entra fica na plateia, sem microfone, e pode levantar a mão. Moderadores (quem pode silenciar ou mover membros) falam e chamam pessoas para o palco.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={isStage}
                        onChange={(e) => setIsStage(e.target.checked)}
                        className="accent-[#5865f2] w-4 h-4 mt-1 shrink-0"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            {tab === 'permissions' && (
              <div className="space-y-4">
                {categoryId && (
                  <div className="bg-[#1e1f22] border border-[#f0b232]/40 rounded-lg px-4 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-[#dbdee1]">
                      Sincronizar permissões com a categoria selecionada?
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await api.updateChannel(channel.id, { categoryId, syncWithCategory: true });
                        setIsPrivate(Boolean(res.channel.isPrivate));
                        setOverwrites(res.channel.overwrites || []);
                        onUpdated(res.channel);
                        setMsg('Permissões sincronizadas com a categoria!');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#2b2d31] hover:bg-[#5865f2] text-white font-bold cursor-pointer"
                    >
                      Sincronizar agora
                    </button>
                  </div>
                )}

                {/* Canal Privado Toggle */}
                <label className="flex items-center justify-between bg-[#1e1f22] border border-white/10 rounded-lg p-4 cursor-pointer">
                  <div className="flex items-start gap-2.5">
                    <Lock className="w-4 h-4 text-[#f0b232] mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-sm text-white">Canal privado</div>
                      <div className="text-[11px] text-[#949ba4]">
                        Somente membros/cargos selecionados abaixo ou com "Ver e acessar canais privados" poderão ver este canal.
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="w-5 h-5 accent-[#23a55a] cursor-pointer"
                  />
                </label>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* Left: Cargos/Membros selector */}
                  <div className="md:col-span-4 bg-[#1e1f22] border border-white/10 rounded-lg p-2.5 space-y-1 relative">
                    <div className="flex items-center justify-between px-1.5 pb-1">
                      <span className="font-bold uppercase tracking-wider text-[11px] text-[#949ba4]">Cargos / Membros</span>
                      <button
                        type="button"
                        onClick={() => setShowAddTarget((v) => !v)}
                        className="p-1 rounded hover:bg-[#35373c] text-[#b5bac1] hover:text-white cursor-pointer"
                        title="Adicionar cargo ou membro"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {showAddTarget && (
                      <div className="bg-[#111214] border border-white/15 rounded-lg p-1.5 space-y-1 max-h-48 overflow-y-auto mb-2">
                        {unaddedRoles.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setOverwrites((p) => [...p, { id: r.id, targetType: 'role', targetName: r.name, allow: isPrivate ? ['viewChannels'] : [], deny: [] }]);
                              setSelectedTargetId(r.id);
                              setShowAddTarget(false);
                            }}
                            className="w-full text-left px-2 py-1 rounded hover:bg-[#5865f2] text-white flex items-center gap-2 cursor-pointer"
                          >
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                            <span>Cargo: {r.name}</span>
                          </button>
                        ))}
                        {unaddedMembers.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setOverwrites((p) => [...p, { id: m.id, targetType: 'member', targetName: m.displayName, allow: isPrivate ? ['viewChannels'] : [], deny: [] }]);
                              setSelectedTargetId(m.id);
                              setShowAddTarget(false);
                            }}
                            className="w-full text-left px-2 py-1 rounded hover:bg-[#5865f2] text-white cursor-pointer"
                          >
                            Membro: {m.displayName}
                          </button>
                        ))}
                        {unaddedRoles.length === 0 && unaddedMembers.length === 0 && (
                          <div className="text-[11px] text-[#949ba4] px-2 py-1">Todos já adicionados.</div>
                        )}
                      </div>
                    )}

                    {availableTargets.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTargetId(t.id)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 cursor-pointer ${
                          selectedTargetObj.id === t.id ? 'bg-[#35373c] text-white font-bold' : 'text-[#b5bac1] hover:bg-[#232632]'
                        }`}
                      >
                        {t.targetType === 'role' ? (
                          <Shield className="w-3.5 h-3.5 shrink-0" style={{ color: t.color || '#949ba4' }} />
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full bg-[#5865f2] inline-block shrink-0" />
                        )}
                        <span className="truncate">{t.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Right: Tri-State Permissions */}
                  <div className="md:col-span-8 space-y-3">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#949ba4] absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={permSearch}
                        onChange={(e) => setPermSearch(e.target.value)}
                        placeholder="Buscar permissões..."
                        className="w-full bg-[#111214] border border-[#3f4147] rounded-lg pl-8 pr-3 py-2 text-white outline-none"
                      />
                    </div>

                    <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
                      {relevantSections.map((sec) => {
                        const filtered = sec.items.filter(
                          (it) =>
                            !permSearch.trim() ||
                            it.label.toLowerCase().includes(permSearch.toLowerCase()) ||
                            it.description.toLowerCase().includes(permSearch.toLowerCase())
                        );
                        if (!filtered.length) return null;
                        return (
                          <div key={sec.section} className="space-y-2">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">{sec.section}</div>
                            {filtered.map((item) => {
                              const st = getTriState(selectedTargetObj.id, item.key);
                              return (
                                <div
                                  key={item.key}
                                  className="flex items-center justify-between gap-3 bg-[#1e1f22] border border-white/5 rounded-lg p-3"
                                >
                                  <div className="min-w-0">
                                    <div className="font-bold text-white">{item.label}</div>
                                    <div className="text-[11px] text-[#949ba4]">{item.description}</div>
                                  </div>
                                  <div className="flex items-center rounded-md overflow-hidden border border-[#3f4147] shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setTriState(selectedTargetObj.id, selectedTargetObj.targetType, selectedTargetObj.label, item.key, 'deny')
                                      }
                                      className={`w-7 h-7 flex items-center justify-center cursor-pointer ${
                                        st === 'deny' ? 'bg-[#da373c] text-white' : 'bg-[#1e1f22] text-[#949ba4] hover:text-white'
                                      }`}
                                      title="Negar"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setTriState(selectedTargetObj.id, selectedTargetObj.targetType, selectedTargetObj.label, item.key, 'inherit')
                                      }
                                      className={`w-7 h-7 flex items-center justify-center font-bold border-x border-[#3f4147] cursor-pointer ${
                                        st === 'inherit' ? 'bg-[#4e5058] text-white' : 'bg-[#1e1f22] text-[#949ba4] hover:text-white'
                                      }`}
                                      title="Herdar do cargo"
                                    >
                                      /
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setTriState(selectedTargetObj.id, selectedTargetObj.targetType, selectedTargetObj.label, item.key, 'allow')
                                      }
                                      className={`w-7 h-7 flex items-center justify-center cursor-pointer ${
                                        st === 'allow' ? 'bg-[#23a55a] text-white' : 'bg-[#1e1f22] text-[#949ba4] hover:text-white'
                                      }`}
                                      title="Permitir"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Save Footer */}
          <div className="px-6 py-3 bg-[#1e1f22] border-t border-white/10 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-[#b5bac1] hover:text-white cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-[#23a55a] hover:bg-[#1a8245] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
