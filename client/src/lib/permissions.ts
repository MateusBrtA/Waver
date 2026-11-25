import { Channel, ChannelCategory, PermissionKey, Role, RolePermissions, User } from '../types';

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  'viewChannels',
  'viewPrivateChannels',
  'manageChannels',
  'manageRoles',
  'manageExpressions',
  'viewAuditLog',
  'manageServer',
  'createInvite',
  'changeNickname',
  'kickMembers',
  'banMembers',
  'sendMessages',
  'attachFiles',
  'embedLinks',
  'pinMessages',
  'manageMessages',
  'connectVoice',
  'speakVoice',
  'streamVideo',
  'useSoundboard',
  'useMediaQueue',
  'useWhiteboard',
  'useTrello',
  'muteMembers',
  'deafenMembers',
  'moveMembers',
  'administrator',
];

export const DEFAULT_EVERYONE_PERMISSIONS: RolePermissions = {
  viewChannels: true,
  createInvite: true,
  changeNickname: true,
  sendMessages: true,
  attachFiles: true,
  embedLinks: true,
  pinMessages: true,
  connectVoice: true,
  speakVoice: true,
  streamVideo: true,
  useSoundboard: true,
  useMediaQueue: true,
  useWhiteboard: true,
  useTrello: true,
  viewPrivateChannels: false,
  manageChannels: false,
  manageRoles: false,
  manageExpressions: false,
  viewAuditLog: false,
  manageServer: false,
  kickMembers: false,
  banMembers: false,
  manageMessages: false,
  muteMembers: false,
  deafenMembers: false,
  moveMembers: false,
  administrator: false,
};

export const ALL_TRUE_PERMISSIONS: RolePermissions = ALL_PERMISSION_KEYS.reduce(
  (acc, k) => {
    acc[k] = true;
    return acc;
  },
  {} as RolePermissions
);

export const PERMISSION_SECTIONS: Array<{
  section: string;
  items: Array<{ key: PermissionKey; label: string; description: string; danger?: boolean }>;
}> = [
  {
    section: 'Permissões gerais do servidor',
    items: [
      { key: 'viewChannels', label: 'Ver canais', description: 'Permite que os membros vejam os canais públicos do servidor.' },
      {
        key: 'viewPrivateChannels',
        label: 'Ver e acessar canais privados',
        description: 'Permite visualizar e entrar em canais de texto e voz marcados como privados.',
      },
      {
        key: 'manageChannels',
        label: 'Gerenciar canais',
        description: 'Permite que os membros criem, editem, dupliquem ou excluam canais de texto, áudio e categorias.',
      },
      {
        key: 'manageRoles',
        label: 'Gerenciar cargos',
        description: 'Permite criar novos cargos, editar permissões e atribuir cargos aos membros.',
      },
      {
        key: 'manageExpressions',
        label: 'Gerenciar expressões',
        description: 'Permite adicionar, editar e remover GIFs e sons do Soundboard.',
      },
      {
        key: 'viewAuditLog',
        label: 'Ver o registro de auditoria',
        description: 'Permite visualizar o histórico completo de entradas, saídas, kicks, bans e alterações.',
      },
      {
        key: 'manageServer',
        label: 'Gerenciar servidor',
        description: 'Permite alterar nome, ícone, capa, senha de convite e configurações do servidor.',
      },
    ],
  },
  {
    section: 'Permissões da assinatura e moderação',
    items: [
      { key: 'createInvite', label: 'Criar convite', description: 'Permite copiar e compartilhar convites/IPs para novas pessoas entrarem.' },
      { key: 'changeNickname', label: 'Alterar apelido', description: 'Permite mudar seu próprio apelido no servidor.' },
      { key: 'kickMembers', label: 'Expulsar membros (Kick)', description: 'Permite expulsar temporariamente membros da chamada/servidor.', danger: true },
      { key: 'banMembers', label: 'Banir membros', description: 'Permite banir permanentemente usuários do servidor.', danger: true },
    ],
  },
  {
    section: 'Permissões de canal de texto',
    items: [
      { key: 'sendMessages', label: 'Enviar mensagens', description: 'Permite enviar mensagens de texto nos canais.' },
      { key: 'attachFiles', label: 'Enviar arquivos e áudios', description: 'Permite enviar imagens, arquivos pesados até 2 GB e áudios de voz no chat.' },
      { key: 'embedLinks', label: 'Inserir links e vídeos', description: 'Permite incorporar players de YouTube, links e blocos de código.' },
      { key: 'pinMessages', label: 'Fixar mensagens', description: 'Permite fixar ou desafixar mensagens importantes nos canais.' },
      { key: 'manageMessages', label: 'Gerenciar mensagens', description: 'Permite apagar mensagens de outros usuários e ignorar Modo Lento.' },
    ],
  },
  {
    section: 'Permissões de canal de voz e aplicativos',
    items: [
      { key: 'connectVoice', label: 'Conectar em voz', description: 'Permite entrar nas salas de chamada de áudio e vídeo.' },
      { key: 'speakVoice', label: 'Falar', description: 'Permite usar o microfone em canais de voz.' },
      { key: 'streamVideo', label: 'Vídeo / Transmitir tela (Parsec)', description: 'Permite ligar câmera, compartilhar tela 1080p120 e usar controle remoto.' },
      { key: 'useSoundboard', label: 'Usar Soundpad', description: 'Permite tocar efeitos sonoros do painel de sons na chamada.' },
      { key: 'useMediaQueue', label: 'Colocar músicas e vídeos na fila', description: 'Permite adicionar e controlar músicas (Spotify/YouTube) e vídeos na call.' },
      { key: 'useWhiteboard', label: 'Usar Whiteboard', description: 'Permite desenhar, colar imagens e escrever na lousa colaborativa em chamada.' },
      { key: 'useTrello', label: 'Usar Quadros Trello', description: 'Permite criar e mover projetos e tarefas no Trello do servidor.' },
      { key: 'muteMembers', label: 'Silenciar membros', description: 'Permite silenciar o microfone de outras pessoas no servidor.' },
      { key: 'deafenMembers', label: 'Desativar áudio de membros', description: 'Permite ensurdecer outros usuários nas salas de voz.' },
      { key: 'moveMembers', label: 'Mover membros', description: 'Permite mover usuários de um canal de voz para outro.' },
    ],
  },
  {
    section: 'Avançado',
    items: [
      {
        key: 'administrator',
        label: 'Administrador',
        description: 'Concede todas as permissões do servidor e ignora bloqueios de canais privados.',
        danger: true,
      },
    ],
  },
];

