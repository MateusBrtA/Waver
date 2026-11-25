import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Check,
  Edit3,
  Gamepad2,
  Hammer,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  MessageSquare,
  MicOff,
  Pin,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { ApiClient } from '../lib/api';
import { DEFAULT_EVERYONE_PERMISSIONS, PERMISSION_SECTIONS } from '../lib/permissions';
import {
  AuditLogEntry,
  AuditLogType,
  BanEntry,
  PermissionKey,
  Role,
  RolePermissions,
  ServerInfo,
  ServerTag,
  User,
} from '../types';

interface ServerAdminPanelProps {
  section: 'server' | 'roles' | 'members' | 'audit' | 'bans';
  server: ServerInfo;
  user: User;
  users: User[];
  roles: Role[];
  permissions: RolePermissions;
  api: ApiClient;
  serverUrl: string;
  onServerUpdated: (s: ServerInfo) => void;
  onRolesUpdated: (r: Role[]) => void;
  onUsersUpdated: (u: User[]) => void;
  onNotify?: (msg: string) => void;
}

const BANNER_SWATCHES = [
  'linear-gradient(135deg, #2b1d2e 0%, #1a111d 100%)',
  'linear-gradient(135deg, #ff2e93 0%, #ff6b6b 100%)',
  'linear-gradient(135deg, #ed4245 0%, #c0392b 100%)',
  'linear-gradient(135deg, #f37b2d 0%, #e67e22 100%)',
  'linear-gradient(135deg, #f5cf3d 0%, #d4ac0d 100%)',
  'linear-gradient(135deg, #7c4dff 0%, #5865f2 100%)',
  'linear-gradient(135deg, #2196f3 0%, #00bcd4 100%)',
  'linear-gradient(135deg, #2ecc71 0%, #1abc9c 100%)',
  'linear-gradient(135deg, #558b2f 0%, #33691e 100%)',
  'linear-gradient(135deg, #4b5563 0%, #1f2937 100%)',
];

const ROLE_COLORS = [
  '#99aab5',
  '#1abc9c',
  '#2ecc71',
  '#3498db',
  '#5865f2',
  '#9b59b6',
  '#e91e63',
  '#f1c40f',
  '#e67e22',
  '#e74c3c',
  '#eb459e',
  '#00bcd4',
];

const TAG_EMOJIS = ['🎮', '🔥', '🎵', '🎨', '💻', '🚀', '💬', '🎧', '🌟', '⚡', '🏆', '🛠️'];

const AUDIT_TYPE_LABELS: Array<{ value: '' | AuditLogType; label: string }> = [
  { value: '', label: 'Todas as ações' },
  { value: 'member_join', label: 'Entrada no servidor' },
  { value: 'member_leave', label: 'Saída do servidor' },
  { value: 'member_kick', label: 'Expulsões (Kick)' },
  { value: 'member_ban', label: 'Banimentos' },
  { value: 'member_unban', label: 'Desbanimentos' },
  { value: 'voice_join', label: 'Entrada em call' },
  { value: 'voice_leave', label: 'Saída de call' },
  { value: 'voice_mod', label: 'Moderação de voz' },
  { value: 'channel_create', label: 'Canal criado' },
  { value: 'channel_update', label: 'Canal editado' },
  { value: 'channel_delete', label: 'Canal excluído' },
  { value: 'role_create', label: 'Cargo criado' },
  { value: 'role_update', label: 'Cargo editado' },
  { value: 'role_delete', label: 'Cargo excluído' },
  { value: 'member_role', label: 'Alteração de cargo' },
  { value: 'message_delete', label: 'Mensagem removida' },
  { value: 'message_pin', label: 'Mensagem fixada' },
  { value: 'server_update', label: 'Config. do servidor' },
];

