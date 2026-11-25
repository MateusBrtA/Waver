import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Crown,
  Edit3,
  Flame,
  Gamepad2,
  Globe,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { ApiClient, resolveMediaUrl } from '../lib/api';
import { GlobalProfile, PresenceStatus, Role, User, UserConnection } from '../types';
import { AVATAR_DECORATIONS, Avatar, NAME_STYLES } from './Avatar';
import { CONNECTION_PLATFORM_OPTIONS, ConnectionCard } from './ConnectionBadge';

const BANNER_COLORS = ['#5865F2', '#7c3aed', '#23a55a', '#db2777', '#ea580c', '#0284c7', '#dc2626', '#1e1f22'];
const STATUS_OPTIONS: Array<{ value: PresenceStatus; label: string; dot: string }> = [
  { value: 'online', label: 'Online', dot: '#23a55a' },
  { value: 'idle', label: 'Ausente', dot: '#f0b232' },
  { value: 'dnd', label: 'Não Perturbe', dot: '#f23f42' },
  { value: 'invisible', label: 'Invisível', dot: '#80848e' },
];
const QUICK_BUBBLE_EMOJIS = ['😎', '🎮', '🔥', '💀', '🎧', '☕', '🚀', '😴', '🏆', '🎵'];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function simpleHash(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function formatAgo(ts?: number): string {
  if (!ts) return 'Recente';
  const diffMin = Math.max(1, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 60) return `${diffMin}m atrás`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h atrás`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d atrás`;
}

interface UserProfileModalProps {
  user: User;
  selfUser: User;
  initialEdit?: boolean;
  api?: ApiClient | null;
  serverUrl: string;
  roles: Role[];
  contextScope?: 'dm' | 'server';
  onClose: () => void;
  onUserUpdated: (user: User, globalPatch?: GlobalProfile) => void;
  onOpenDm: (user: User) => void;
  onStartPrivateCall: (user: User) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  user,
  selfUser,
  initialEdit = false,
  api = null,
  serverUrl,
  roles,
  contextScope = 'server',
  onClose,
  onUserUpdated,
  onOpenDm,
  onStartPrivateCall,
}) => {
  const isSelf = user.id === selfUser.id;
  const [rightTab, setRightTab] = useState<'activity' | 'about' | 'edit'>(
    initialEdit && isSelf ? 'edit' : 'activity'
  );

  // Edit profile form (Nitro-free + Global LAN Sync!)
  const [displayName, setDisplayName] = useState(user.displayName);
  const [pronouns, setPronouns] = useState(user.pronouns || '');
  const [bio, setBio] = useState(user.bio || '');
  const [statusType, setStatusType] = useState<PresenceStatus>(user.statusType || 'online');
  const [customStatusEmoji, setCustomStatusEmoji] = useState(user.customStatusEmoji || '');
  const [customStatusText, setCustomStatusText] = useState(user.customStatusText || '');
  const [bannerColor, setBannerColor] = useState(user.bannerColor || user.avatarColor || '#5865F2');
  const [avatarDecoration, setAvatarDecoration] = useState(user.avatarDecoration || 'none');
  const [nameStyle, setNameStyle] = useState(user.nameStyle || 'default');
  const [connections, setConnections] = useState<UserConnection[]>(user.connections || []);
  const [newConnPlatform, setNewConnPlatform] = useState('Steam');
  const [newConnHandle, setNewConnHandle] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const userRoles = contextScope === 'server' ? roles.filter((r) => (user.roleIds || []).includes(r.id)) : [];
  const bannerFullUrl = user.bannerUrl ? resolveMediaUrl(serverUrl, user.bannerUrl) : '';
  const nameStyleObj = NAME_STYLES[(rightTab === 'edit' ? nameStyle : user.nameStyle) || 'default'] || NAME_STYLES.default;
  const activities = user.recentActivities || [];

  const handleUploadAvatar = async (file: File) => {
    setSaving(true);
    setMsg('');
    try {
      const dataUrl = await fileToDataUrl(file);
      const avatarHash = simpleHash(dataUrl);
      if (api) {
        const uploadRes = await api.uploadAvatar(file);
        onUserUpdated(uploadRes.user, { avatarDataUrl: dataUrl, avatarHash });
      } else {
        onUserUpdated({ ...user, avatarUrl: dataUrl }, { avatarDataUrl: dataUrl, avatarHash });
      }
      setMsg('Foto de perfil atualizada e salva globalmente para todos os servidores LAN!');
    } catch (err: unknown) {
      setMsg((err as Error).message || 'Erro ao subir foto.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadBanner = async (file: File) => {
    setSaving(true);
    setMsg('');
    try {
      const dataUrl = await fileToDataUrl(file);
      const bannerHash = simpleHash(dataUrl);
      if (api) {
        const uploadRes = await api.uploadBanner(file);
        onUserUpdated(uploadRes.user, { bannerDataUrl: dataUrl, bannerHash });
      } else {
        onUserUpdated({ ...user, bannerUrl: dataUrl }, { bannerDataUrl: dataUrl, bannerHash });
      }
      setMsg('Capa/Banner atualizado e salvo globalmente!');
    } catch (err: unknown) {
      setMsg((err as Error).message || 'Erro ao subir capa.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const patch = {
        displayName: displayName.trim() || user.displayName,
        pronouns: pronouns.trim(),
        bio: bio.trim(),
        statusType,
        customStatusEmoji: customStatusEmoji.trim(),
        customStatusText: customStatusText.trim(),
        bannerColor,
        avatarDecoration,
        nameStyle,
        connections,
      };
      if (api) {
        const { user: updated } = await api.updateProfile(patch);
        onUserUpdated(updated, patch);
      } else {
        onUserUpdated({ ...user, ...patch }, patch);
      }
      setMsg('Perfil salvo e sincronizado na rede LAN!');
    } catch (err: unknown) {
      setMsg((err as Error).message || 'Erro ao salvar perfil.');
    } finally {
      setSaving(false);
    }
  };

  const addConnection = () => {
    if (!newConnHandle.trim()) return;
    setConnections((prev) => [...prev.slice(0, 9), { platform: newConnPlatform, handle: newConnHandle.trim() }]);
    setNewConnHandle('');
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[98] bg-black/80 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[820px] max-h-[86vh] bg-[#111214] border border-[#2b2d31] rounded-lg shadow-[0_24px_70px_rgba(0,0,0,0.85)] overflow-hidden grid grid-cols-1 md:grid-cols-12 relative animate-fade-up"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/50 hover:bg-black/80 text-[#dbdee1] hover:text-white flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* LEFT COLUMN: Discord Profile Card (Print 2 exact layout!) */}
        <div className="md:col-span-5 bg-[#111214] border-r border-[#2b2d31] flex flex-col overflow-y-auto">
          {/* Banner */}
          <div
            className="h-28 w-full shrink-0 bg-cover bg-center relative"
            style={{
              backgroundColor: rightTab === 'edit' ? bannerColor : user.bannerColor || user.avatarColor || '#5865F2',
              backgroundImage: bannerFullUrl ? `url(${bannerFullUrl})` : undefined,
            }}
          />

          {/* Avatar + Thought-Bubble Status */}
          <div className="px-5 relative">
            <div className="flex items-end gap-2.5 -mt-11">
              <div className="rounded-full p-[6px] bg-[#111214]">
                <Avatar
                  name={rightTab === 'edit' ? displayName : user.displayName}
                  avatarUrl={user.avatarUrl}
                  color={user.avatarColor}
                  decoration={rightTab === 'edit' ? avatarDecoration : user.avatarDecoration}
                  serverUrl={serverUrl}
                  size="xl"
                  online={Boolean(user.online)}
                  statusType={rightTab === 'edit' ? statusType : user.statusType}
                  borderBg="#111214"
                />
              </div>

              {(rightTab === 'edit' ? customStatusText || customStatusEmoji : user.customStatusText || user.customStatusEmoji) && (
                <div className="relative mb-2 max-w-[165px]">
                  <span className="absolute -left-2.5 top-1.5 w-2 h-2 rounded-full bg-[#232428] border border-[#35373c]" />
                  <span className="absolute -left-1 top-3 w-3 h-3 rounded-full bg-[#232428] border border-[#35373c]" />
                  <div className="relative bg-[#232428] border border-[#35373c] rounded-lg px-3 py-1.5 shadow text-xs text-white font-medium flex items-center gap-1.5">
                    <span>{rightTab === 'edit' ? customStatusEmoji : user.customStatusEmoji}</span>
                    <span className="truncate">{rightTab === 'edit' ? customStatusText : user.customStatusText}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* User Details */}
          <div className="p-5 pt-3 space-y-4 flex-1">
            <div>
              <h2 className={`text-xl font-bold leading-tight ${nameStyleObj.className}`}>
                {rightTab === 'edit' ? displayName : user.displayName}
              </h2>
              <div className="text-xs text-[#b5bac1] mt-0.5 flex items-center gap-1.5">
                <span>@{user.username}</span>
                {(rightTab === 'edit' ? pronouns : user.pronouns) && (
                  <>
                    <span>•</span>
                    <span>{rightTab === 'edit' ? pronouns : user.pronouns}</span>
                  </>
                )}
              </div>

              {user.role === 'host' && contextScope === 'server' && (
                <div className="inline-flex items-center gap-1 mt-2 bg-[#111214] px-1.5 py-1 rounded-md" title="Dono do servidor">
                  <Crown className="w-4 h-4 text-[#f0b232]" />
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {isSelf ? (
              <button
                type="button"
                onClick={() => setRightTab((t) => (t === 'edit' ? 'activity' : 'edit'))}
                className="w-full py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                {rightTab === 'edit' ? 'Ver perfil' : 'Editar perfil'}
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDm(user);
                  }}
                  className="flex-1 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold rounded-md flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Mensagem
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartPrivateCall(user);
                  }}
                  className="px-3 py-2 bg-[#23a55a] hover:bg-[#1e8e4c] text-white text-xs font-bold rounded-md flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Ligar
                </button>
              </div>
            )}

            {/* Membro desde */}
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">Membro desde</div>
              <div className="text-xs text-[#dbdee1] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#949ba4]" />
                {new Date(user.createdAt || Date.now()).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </div>
            </div>

            {/* Cargos (Strictly Server Scope only!) */}
            {contextScope === 'server' && userRoles.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">Cargos</div>
                <div className="flex flex-wrap gap-1.5">
                  {userRoles.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1e1f22] border border-[#2b2d31] text-[11px] font-semibold text-[#dbdee1]"
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Conexões: ícone da rede + nome da conta (como no Discord) */}
            {(rightTab === 'edit' ? connections : user.connections || []).length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-bold uppercase text-[#b5bac1]">Conexões</div>
                <div className="space-y-2">
                  {(rightTab === 'edit' ? connections : user.connections || []).map((c, idx) => (
                    <ConnectionCard key={`${c.platform}-${idx}`} connection={c} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Activity Feed / About / Nitro-Free Global Editor (Print 2!) */}
        <div className="md:col-span-7 bg-[#1e1f22] flex flex-col max-h-[86vh] overflow-hidden">
          <div className="px-6 pt-5 border-b border-[#2b2d31] flex items-center gap-5 text-sm font-semibold">
            <button
              type="button"
              onClick={() => setRightTab('activity')}
              className={`pb-3 border-b-2 transition cursor-pointer ${
                rightTab === 'activity' ? 'border-white text-white' : 'border-transparent text-[#949ba4] hover:text-white'
              }`}
            >
              Atividade Recente
            </button>
            <button
              type="button"
              onClick={() => setRightTab('about')}
              className={`pb-3 border-b-2 transition cursor-pointer ${
                rightTab === 'about' ? 'border-white text-white' : 'border-transparent text-[#949ba4] hover:text-white'
              }`}
            >
              Sobre Mim
            </button>
            {isSelf && (
              <button
                type="button"
                onClick={() => setRightTab('edit')}
                className={`pb-3 border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                  rightTab === 'edit' ? 'border-[#eb459e] text-white' : 'border-transparent text-[#eb459e]/80 hover:text-[#eb459e]'
                }`}
              >
                Editar perfil
              </button>
            )}
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            {/* ACTIVITY TAB (Print 2 exact right side!) */}
            {rightTab === 'activity' && (
              <div className="space-y-3">
                <div className="text-xs text-[#949ba4]">
                  Atividade recente de jogos e aplicativos detectados nos últimos 30 dias.
                </div>

                {user.currentActivity && (
                  <div className="bg-[#232428] border border-[#23a55a]/50 rounded-lg p-3.5 flex items-center gap-3.5">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl shrink-0"
                      style={{ backgroundColor: `${user.currentActivity.color}28` }}
                    >
                      {user.currentActivity.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#23a55a]">
                        ● Ativo Agora
                      </div>
                      <div className="text-sm font-bold text-white truncate">{user.currentActivity.name}</div>
                      <div className="text-xs text-[#949ba4]">Detectado automaticamente no Windows</div>
                    </div>
                  </div>
                )}

                {activities.length === 0 ? (
                  <div className="bg-[#232428] rounded-lg p-8 text-center space-y-2 border border-[#2b2d31]">
                    <Gamepad2 className="w-9 h-9 text-[#5865f2] mx-auto opacity-80" />
                    <p className="text-sm font-semibold text-white">Nenhuma atividade registrada ainda</p>
                    <p className="text-xs text-[#949ba4]">
                      Quando {isSelf ? 'você abrir' : `${user.displayName} abrir`} um jogo ou app no Windows (LoL, Valorant, CS2, Minecraft, GTA V, Spotify, etc.), ele aparecerá automaticamente aqui!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activities.map((act) => (
                      <div
                        key={act.name}
                        className="bg-[#232428] hover:bg-[#2b2d31] border border-[#2b2d31] rounded-lg p-3 flex items-center gap-3.5 transition"
                      >
                        <div
                          className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl shrink-0"
                          style={{ backgroundColor: `${act.color}25` }}
                        >
                          {act.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-white truncate">{act.name}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#949ba4] mt-0.5">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatAgo(act.lastPlayedAt)}
                            </span>
                            {(act.totalMinutes || 0) >= 60 && (
                              <span className="inline-flex items-center gap-1 text-[#f0b232]">
                                <Flame className="w-3 h-3" />
                                {Math.round((act.totalMinutes || 0) / 60)}h Maratona
                              </span>
                            )}
                            {(act.totalMinutes || 0) < 60 && (
                              <span className="inline-flex items-center gap-1 text-[#dbdee1]">
                                {Math.max(1, Math.round(act.totalMinutes || 1))} min jogados
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ABOUT TAB */}
            {rightTab === 'about' && (
              <div className="space-y-4">
                <div className="bg-[#232428] rounded-lg p-4 border border-[#2b2d31] space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-[#949ba4]">Sobre Mim</div>
                  <p className="text-sm text-[#dbdee1] whitespace-pre-wrap leading-relaxed">
                    {user.bio || 'Este usuário ainda não escreveu uma biografia.'}
                  </p>
                </div>

                <div className="bg-[#232428] rounded-lg p-4 border border-[#2b2d31] space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-[#949ba4]">Perfil Global LAN</div>
                  <p className="text-xs text-[#b5bac1]">
                    Foto de perfil, banner, decoração, status e conexões ficam salvos no app e sincronizam automaticamente em qualquer servidor PulseCord da LAN!
                  </p>
                </div>
              </div>
            )}

            {/* EDITAR PERFIL */}
            {rightTab === 'edit' && isSelf && (
              <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
                {msg && (
                  <div className="bg-[#23a55a]/15 border border-[#23a55a]/40 text-[#4ade80] px-3 py-2 rounded-lg">
                    {msg}
                  </div>
                )}

                {/* Avatar & Banner Upload */}
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex items-center justify-center gap-2 py-2.5 px-3 bg-[#5865f2] hover:bg-[#4752c4] text-white font-bold rounded-lg cursor-pointer transition">
                    <Upload className="w-4 h-4" />
                    Foto de Perfil (Global)
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadAvatar(f);
                      }}
                    />
                  </label>
                  <label className="flex items-center justify-center gap-2 py-2.5 px-3 bg-[#eb459e] hover:bg-[#d63384] text-white font-bold rounded-lg cursor-pointer transition">
                    <Upload className="w-4 h-4" />
                    Banner
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadBanner(f);
                      }}
                    />
                  </label>
                </div>

                {/* Status Presence + Floating Thought Bubble */}
                <div className="bg-[#232428] p-3.5 rounded-lg border border-[#2b2d31] space-y-3">
                  <div className="font-bold text-white">Status e Balão na Foto</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {STATUS_OPTIONS.map((st) => (
                      <button
                        key={st.value}
                        type="button"
                        onClick={() => setStatusType(st.value)}
                        className={`py-1.5 px-2 rounded-md flex items-center justify-center gap-1.5 font-semibold cursor-pointer border ${
                          statusType === st.value
                            ? 'bg-[#35373c] border-white text-white'
                            : 'bg-[#1e1f22] border-transparent text-[#b5bac1]'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: st.dot }} />
                        <span>{st.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customStatusEmoji}
                      onChange={(e) => setCustomStatusEmoji(e.target.value)}
                      placeholder="😎"
                      maxLength={6}
                      className="w-14 text-center bg-[#1e1f22] border border-[#3f4147] rounded-lg py-2 text-base text-white outline-none"
                    />
                    <input
                      type="text"
                      value={customStatusText}
                      onChange={(e) => setCustomStatusText(e.target.value)}
                      placeholder="Texto do balão de status (ex: Jogando rankeada!)"
                      maxLength={64}
                      className="flex-1 bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-white outline-none focus:border-[#5865f2]"
                    />
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {QUICK_BUBBLE_EMOJIS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setCustomStatusEmoji(em)}
                        className="w-7 h-7 rounded bg-[#1e1f22] hover:bg-[#35373c] text-sm cursor-pointer"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Nick, Pronouns, Bio */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-bold uppercase text-[#949ba4] mb-1">Nome Exibido</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={28}
                      className="w-full bg-[#111214] border border-[#3f4147] rounded-lg px-3 py-2 text-white outline-none focus:border-[#5865f2]"
                    />
                  </div>
                  <div>
                    <label className="block font-bold uppercase text-[#949ba4] mb-1">Pronomes / Frase curta</label>
                    <input
                      type="text"
                      value={pronouns}
                      onChange={(e) => setPronouns(e.target.value)}
                      placeholder="ele/dele"
                      maxLength={40}
                      className="w-full bg-[#111214] border border-[#3f4147] rounded-lg px-3 py-2 text-white outline-none focus:border-[#5865f2]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold uppercase text-[#949ba4] mb-1">Sobre Mim (Bio)</label>
                  <textarea
                    rows={2}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Conte algo sobre você..."
                    maxLength={220}
                    className="w-full bg-[#111214] border border-[#3f4147] rounded-lg px-3 py-2 text-white outline-none focus:border-[#5865f2] resize-none"
                  />
                </div>

                {/* Decorações, estilo do nome e cor do banner */}
                <div className="bg-[#2b2d31] p-3.5 rounded-lg space-y-3">
                  <div className="text-xs font-bold uppercase text-[#b5bac1]">Decoração e estilo</div>

                  <div>
                    <div className="text-[11px] text-[#949ba4] mb-1.5">Decoração do Avatar</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(AVATAR_DECORATIONS).map(([key, d]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setAvatarDecoration(key)}
                          title={d.label}
                          className={`w-[76px] flex flex-col items-center gap-1.5 pt-2.5 pb-1.5 rounded-md cursor-pointer border-2 transition ${
                            avatarDecoration === key
                              ? 'bg-[#404249] border-[#5865f2]'
                              : 'bg-[#1e1f22] border-transparent hover:bg-[#35373c]'
                          }`}
                        >
                          <Avatar
                            name={displayName || user.displayName}
                            avatarUrl={user.avatarUrl}
                            color={user.avatarColor}
                            decoration={key}
                            serverUrl={serverUrl}
                            size="md"
                            animateDecoration={avatarDecoration === key}
                          />
                          <span className="text-[11px] text-[#dbdee1] truncate max-w-full px-1">{d.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[#949ba4] mb-1.5">Estilo do Nome</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(NAME_STYLES).map(([key, s]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setNameStyle(key)}
                          className={`px-2.5 py-1 rounded-md font-bold cursor-pointer border ${
                            nameStyle === key
                              ? 'bg-[#35373c] border-white'
                              : 'bg-[#1e1f22] border-[#35373c]'
                          }`}
                        >
                          <span className={s.className}>{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[#949ba4] mb-1.5">Cor do Banner</div>
                    <div className="flex gap-2">
                      {BANNER_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setBannerColor(c)}
                          className={`w-6 h-6 rounded-full cursor-pointer ${
                            bannerColor === c ? 'ring-2 ring-white scale-110' : ''
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Conexões */}
                <div className="bg-[#2b2d31] p-3.5 rounded-lg space-y-2.5">
                  <div className="text-xs font-bold uppercase text-[#b5bac1]">Conexões</div>
                  <div className="text-[11px] text-[#949ba4]">
                    Cole o link do seu perfil (ex: steamcommunity.com/id/seunome) ou só o nome de usuário. O ícone da rede aparece automaticamente.
                  </div>
                  <div className="flex gap-1.5">
                    <select
                      value={newConnPlatform}
                      onChange={(e) => setNewConnPlatform(e.target.value)}
                      className="bg-[#1e1f22] border border-[#3f4147] rounded-lg px-2 py-1.5 text-white outline-none"
                    >
                      {CONNECTION_PLATFORM_OPTIONS.map((opt) => (
                        <option key={opt}>{opt}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newConnHandle}
                      onChange={(e) => setNewConnHandle(e.target.value)}
                      placeholder="Link do perfil ou nome de usuário"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addConnection();
                        }
                      }}
                      className="flex-1 bg-[#1e1f22] border border-[#3f4147] rounded-lg px-2.5 py-1.5 text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={addConnection}
                      className="px-2.5 bg-[#5865f2] hover:bg-[#4752c4] text-white rounded-lg cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  {connections.map((c, idx) => (
                    <ConnectionCard
                      key={idx}
                      connection={c}
                      onRemove={() => setConnections((prev) => prev.filter((_, i) => i !== idx))}
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 bg-[#23a55a] hover:bg-[#1e8e4c] text-white font-bold rounded-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Salvar Perfil e Sincronizar na LAN
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