export function computeServerPermissions(user: User | null | undefined, roles: Role[]): RolePermissions {
  if (!user) {
    return ALL_PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: false }), {} as RolePermissions);
  }
  if (user.role === 'host') return { ...ALL_TRUE_PERMISSIONS };

  const everyone = roles.find((r) => r.id === 'role-everyone' || r.isEveryone);
  const perms: RolePermissions = { ...DEFAULT_EVERYONE_PERMISSIONS };
  if (everyone?.permissions) {
    for (const key of ALL_PERMISSION_KEYS) {
      if (typeof everyone.permissions[key] === 'boolean') perms[key] = Boolean(everyone.permissions[key]);
    }
  }

  for (const rid of user.roleIds || []) {
    const r = roles.find((x) => x.id === rid);
    if (!r?.permissions) continue;
    if (r.permissions.administrator) return { ...ALL_TRUE_PERMISSIONS };
    for (const key of ALL_PERMISSION_KEYS) {
      if (r.permissions[key]) perms[key] = true;
    }
  }
  return perms;
}

export function computeChannelPermissions(
  user: User | null | undefined,
  roles: Role[],
  channel: Channel | null | undefined,
  categories: ChannelCategory[] = []
): RolePermissions {
  const perms = computeServerPermissions(user, roles);
  if (!user || perms.administrator || user.role === 'host' || !channel) return perms;

  const cat = channel.categoryId ? categories.find((c) => c.id === channel.categoryId) : undefined;
  if ((channel.isPrivate || cat?.isPrivate) && !perms.viewPrivateChannels) {
    perms.viewChannels = false;
  }

  const applyOverwrites = (overwrites?: Channel['overwrites']) => {
    if (!overwrites || overwrites.length === 0) return;
    const roleIds = user.roleIds || [];
    const ev = overwrites.find((o) => o.id === 'role-everyone');
    if (ev) {
      for (const k of ev.deny || []) perms[k] = false;
      for (const k of ev.allow || []) perms[k] = true;
    }
    const rAllow = new Set<PermissionKey>();
    const rDeny = new Set<PermissionKey>();
    for (const o of overwrites) {
      if (o.targetType === 'role' && o.id !== 'role-everyone' && roleIds.includes(o.id)) {
        for (const k of o.deny || []) rDeny.add(k);
        for (const k of o.allow || []) rAllow.add(k);
      }
    }
    for (const k of rDeny) if (!rAllow.has(k)) perms[k] = false;
    for (const k of rAllow) perms[k] = true;

    const mem = overwrites.find((o) => o.id === user.id);
    if (mem) {
      for (const k of mem.deny || []) perms[k] = false;
      for (const k of mem.allow || []) perms[k] = true;
    }
  };

  applyOverwrites(cat?.overwrites);
  applyOverwrites(channel.overwrites);

  if (!perms.viewChannels) {
    perms.sendMessages = false;
    perms.connectVoice = false;
  }
  return perms;
}