export const ServerAdminPanel: React.FC<ServerAdminPanelProps> = ({
  section,
  server,
  user,
  users,
  roles,
  permissions,
  api,
  serverUrl,
  onServerUpdated,
  onRolesUpdated,
  onUsersUpdated,
  onNotify,
}) => {
  const resolveUrl = useCallback(
    (u?: string | null) => {
      if (!u) return '';
      if (u.startsWith('http') || u.startsWith('data:') || u.startsWith('blob:')) return u;
      return `${serverUrl}${u.startsWith('/') ? u : `/${u}`}`;
    },
    [serverUrl]
  );

  // ================= SERVER PROFILE & SETTINGS STATE =================
  const [srvName, setSrvName] = useState(server.name);
  const [srvDesc, setSrvDesc] = useState(server.description || '');
  const [srvIconColor, setSrvIconColor] = useState(server.iconColor || '#5865f2');
  const [srvBannerColor, setSrvBannerColor] = useState(server.bannerColor || BANNER_SWATCHES[0]);
  const [srvTags, setSrvTags] = useState<ServerTag[]>(server.tags || []);
  const [newTagEmoji, setNewTagEmoji] = useState('🎮');
  const [newTagLabel, setNewTagLabel] = useState('');
  const [allowCreate, setAllowCreate] = useState(server.allowMembersCreateChannels !== false);
  const [invitePw, setInvitePw] = useState('');
  const [savingServer, setSavingServer] = useState(false);
  const [uploadingServerImg, setUploadingServerImg] = useState(false);
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSrvName(server.name);
    setSrvDesc(server.description || '');
    setSrvIconColor(server.iconColor || '#5865f2');
    setSrvBannerColor(server.bannerColor || BANNER_SWATCHES[0]);
    setSrvTags(server.tags || []);
    setAllowCreate(server.allowMembersCreateChannels !== false);
  }, [server]);

  const playedGames = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const u of users) {
      const candidates = [...(u.recentActivities || [])];
      if (u.currentActivity) candidates.unshift(u.currentActivity);
      for (const act of candidates) {
        if (!act?.name) continue;
        const key = act.name.toLowerCase();
        const prev = map.get(key);
        map.set(key, { name: act.name, count: (prev?.count || 0) + 1 });
      }
    }
    return Array.from(map.values()).slice(0, 8);
  }, [users]);

  const handleSaveServerProfile = async () => {
    if (!permissions.manageServer) return;
    setSavingServer(true);
    try {
      const { server: updated } = await api.updateServer({
        name: srvName.trim() || server.name,
        description: srvDesc,
        iconColor: srvIconColor,
        bannerColor: srvBannerColor,
        tags: srvTags.slice(0, 5),
        allowMembersCreateChannels: allowCreate,
        ...(invitePw.trim() ? { invitePassword: invitePw.trim() } : {}),
      });
      setInvitePw('');
      onServerUpdated(updated);
      onNotify?.('Perfil do servidor salvo com sucesso!');
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao salvar perfil do servidor.');
    } finally {
      setSavingServer(false);
    }
  };

  const handleUploadServerIcon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !permissions.manageServer) return;
    setUploadingServerImg(true);
    try {
      const { server: updated } = await api.uploadServerIcon(file);
      onServerUpdated(updated);
      onNotify?.('Ícone do servidor atualizado!');
    } catch (err: any) {
      onNotify?.(err?.message || 'Falha ao enviar ícone do servidor.');
    } finally {
      setUploadingServerImg(false);
    }
  };

  const handleRemoveServerIcon = async () => {
    if (!permissions.manageServer) return;
    setUploadingServerImg(true);
    try {
      const { server: updated } = await api.updateServer({ clearIcon: true });
      onServerUpdated(updated);
      onNotify?.('Ícone removido.');
    } catch (err: any) {
      onNotify?.(err?.message || 'Falha ao remover ícone.');
    } finally {
      setUploadingServerImg(false);
    }
  };

  const handleUploadServerBanner = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !permissions.manageServer) return;
    setUploadingServerImg(true);
    try {
      const { server: updated } = await api.uploadServerBanner(file);
      onServerUpdated(updated);
      onNotify?.('Banner do servidor atualizado!');
    } catch (err: any) {
      onNotify?.(err?.message || 'Falha ao enviar banner.');
    } finally {
      setUploadingServerImg(false);
    }
  };

  const handleClearPassword = async () => {
    if (!permissions.manageServer) return;
    try {
      const { server: updated } = await api.updateServer({ clearInvitePassword: true });
      onServerUpdated(updated);
      onNotify?.('Senha de convite removida.');
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao remover senha.');
    }
  };

  // ================= ROLES & PERMISSIONS STATE =================
  const [roleSearch, setRoleSearch] = useState('');
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleEditorTab, setRoleEditorTab] = useState<'display' | 'permissions' | 'members'>('permissions');
  const [permQuery, setPermQuery] = useState('');
  const [draftRoleName, setDraftRoleName] = useState('');
  const [draftRoleColor, setDraftRoleColor] = useState('#5865f2');
  const [draftRoleHoist, setDraftRoleHoist] = useState(false);
  const [draftRolePerms, setDraftRolePerms] = useState<RolePermissions>({ ...DEFAULT_EVERYONE_PERMISSIONS });
  const [savingRole, setSavingRole] = useState(false);
  const [memberAssignSearch, setMemberAssignSearch] = useState('');

  const editingRole = useMemo(() => roles.find((r) => r.id === editingRoleId) || null, [roles, editingRoleId]);

  const openRoleEditor = (r: Role, defaultTab: 'display' | 'permissions' | 'members' = 'permissions') => {
    setEditingRoleId(r.id);
    setRoleEditorTab(defaultTab);
    setDraftRoleName(r.name);
    setDraftRoleColor(r.color || '#99aab5');
    setDraftRoleHoist(Boolean(r.hoist));
    setDraftRolePerms({ ...DEFAULT_EVERYONE_PERMISSIONS, ...(r.permissions || {}) });
  };

  const handleCreateRole = async () => {
    if (!permissions.manageRoles) return;
    setSavingRole(true);
    try {
      const idx = roles.length + 1;
      const { role: created } = await api.createRole({
        name: `novo cargo ${idx}`,
        color: ROLE_COLORS[idx % ROLE_COLORS.length],
        permissions: { ...DEFAULT_EVERYONE_PERMISSIONS },
      });
      const { roles: fresh } = await api.getRoles();
      onRolesUpdated(fresh);
      openRoleEditor(created, 'display');
      onNotify?.(`Cargo "${created.name}" criado!`);
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao criar cargo.');
    } finally {
      setSavingRole(false);
    }
  };

  const handleSaveRole = async () => {
    if (!editingRole || !permissions.manageRoles) return;
    setSavingRole(true);
    try {
      await api.updateRole(editingRole.id, {
        name: editingRole.isEveryone ? '@everyone' : draftRoleName.trim() || editingRole.name,
        color: draftRoleColor,
        hoist: draftRoleHoist,
        permissions: draftRolePerms,
      });
      const { roles: fresh } = await api.getRoles();
      onRolesUpdated(fresh);
      onNotify?.(`Cargo "${editingRole.isEveryone ? '@everyone' : draftRoleName}" atualizado!`);
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao atualizar cargo.');
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (r: Role) => {
    if (!permissions.manageRoles || r.isSystem || r.isEveryone) return;
    try {
      await api.deleteRole(r.id);
      const { roles: fresh } = await api.getRoles();
      onRolesUpdated(fresh);
      if (editingRoleId === r.id) setEditingRoleId(null);
      onNotify?.(`Cargo "${r.name}" excluído.`);
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao excluir cargo.');
    }
  };

  const handleMoveRole = async (roleId: string, dir: -1 | 1) => {
    if (!permissions.manageRoles) return;
    const customRoles = roles.filter((r) => !r.isEveryone);
    const idx = customRoles.findIndex((r) => r.id === roleId);
    const nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= customRoles.length) return;
    const swapped = [...customRoles];
    const [picked] = swapped.splice(idx, 1);
    swapped.splice(nextIdx, 0, picked);
    const everyone = roles.find((r) => r.isEveryone);
    const orderedIds = [...swapped.map((r) => r.id), ...(everyone ? [everyone.id] : [])];
    try {
      const { roles: updated } = await api.reorderRoles(orderedIds);
      onRolesUpdated(updated);
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao reordenar cargos.');
    }
  };

  const handleToggleMemberRole = async (targetUserId: string, roleId: string, hasRole: boolean) => {
    if (!permissions.manageRoles) return;
    try {
      const { user: updatedUser } = await api.updateUserRole(targetUserId, roleId, hasRole ? 'remove' : 'add');
      onUsersUpdated(users.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao alterar cargo do membro.');
    }
  };

  // ================= MEMBERS / AUDIT / BANS STATE =================
  const [memberSearch, setMemberSearch] = useState('');
  const [roleDropdownForUser, setRoleDropdownForUser] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditTypeFilter, setAuditTypeFilter] = useState<string>('');
  const [auditQuery, setAuditQuery] = useState('');
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [loadingBans, setLoadingBans] = useState(false);

  const loadAuditLogs = useCallback(async () => {
    if (!permissions.viewAuditLog) return;
    setLoadingAudit(true);
    try {
      const { entries } = await api.getAuditLogs({ type: auditTypeFilter, q: auditQuery });
      setAuditEntries(entries || []);
    } catch {
      setAuditEntries([]);
    } finally {
      setLoadingAudit(false);
    }
  }, [api, permissions.viewAuditLog, auditTypeFilter, auditQuery]);

  const loadBans = useCallback(async () => {
    if (!permissions.banMembers) return;
    setLoadingBans(true);
    try {
      const { bans: list } = await api.getBans();
      setBans(list || []);
    } catch {
      setBans([]);
    } finally {
      setLoadingBans(false);
    }
  }, [api, permissions.banMembers]);

  useEffect(() => {
    if (section === 'audit') loadAuditLogs();
  }, [section, loadAuditLogs]);

  useEffect(() => {
    if (section === 'bans') loadBans();
  }, [section, loadBans]);

  const handleKick = async (target: User) => {
    if (!permissions.kickMembers) return;
    const reason = window.prompt(`Motivo para expulsar ${target.displayName} (opcional):`, '') ?? null;
    if (reason === null) return;
    try {
      await api.kickUser(target.id, reason);
      onNotify?.(`${target.displayName} foi expulso do servidor.`);
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao expulsar usuário.');
    }
  };

  const handleBan = async (target: User) => {
    if (!permissions.banMembers) return;
    const reason = window.prompt(`Motivo para banir ${target.displayName}:`, 'Violação das regras') ?? null;
    if (reason === null) return;
    try {
      await api.banUser(target.id, reason);
      onNotify?.(`${target.displayName} foi banido.`);
      loadBans();
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao banir usuário.');
    }
  };

  const handleUnban = async (userId: string) => {
    try {
      const { bans: updated } = await api.unbanUser(userId);
      setBans(updated);
      onNotify?.('Usuário desbanido.');
    } catch (err: any) {
      onNotify?.(err?.message || 'Erro ao desbanir usuário.');
    }
  };

  // ================= RENDER SECTIONS =================
  if (section === 'server') {
    const iconPreviewUrl = resolveUrl(server.iconUrl);
    const bannerPreviewUrl = resolveUrl(server.bannerUrl);
    const onlineCount = users.filter((u) => u.online).length;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_290px] gap-6 items-start">
          {/* Left Form */}
          <div className="space-y-5">
            <div>
              <h3 className="text-lg font-bold text-white">Perfil do servidor</h3>
              <p className="text-xs text-[#949ba4] mt-0.5">
                Personalize como seu servidor aparece nos links de convite, descoberta LAN e cards do servidor.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1.5">
                Nome
              </label>
              <input
                type="text"
                value={srvName}
                onChange={(e) => setSrvName(e.target.value)}
                disabled={!permissions.manageServer}
                className="w-full px-3 py-2 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-sm text-white focus:outline-none focus:border-[#5865f2] disabled:opacity-60"
              />
            </div>

            <div className="pt-2 border-t border-[#2e3035]">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1">
                Ícone
              </label>
              <p className="text-xs text-[#949ba4] mb-2.5">
                Recomendamos uma imagem de, pelo menos, 512x512.
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUploadServerIcon}
                />
                <button
                  type="button"
                  disabled={!permissions.manageServer || uploadingServerImg}
                  onClick={() => iconInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-xs font-semibold text-white flex items-center gap-1.5 disabled:opacity-50"
                >
                  {uploadingServerImg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  Alterar o ícone do servidor
                </button>
                {server.iconUrl && (
                  <button
                    type="button"
                    disabled={!permissions.manageServer || uploadingServerImg}
                    onClick={handleRemoveServerIcon}
                    className="px-3.5 py-2 rounded-lg bg-[#35373c] hover:bg-[#da373c]/20 text-xs font-semibold text-[#f23f42] disabled:opacity-50"
                  >
                    Remover o ícone
                  </button>
                )}
                {!server.iconUrl && (
                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-[11px] text-[#949ba4]">Cor:</span>
                    <input
                      type="color"
                      value={srvIconColor}
                      disabled={!permissions.manageServer}
                      onChange={(e) => setSrvIconColor(e.target.value)}
                      className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-[#2e3035]">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1]">Faixa (Banner)</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={bannerInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUploadServerBanner}
                  />
                  <button
                    type="button"
                    disabled={!permissions.manageServer}
                    onClick={() => bannerInputRef.current?.click()}
                    className="text-[11px] px-2.5 py-1 rounded bg-[#2b2d31] hover:bg-[#35373c] text-[#dbdee1]"
                  >
                    Enviar imagem de banner
                  </button>
                  {server.bannerUrl && (
                    <button
                      type="button"
                      disabled={!permissions.manageServer}
                      onClick={() => api.updateServer({ clearBanner: true }).then((r) => onServerUpdated(r.server))}
                      className="text-[11px] text-[#f23f42] hover:underline"
                    >
                      Remover imagem
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {BANNER_SWATCHES.map((swatch) => {
                  const selected = srvBannerColor === swatch;
                  return (
                    <button
                      key={swatch}
                      type="button"
                      disabled={!permissions.manageServer}
                      onClick={() => setSrvBannerColor(swatch)}
                      style={{ background: swatch }}
                      className={`h-11 rounded-lg transition-all relative border-2 ${
                        selected ? 'border-white ring-2 ring-[#5865f2]' : 'border-transparent hover:scale-[1.03]'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Características (up to 5 tags) */}
            <div className="pt-2 border-t border-[#2e3035]">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1">
                Características ({srvTags.length}/5)
              </label>
              <p className="text-xs text-[#949ba4] mb-2">
                Adicione até 5 características para mostrar os interesses e a personalidade do servidor.
              </p>
              <div className="flex flex-wrap gap-2 mb-2.5">
                {srvTags.map((t, idx) => (
                  <span
                    key={`${t.label}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#2b2d31] border border-[#3f4147] text-xs text-[#e3e5e8]"
                  >
                    <span>{t.emoji}</span>
                    <span>{t.label}</span>
                    {permissions.manageServer && (
                      <button
                        type="button"
                        onClick={() => setSrvTags(srvTags.filter((_, i) => i !== idx))}
                        className="text-[#949ba4] hover:text-white ml-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {permissions.manageServer && srvTags.length < 5 && (
                <div className="flex items-center gap-2">
                  <select
                    value={newTagEmoji}
                    onChange={(e) => setNewTagEmoji(e.target.value)}
                    className="px-2 py-1.5 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-sm"
                  >
                    {TAG_EMOJIS.map((em) => (
                      <option key={em} value={em}>
                        {em}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    maxLength={24}
                    placeholder="Ex: Dev, FPS, Co-op, RPG..."
                    value={newTagLabel}
                    onChange={(e) => setNewTagLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTagLabel.trim()) {
                        e.preventDefault();
                        setSrvTags([...srvTags, { emoji: newTagEmoji, label: newTagLabel.trim() }].slice(0, 5));
                        setNewTagLabel('');
                      }
                    }}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white focus:outline-none focus:border-[#5865f2]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newTagLabel.trim()) return;
                      setSrvTags([...srvTags, { emoji: newTagEmoji, label: newTagLabel.trim() }].slice(0, 5));
                      setNewTagLabel('');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#35373c] hover:bg-[#43464d] text-xs text-white flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Adicionar
                  </button>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-[#2e3035]">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1">
                Descrição
              </label>
              <textarea
                rows={3}
                value={srvDesc}
                disabled={!permissions.manageServer}
                onChange={(e) => setSrvDesc(e.target.value)}
                placeholder="Conte ao mundo mais sobre esse servidor..."
                className="w-full px-3 py-2 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white focus:outline-none focus:border-[#5865f2] resize-none"
              />
            </div>

            {/* Jogos Jogados */}
            <div className="pt-2 border-t border-[#2e3035]">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1">
                Jogos Jogados
              </label>
              <p className="text-xs text-[#949ba4] mb-2">
                Jogos detectados automaticamente nos membros do servidor:
              </p>
              {playedGames.length === 0 ? (
                <div className="p-3 rounded-lg bg-[#1e1f22] border border-[#2e3035] text-xs text-[#80848e] flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4" /> Nenhuma atividade recente detectada ainda.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {playedGames.map((g) => (
                    <div
                      key={g.name}
                      className="p-2.5 rounded-lg bg-gradient-to-br from-[#232428] to-[#17181c] border border-[#32343a] flex flex-col justify-between min-h-[64px]"
                    >
                      <Gamepad2 className="w-4 h-4 text-[#5865f2]" />
                      <div>
                        <div className="text-xs font-bold text-white truncate">{g.name}</div>
                        <div className="text-[10px] text-[#949ba4]">{g.count}x registrado</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Segurança & Convite */}
            <div className="pt-3 border-t border-[#2e3035] space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#b5bac1]">
                Acesso, Senha & Permissões rápidas
              </div>
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-[#1e1f22] border border-[#2e3035] cursor-pointer">
                <span className="text-xs text-[#dbdee1]">
                  Permitir que membros comuns criem canais públicos diretamente
                </span>
                <input
                  type="checkbox"
                  checked={allowCreate}
                  disabled={!permissions.manageServer}
                  onChange={(e) => setAllowCreate(e.target.checked)}
                  className="accent-[#5865f2] w-4 h-4"
                />
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={invitePw}
                  disabled={!permissions.manageServer}
                  onChange={(e) => setInvitePw(e.target.value)}
                  placeholder={server.hasInvitePassword ? 'Alterar senha do servidor...' : 'Definir senha de convite (opcional)'}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white"
                />
                {server.hasInvitePassword && permissions.manageServer && (
                  <button
                    type="button"
                    onClick={handleClearPassword}
                    className="px-3 py-1.5 rounded-lg bg-[#35373c] hover:bg-[#da373c]/25 text-xs text-[#f23f42]"
                  >
                    Remover senha
                  </button>
                )}
              </div>
            </div>

            {permissions.manageServer && (
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  disabled={savingServer}
                  onClick={handleSaveServerProfile}
                  className="px-5 py-2.5 rounded-lg bg-[#23a55a] hover:bg-[#1a8e4a] text-xs font-bold text-white flex items-center gap-1.5"
                >
                  {savingServer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Salvar alterações do servidor
                </button>
              </div>
            )}
          </div>

          {/* Right Live Server Card Preview (matching Discord Screenshot 3) */}
          <div className="rounded-lg overflow-hidden bg-[#111214] border border-[#2e3035] shadow-xl sticky top-2">
            <div
              className="h-24 w-full bg-cover bg-center"
              style={
                bannerPreviewUrl
                  ? { backgroundImage: `url(${bannerPreviewUrl})` }
                  : { background: srvBannerColor || BANNER_SWATCHES[0] }
              }
            />
            <div className="px-4 pb-4 relative">
              <div
                className="w-16 h-16 -mt-8 rounded-lg border-4 border-[#111214] overflow-hidden flex items-center justify-center text-2xl font-bold text-white shadow-lg"
                style={{ backgroundColor: iconPreviewUrl ? '#1e1f22' : srvIconColor }}
              >
                {iconPreviewUrl ? (
                  <img src={iconPreviewUrl} alt={srvName} className="w-full h-full object-cover" />
                ) : (
                  (srvName || 'P').slice(0, 1).toUpperCase()
                )}
              </div>

              <h4 className="mt-2.5 text-base font-bold text-white truncate">{srvName || server.name}</h4>
              <div className="flex items-center gap-2 text-[11px] text-[#949ba4] mt-0.5">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#23a55a]" /> {onlineCount} online
                </span>
                <span>•</span>
                <span>{users.length} membros</span>
              </div>
              {server.createdAt && (
                <div className="text-[11px] text-[#80848e] mt-0.5">
                  Desde {new Date(server.createdAt).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                </div>
              )}

              {srvTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {srvTags.slice(0, 4).map((t, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#232428] border border-[#32343a] text-[11px] text-[#dbdee1]"
                    >
                      <span>{t.emoji}</span>
                      <span>{t.label}</span>
                    </span>
                  ))}
                  {srvTags.length > 4 && (
                    <span className="px-2 py-0.5 rounded bg-[#232428] text-[11px] text-[#949ba4]">
                      +{srvTags.length - 4}
                    </span>
                  )}
                </div>
              )}

              {srvDesc && <p className="mt-3 text-xs text-[#b5bac1] line-clamp-3">{srvDesc}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'roles') {
    const everyoneRole = roles.find((r) => r.isEveryone || r.id === 'role-everyone');
    const customRoles = roles.filter((r) => !r.isEveryone && r.id !== 'role-everyone');

    if (editingRole) {
      const roleMembers = editingRole.isEveryone
        ? users
        : users.filter((u) => (u.roleIds || []).includes(editingRole.id));
      const filteredUsersForAssign = users.filter(
        (u) =>
          !memberAssignSearch.trim() ||
          u.displayName.toLowerCase().includes(memberAssignSearch.toLowerCase()) ||
          u.username.toLowerCase().includes(memberAssignSearch.toLowerCase())
      );

      return (
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 min-h-[470px]">
          {/* Split Left Rail matching Screenshot 5 */}
          <div className="border-r border-[#2e3035] pr-3 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() => setEditingRoleId(null)}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#dbdee1] hover:text-white"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar
              </button>
              {permissions.manageRoles && (
                <button
                  type="button"
                  onClick={handleCreateRole}
                  title="Criar cargo"
                  className="p-1 rounded hover:bg-[#35373c] text-[#b5bac1] hover:text-white"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="space-y-1 flex-1 overflow-y-auto">
              {[...customRoles, ...(everyoneRole ? [everyoneRole] : [])].map((r) => {
                const active = r.id === editingRole.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openRoleEditor(r, roleEditorTab)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-xs transition-colors ${
                      active ? 'bg-[#404249] text-white font-semibold' : 'text-[#b5bac1] hover:bg-[#35373c]/60'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color || '#99aab5' }} />
                    <span className="truncate flex-1">{r.name}</span>
                    {r.isSystem && <Lock className="w-3 h-3 text-[#80848e] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Role Editor */}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#2e3035]">
              <h3 className="text-base font-bold text-white truncate">Editar cargo — {editingRole.name}</h3>
              {permissions.manageRoles && !editingRole.isSystem && !editingRole.isEveryone && (
                <button
                  type="button"
                  onClick={() => handleDeleteRole(editingRole)}
                  className="px-2.5 py-1 rounded text-xs text-[#f23f42] hover:bg-[#da373c]/15 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              )}
            </div>

            <div className="flex items-center gap-5 border-b border-[#2e3035] mt-2">
              {(['display', 'permissions', 'members'] as const).map((t) => {
                if (t === 'members' && editingRole.isEveryone) return null;
                const label =
                  t === 'display'
                    ? 'Exibição'
                    : t === 'permissions'
                    ? 'Permissões'
                    : `Gerenciar membros (${roleMembers.length})`;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRoleEditorTab(t)}
                    className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                      roleEditorTab === t
                        ? 'border-[#5865f2] text-white'
                        : 'border-transparent text-[#949ba4] hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto py-4 pr-1 space-y-5">
              {roleEditorTab === 'display' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-[#b5bac1] mb-1">Nome do cargo</label>
                    <input
                      type="text"
                      value={editingRole.isEveryone ? '@everyone' : draftRoleName}
                      disabled={Boolean(editingRole.isEveryone || !permissions.manageRoles)}
                      onChange={(e) => setDraftRoleName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-sm text-white disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-[#b5bac1] mb-2">Cor do cargo</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {ROLE_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          disabled={!permissions.manageRoles}
                          onClick={() => setDraftRoleColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-7 h-7 rounded-md flex items-center justify-center ${
                            draftRoleColor === c ? 'ring-2 ring-white scale-105' : ''
                          }`}
                        >
                          {draftRoleColor === c && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                        </button>
                      ))}
                      <input
                        type="color"
                        value={draftRoleColor}
                        disabled={!permissions.manageRoles}
                        onChange={(e) => setDraftRoleColor(e.target.value)}
                        className="w-8 h-8 rounded bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>

                  {!editingRole.isEveryone && (
                    <label className="flex items-center justify-between p-3 rounded-lg bg-[#1e1f22] border border-[#2e3035] cursor-pointer">
                      <div>
                        <div className="text-xs font-semibold text-white">
                          Exibir membros deste cargo separadamente dos online
                        </div>
                        <div className="text-[11px] text-[#949ba4]">
                          Mostra uma seção destacada na lista de membros lateral (Hoist).
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draftRoleHoist}
                        disabled={!permissions.manageRoles}
                        onChange={(e) => setDraftRoleHoist(e.target.checked)}
                        className="accent-[#5865f2] w-4 h-4"
                      />
                    </label>
                  )}
                </div>
              )}

              {roleEditorTab === 'permissions' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-[#949ba4] absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Buscar permissões..."
                        value={permQuery}
                        onChange={(e) => setPermQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white"
                      />
                    </div>
                    {permissions.manageRoles && editingRole.id !== 'role-host' && (
                      <button
                        type="button"
                        onClick={() => {
                          const cleared = { ...draftRolePerms };
                          (Object.keys(cleared) as PermissionKey[]).forEach((k) => {
                            cleared[k] = false;
                          });
                          setDraftRolePerms(cleared);
                        }}
                        className="text-xs text-[#60a5fa] hover:underline shrink-0"
                      >
                        Limpar permissões
                      </button>
                    )}
                    {permissions.manageRoles && editingRole.isEveryone && (
                      <button
                        type="button"
                        onClick={() => setDraftRolePerms({ ...DEFAULT_EVERYONE_PERMISSIONS })}
                        className="text-xs text-[#949ba4] hover:text-white shrink-0"
                      >
                        Restaurar padrão
                      </button>
                    )}
                  </div>

                  {PERMISSION_SECTIONS.map((sec) => {
                    const items = sec.items.filter(
                      (it) =>
                        !permQuery.trim() ||
                        it.label.toLowerCase().includes(permQuery.toLowerCase()) ||
                        it.description.toLowerCase().includes(permQuery.toLowerCase())
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={sec.section} className="space-y-2 pt-2 border-t border-[#2e3035] first:border-t-0">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">
                          {sec.section}
                        </div>
                        {items.map((item) => {
                          const enabled = Boolean(draftRolePerms[item.key]);
                          const locked = !permissions.manageRoles || editingRole.id === 'role-host';
                          return (
                            <div
                              key={item.key}
                              className="flex items-start justify-between gap-4 py-2 border-b border-[#2b2d31]/70 last:border-b-0"
                            >
                              <div className="min-w-0">
                                <div className={`text-xs font-semibold ${item.danger ? 'text-[#f23f42]' : 'text-white'}`}>
                                  {item.label}
                                </div>
                                <div className="text-[11px] text-[#949ba4] leading-snug mt-0.5">{item.description}</div>
                              </div>
                              <button
                                type="button"
                                disabled={locked}
                                onClick={() =>
                                  setDraftRolePerms((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
                                }
                                className={`w-10 h-5.5 rounded-full p-0.5 transition-colors shrink-0 ${
                                  enabled ? 'bg-[#5865f2]' : 'bg-[#4e5058]'
                                } disabled:opacity-60`}
                              >
                                <span
                                  className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                                    enabled ? 'translate-x-4.5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {roleEditorTab === 'members' && !editingRole.isEveryone && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#949ba4] absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Buscar membro para adicionar ou remover..."
                      value={memberAssignSearch}
                      onChange={(e) => setMemberAssignSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    {filteredUsersForAssign.map((u) => {
                      const hasRole =
                        (u.roleIds || []).includes(editingRole.id) ||
                        (editingRole.id === 'role-host' && u.role === 'host');
                      return (
                        <div
                          key={u.id}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#1e1f22] border border-[#2e3035]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden"
                              style={{ backgroundColor: u.avatarColor }}
                            >
                              {u.avatarUrl ? (
                                <img src={resolveUrl(u.avatarUrl)} alt="" className="w-full h-full object-cover" />
                              ) : (
                                u.displayName.slice(0, 1).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">{u.displayName}</div>
                              <div className="text-[10px] text-[#949ba4] truncate">@{u.username}</div>
                            </div>
                          </div>
                          {permissions.manageRoles && !(editingRole.id === 'role-host' && u.role === 'host') && (
                            <button
                              type="button"
                              onClick={() => handleToggleMemberRole(u.id, editingRole.id, hasRole)}
                              className={`px-2.5 py-1 rounded text-xs font-semibold ${
                                hasRole
                                  ? 'bg-[#da373c]/20 text-[#f23f42] hover:bg-[#da373c]/30'
                                  : 'bg-[#5865f2] hover:bg-[#4752c4] text-white'
                              }`}
                            >
                              {hasRole ? 'Remover' : 'Adicionar'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {permissions.manageRoles && roleEditorTab !== 'members' && (
              <div className="pt-3 border-t border-[#2e3035] flex justify-end gap-2">
                <button
                  type="button"
                  disabled={savingRole}
                  onClick={handleSaveRole}
                  className="px-4 py-2 rounded-lg bg-[#23a55a] hover:bg-[#1a8e4a] text-xs font-bold text-white flex items-center gap-1.5"
                >
                  {savingRole ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Salvar cargo
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Roles List View (Screenshot 4)
    const filteredRoles = customRoles.filter(
      (r) => !roleSearch.trim() || r.name.toLowerCase().includes(roleSearch.toLowerCase())
    );

    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-bold text-white">Cargos</h3>
          <p className="text-xs text-[#949ba4]">
            Use cargos para agrupar membros do servidor e controlar permissões granulares em canais, call e ferramentas.
          </p>
        </div>

        {/* @everyone Default Permissions Banner */}
        {everyoneRole && (
          <button
            type="button"
            onClick={() => openRoleEditor(everyoneRole, 'permissions')}
            className="w-full flex items-center justify-between p-3.5 rounded-lg bg-[#232428] hover:bg-[#2b2d31] border border-[#35373c] text-left transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#35373c] flex items-center justify-center text-[#b5bac1]">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Permissões padrão</div>
                <div className="text-xs text-[#949ba4]">@everyone • vale para todos os membros do servidor</div>
              </div>
            </div>
            <span className="text-xs text-[#b5bac1]">Editar →</span>
          </button>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#949ba4] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar cargos..."
              value={roleSearch}
              onChange={(e) => setRoleSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white"
            />
          </div>
          {permissions.manageRoles && (
            <button
              type="button"
              disabled={savingRole}
              onClick={handleCreateRole}
              className="px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-xs font-semibold text-white flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> Criar cargo
            </button>
          )}
        </div>

        <div className="border-t border-[#2e3035] pt-2">
          <div className="grid grid-cols-[1fr_90px_110px] text-[11px] font-bold uppercase text-[#949ba4] px-3 py-1.5">
            <span>Cargos — {filteredRoles.length}</span>
            <span className="text-center">Membros</span>
            <span className="text-right">Ações</span>
          </div>

          <div className="space-y-1">
            {filteredRoles.map((r, idx) => {
              const memberCount = users.filter(
                (u) => (u.roleIds || []).includes(r.id) || (r.id === 'role-host' && u.role === 'host')
              ).length;
              return (
                <div
                  key={r.id}
                  onClick={() => openRoleEditor(r, 'permissions')}
                  className="grid grid-cols-[1fr_90px_110px] items-center px-3 py-2.5 rounded-lg hover:bg-[#2b2d31] cursor-pointer group border border-transparent hover:border-[#35373c]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: r.color || '#99aab5' }} />
                    <span className="text-xs font-semibold text-white truncate">{r.name}</span>
                    {r.isSystem && <Lock className="w-3 h-3 text-[#80848e] shrink-0" />}
                  </div>

                  <div className="flex items-center justify-center gap-1 text-xs text-[#b5bac1]">
                    <span>{memberCount}</span>
                    <Users className="w-3.5 h-3.5" />
                  </div>

                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {permissions.manageRoles && (
                      <>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveRole(r.id, -1)}
                          title="Mover para cima"
                          className="p-1.5 rounded bg-[#232428] hover:bg-[#35373c] text-[#b5bac1] disabled:opacity-30"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === filteredRoles.length - 1}
                          onClick={() => handleMoveRole(r.id, 1)}
                          title="Mover para baixo"
                          className="p-1.5 rounded bg-[#232428] hover:bg-[#35373c] text-[#b5bac1] disabled:opacity-30"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => openRoleEditor(r, 'permissions')}
                      title="Editar cargo"
                      className="p-1.5 rounded bg-[#232428] hover:bg-[#35373c] text-[#b5bac1]"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    {permissions.manageRoles && !r.isSystem && (
                      <button
                        type="button"
                        onClick={() => handleDeleteRole(r)}
                        title="Excluir cargo"
                        className="p-1.5 rounded bg-[#232428] hover:bg-[#da373c]/25 text-[#f23f42]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (section === 'members') {
    const assignableRoles = roles.filter((r) => !r.isEveryone && !(r.id === 'role-host' && user.role !== 'host'));
    const filteredUsers = users.filter(
      (u) =>
        !memberSearch.trim() ||
        u.displayName.toLowerCase().includes(memberSearch.toLowerCase()) ||
        u.username.toLowerCase().includes(memberSearch.toLowerCase())
    );

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">Membros do servidor ({users.length})</h3>
            <p className="text-xs text-[#949ba4]">Gerencie cargos, expulse (Kick) ou aplique banimentos.</p>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#949ba4] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar membro por nome ou usuário..."
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white"
          />
        </div>

        <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
          {filteredUsers.map((m) => {
            const memberRoles = roles.filter((r) => !r.isEveryone && (m.roleIds || []).includes(r.id));
            const canActOn = m.id !== user.id && m.role !== 'host';
            return (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-[#1e1f22] border border-[#2e3035]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white overflow-hidden"
                      style={{ backgroundColor: m.avatarColor }}
                    >
                      {m.avatarUrl ? (
                        <img src={resolveUrl(m.avatarUrl)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        m.displayName.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <span
                      className={`w-2.5 h-2.5 rounded-full border-2 border-[#1e1f22] absolute -bottom-0.5 -right-0.5 ${
                        m.online ? 'bg-[#23a55a]' : 'bg-[#80848e]'
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className="truncate">{m.displayName}</span>
                      {m.role === 'host' && (
                        <span className="px-1.5 py-0.5 rounded bg-[#f0b232]/20 text-[#f0b232] text-[10px]">HOST</span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#949ba4]">@{m.username}</div>
                  </div>
                </div>

                {/* Role chips */}
                <div className="flex flex-wrap items-center gap-1.5 relative">
                  {memberRoles.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#2b2d31] border border-[#3f4147] text-[11px] text-white"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                      {r.name}
                      {permissions.manageRoles && !(r.id === 'role-host' && m.role === 'host') && (
                        <button
                          type="button"
                          onClick={() => handleToggleMemberRole(m.id, r.id, true)}
                          className="text-[#949ba4] hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}

                  {permissions.manageRoles && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setRoleDropdownForUser(roleDropdownForUser === m.id ? null : m.id)}
                        className="w-6 h-6 rounded-full bg-[#2b2d31] hover:bg-[#35373c] text-[#b5bac1] flex items-center justify-center"
                        title="Gerenciar cargos"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      {roleDropdownForUser === m.id && (
                        <div className="absolute right-0 top-7 z-30 w-48 rounded-lg bg-[#111214] border border-[#35373c] shadow-xl p-1.5 space-y-1">
                          {assignableRoles.map((ar) => {
                            const has = (m.roleIds || []).includes(ar.id);
                            return (
                              <button
                                key={ar.id}
                                type="button"
                                onClick={() => handleToggleMemberRole(m.id, ar.id, has)}
                                className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-[#2b2d31] text-white"
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ar.color }} />
                                  {ar.name}
                                </span>
                                {has && <Check className="w-3.5 h-3.5 text-[#5865f2]" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {canActOn && permissions.kickMembers && (
                    <button
                      type="button"
                      onClick={() => handleKick(m)}
                      className="px-2 py-1 rounded bg-[#f0b232]/15 hover:bg-[#f0b232]/25 text-[#f0b232] text-[11px] font-semibold flex items-center gap-1 ml-1"
                    >
                      <UserMinus className="w-3 h-3" /> Expulsar
                    </button>
                  )}

                  {canActOn && permissions.banMembers && (
                    <button
                      type="button"
                      onClick={() => handleBan(m)}
                      className="px-2 py-1 rounded bg-[#da373c]/20 hover:bg-[#da373c]/35 text-[#f23f42] text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Hammer className="w-3 h-3" /> Banir
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (section === 'audit') {
    const iconForAudit = (type: string) => {
      if (type === 'member_join') return <LogIn className="w-4 h-4 text-[#23a55a]" />;
      if (type === 'member_leave') return <LogOut className="w-4 h-4 text-[#f0b232]" />;
      if (type === 'member_kick') return <UserMinus className="w-4 h-4 text-[#f39c12]" />;
      if (type === 'member_ban') return <Ban className="w-4 h-4 text-[#f23f42]" />;
      if (type === 'member_unban') return <UserCheck className="w-4 h-4 text-[#2ecc71]" />;
      if (type.startsWith('voice_')) return <Volume2 className="w-4 h-4 text-[#5865f2]" />;
      if (type.startsWith('channel_')) return <Hash className="w-4 h-4 text-[#00a8fc]" />;
      if (type.startsWith('role_') || type === 'member_role') return <Shield className="w-4 h-4 text-[#9b59b6]" />;
      if (type === 'message_pin') return <Pin className="w-4 h-4 text-[#f0b232]" />;
      if (type === 'message_delete') return <MessageSquare className="w-4 h-4 text-[#f23f42]" />;
      return <Settings className="w-4 h-4 text-[#b5bac1]" />;
    };

    const actionPhrase = (e: AuditLogEntry) => {
      switch (e.type) {
        case 'member_join':
          return 'entrou no servidor';
        case 'member_leave':
          return 'saiu do servidor';
        case 'member_kick':
          return `expulsou ${e.targetName || 'usuário'}`;
        case 'member_ban':
          return `baniu ${e.targetName || 'usuário'}`;
        case 'member_unban':
          return `desbaniu ${e.targetName || 'usuário'}`;
        case 'voice_join':
          return `entrou na call ${e.targetName || ''}`;
        case 'voice_leave':
          return `saiu da call ${e.targetName || ''}`;
        case 'voice_mod':
          return `moderou áudio de ${e.targetName || 'usuário'}`;
        case 'channel_create':
          return `criou o canal #${e.targetName || ''}`;
        case 'channel_update':
          return `editou o canal #${e.targetName || ''}`;
        case 'channel_delete':
          return `excluiu o canal #${e.targetName || ''}`;
        case 'role_create':
          return `criou o cargo ${e.targetName || ''}`;
        case 'role_update':
          return `atualizou o cargo ${e.targetName || ''}`;
        case 'role_delete':
          return `excluiu o cargo ${e.targetName || ''}`;
        case 'member_role':
          return `alterou cargos de ${e.targetName || 'membro'}`;
        case 'message_delete':
          return `apagou uma mensagem em ${e.targetName || 'canal'}`;
        case 'message_pin':
          return `fixou/desfixou mensagem`;
        case 'server_update':
          return 'atualizou configurações do servidor';
        default:
          return e.type;
      }
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ScrollText className="w-5 h-5 text-[#5865f2]" /> Registro de auditoria
            </h3>
            <p className="text-xs text-[#949ba4]">
              Acompanhe entradas, saídas, expulsões, banimentos, calls, cargos e edições com filtro em tempo real.
            </p>
          </div>
          <button
            type="button"
            onClick={loadAuditLogs}
            className="px-3 py-1.5 rounded-lg bg-[#2b2d31] hover:bg-[#35373c] text-xs text-white flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingAudit ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-2">
          <select
            value={auditTypeFilter}
            onChange={(e) => setAuditTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white"
          >
            {AUDIT_TYPE_LABELS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#949ba4] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Filtrar por usuário, alvo ou detalhe..."
              value={auditQuery}
              onChange={(e) => setAuditQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#1e1f22] border border-[#3f4147] text-xs text-white"
            />
          </div>
        </div>

        {!permissions.viewAuditLog ? (
          <div className="p-4 rounded-lg bg-[#da373c]/15 border border-[#da373c]/30 text-xs text-[#f23f42] flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            Seu cargo não tem permissão para visualizar o registro de auditoria.
          </div>
        ) : loadingAudit ? (
          <div className="py-12 flex items-center justify-center text-[#949ba4] text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando registro de auditoria...
          </div>
        ) : auditEntries.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#80848e] bg-[#1e1f22] rounded-lg border border-[#2e3035]">
            Nenhum evento encontrado para esse filtro.
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {auditEntries.map((entry) => (
              <div
                key={entry.id}
                className="p-3 rounded-lg bg-[#1e1f22] border border-[#2e3035] flex items-start gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-[#2b2d31] flex items-center justify-center shrink-0 mt-0.5">
                  {iconForAudit(entry.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#dbdee1]">
                    <span className="font-bold text-white">{entry.actorName}</span>{' '}
                    <span>{actionPhrase(entry)}</span>
                  </div>
                  {(entry.details || entry.reason) && (
                    <div className="text-[11px] text-[#949ba4] mt-1">
                      {entry.details}
                      {entry.reason ? ` • Motivo: "${entry.reason}"` : ''}
                    </div>
                  )}
                  <div className="text-[10px] text-[#80848e] mt-1 flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-[#2b2d31] text-[#b5bac1]">{entry.type}</span>
                    <span>{new Date(entry.createdAt).toLocaleString('pt-BR')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Bans section
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-white">Banimentos</h3>
        <p className="text-xs text-[#949ba4]">Usuários banidos deste servidor.</p>
      </div>
      {loadingBans ? (
        <div className="py-10 flex items-center justify-center text-xs text-[#949ba4] gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando banimentos...
        </div>
      ) : bans.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#80848e] bg-[#1e1f22] rounded-lg border border-[#2e3035]">
          Nenhum usuário banido no momento.
        </div>
      ) : (
        <div className="space-y-2">
          {bans.map((b) => (
            <div
              key={b.userId}
              className="flex items-center justify-between p-3 rounded-lg bg-[#1e1f22] border border-[#2e3035]"
            >
              <div>
                <div className="text-xs font-bold text-white">
                  {b.displayName} <span className="text-[#949ba4] font-normal">(@{b.username})</span>
                </div>
                <div className="text-[11px] text-[#949ba4] mt-0.5">
                  Motivo: {b.reason || 'Sem motivo'} • Banido por {b.bannedBy} em{' '}
                  {new Date(b.bannedAt).toLocaleDateString('pt-BR')}
                </div>
              </div>
              {permissions.banMembers && (
                <button
                  type="button"
                  onClick={() => handleUnban(b.userId)}
                  className="px-3 py-1.5 rounded-lg bg-[#35373c] hover:bg-[#43464d] text-xs font-semibold text-white"
                >
                  Desbanir
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
