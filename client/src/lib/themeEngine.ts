import { ThemeConfig } from '../types';

export interface ThemePreset {
  id: string;
  name: string;
  tagline: string;
  preview: [string, string, string];
  config: Omit<ThemeConfig, 'presetId' | 'safeMode'>;
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  presetId: 'obsidian',
  accentColor: '#5865f2',
  borderRadiusPx: 8,
  glassOpacity: 1,
  wallpaperUrl: '',
  wallpaperBlurPx: 0,
  fontFamily: "'gg sans', 'Noto Sans', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  customCss: '',
  safeMode: false,
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'obsidian',
    name: 'Escuro (padrão)',
    tagline: 'Cores do tema escuro do Discord',
    preview: ['#1e1f22', '#313338', '#5865f2'],
    config: {
      accentColor: '#5865f2',
      borderRadiusPx: 8,
      glassOpacity: 1,
      wallpaperUrl: '',
      wallpaperBlurPx: 0,
      fontFamily: "'gg sans', 'Noto Sans', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      customCss: '',
    },
  },
  {
    id: 'amoled',
    name: 'AMOLED Pitch Black',
    tagline: 'Preto puro #000000 com bordas sutis para OLED',
    preview: ['#000000', '#070709', '#6366f1'],
    config: {
      accentColor: '#6366f1',
      borderRadiusPx: 12,
      glassOpacity: 1,
      wallpaperUrl: '',
      wallpaperBlurPx: 0,
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      customCss: `:root {
  --pc-bg-rail: #000000;
  --pc-bg-sidebar: #050507;
  --pc-bg-main: #08090c;
  --pc-bg-surface: #232428;
  --pc-bg-dock: #030304;
  --pc-border: rgba(255, 255, 255, 0.08);
}`,
    },
  },
  {
    id: 'hyprland-cyber',
    name: 'Hyprland Cyber',
    tagline: 'Ricing Linux com bordas neon animadas e glow',
    preview: ['#090614', '#120d26', '#ec4899'],
    config: {
      accentColor: '#ec4899',
      borderRadiusPx: 14,
      glassOpacity: 0.94,
      wallpaperUrl: '',
      wallpaperBlurPx: 0,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Segoe UI', monospace",
      customCss: `@keyframes cyberBorder {
  0%, 100% { border-color: rgba(236, 72, 153, 0.45); }
  50% { border-color: rgba(6, 182, 212, 0.55); }
}
:root {
  --pc-bg-rail: #070510;
  --pc-bg-sidebar: #0d0a1a;
  --pc-bg-main: #110d22;
  --pc-bg-surface: #181330;
  --pc-bg-dock: #080612;
}
.pc-composer {
  border: 1px solid rgba(236, 72, 153, 0.45) !important;
  animation: cyberBorder 4s ease-in-out infinite;
  box-shadow: 0 0 18px rgba(236, 72, 153, 0.14);
}
.pc-message:hover {
  background: linear-gradient(90deg, rgba(236,72,153,0.08), transparent) !important;
}`,
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    tagline: 'Paleta dev pastel favorita da comunidade Linux',
    preview: ['#11111b', '#1e1e2e', '#cba6f7'],
    config: {
      accentColor: '#cba6f7',
      borderRadiusPx: 12,
      glassOpacity: 1,
      wallpaperUrl: '',
      wallpaperBlurPx: 0,
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      customCss: `:root {
  --pc-bg-rail: #11111b;
  --pc-bg-sidebar: #181825;
  --pc-bg-main: #1e1e2e;
  --pc-bg-surface: #252538;
  --pc-bg-dock: #141420;
  --pc-text: #cdd6f4;
  --pc-text-muted: #a6adc8;
}`,
    },
  },
  {
    id: 'emerald-matrix',
    name: 'Emerald Terminal',
    tagline: 'Hackerman verde esmeralda com brilho suave',
    preview: ['#040b07', '#08150f', '#22c55e'],
    config: {
      accentColor: '#22c55e',
      borderRadiusPx: 8,
      glassOpacity: 1,
      wallpaperUrl: '',
      wallpaperBlurPx: 0,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      customCss: `:root {
  --pc-bg-rail: #030906;
  --pc-bg-sidebar: #06120c;
  --pc-bg-main: #091811;
  --pc-bg-surface: #0e2419;
  --pc-bg-dock: #040b07;
  --pc-border: rgba(34, 197, 94, 0.18);
}`,
    },
  },
  {
    id: 'nord',
    name: 'Nordic Slate',
    tagline: 'Minimalista ártico limpo de baixo contraste',
    preview: ['#1b2029', '#242933', '#88c0d0'],
    config: {
      accentColor: '#5e81ac',
      borderRadiusPx: 10,
      glassOpacity: 1,
      wallpaperUrl: '',
      wallpaperBlurPx: 0,
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      customCss: `:root {
  --pc-bg-rail: #1a1f28;
  --pc-bg-sidebar: #212732;
  --pc-bg-main: #262c38;
  --pc-bg-surface: #2e3440;
  --pc-bg-dock: #1c212b;
}`,
    },
  },
];

const COLOR_KEYWORDS: Array<{ keys: string[]; hex: string; name: string }> = [
  { keys: ['roxo', 'purple', 'violet', 'lilás', 'roxa'], hex: '#9333ea', name: 'Roxo' },
  { keys: ['rosa', 'pink', 'magenta'], hex: '#ec4899', name: 'Rosa' },
  { keys: ['ciano', 'cyan', 'azul claro', 'aqua'], hex: '#06b6d4', name: 'Ciano' },
  { keys: ['azul', 'blue', 'cobalt'], hex: '#3b82f6', name: 'Azul' },
  { keys: ['verde', 'green', 'matrix', 'esmeralda', 'emerald'], hex: '#22c55e', name: 'Verde' },
  { keys: ['vermelho', 'red', 'crimson', 'sangue', 'fogo'], hex: '#ef4444', name: 'Vermelho' },
  { keys: ['laranja', 'orange', 'amber'], hex: '#f97316', name: 'Laranja' },
  { keys: ['dourado', 'gold', 'amarelo', 'yellow'], hex: '#eab308', name: 'Dourado' },
];

export function applyThemeConfig(cfg: ThemeConfig) {
  const root = document.documentElement;
  root.style.setProperty('--pc-accent', cfg.accentColor || '#5865f2');
  root.style.setProperty('--pc-radius', `${Math.max(0, Math.min(24, cfg.borderRadiusPx ?? 10))}px`);
  root.style.setProperty('--pc-glass-opacity', String(Math.max(0.45, Math.min(1, cfg.glassOpacity ?? 1))));
  root.style.setProperty('--pc-font', cfg.fontFamily || "'Inter', 'Segoe UI', system-ui, sans-serif");
  root.style.setProperty('--pc-wallpaper', cfg.wallpaperUrl ? `url("${cfg.wallpaperUrl.replace(/"/g, '')}")` : 'none');
  root.style.setProperty('--pc-wallpaper-blur', `${cfg.wallpaperBlurPx || 0}px`);

  let styleEl = document.getElementById('pulsecord-custom-css') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'pulsecord-custom-css';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = cfg.safeMode ? '/* Modo Seguro ativo: CSS customizado pausado */' : cfg.customCss || '';

  try {
    localStorage.setItem('pulsecord_theme_config', JSON.stringify(cfg));
  } catch {}
}

export function loadSavedThemeLocal(): ThemeConfig {
  try {
    const raw = localStorage.getItem('pulsecord_theme_config');
    if (raw) return { ...DEFAULT_THEME_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_THEME_CONFIG;
}

export function generateOfflineCssFromPrompt(prompt: string): {
  patch: Partial<ThemeConfig>;
  summary: string;
} {
  const lower = prompt.toLowerCase();

  let accent = '#5865f2';
  for (const ck of COLOR_KEYWORDS) {
    if (ck.keys.some((k) => lower.includes(k))) {
      accent = ck.hex;
      break;
    }
  }

  const isCyber = /cyber|neon|hypr|synth|vapor|rgb|gamer/.test(lower);
  const isGlass = /vidro|glass|transpar|blur|fosco/.test(lower);
  const isAmoled = /amoled|oled|preto|black|escuro/.test(lower);
  const isRetro = /retro|matrix|terminal|linux|arch|mono|dev/.test(lower);
  const hasAnim = /anim|pulso|brilh|glow|rgb|arco|float|suave/.test(lower);
  const isRound = /arredond|round|redond|suave|mac/.test(lower);

  const bgRail = isAmoled ? '#000000' : isCyber ? '#070512' : '#111214';
  const bgSidebar = isAmoled ? '#050507' : isCyber ? '#0d0a1e' : '#0f121a';
  const bgMain = isAmoled ? '#08090d' : isCyber ? '#120e28' : '#131722';
  const bgSurface = isAmoled ? '#10121a' : isCyber ? '#1a1536' : '#1a1f2c';
  const radius = isRound ? 16 : isRetro ? 6 : 12;
  const opacity = isGlass ? 0.86 : 1;
  const font = isRetro
    ? "'Cascadia Code', 'JetBrains Mono', monospace"
    : "'Inter', 'Segoe UI', system-ui, sans-serif";

  const chunks: string[] = [
    `/* Tema gerado por IA Waver: "${prompt.slice(0, 60)}" */`,
    `:root {`,
    `  --pc-bg-rail: ${bgRail};`,
    `  --pc-bg-sidebar: ${bgSidebar};`,
    `  --pc-bg-main: ${bgMain};`,
    `  --pc-bg-surface: ${bgSurface};`,
    `  --pc-bg-dock: ${bgRail};`,
    `  --pc-border: ${accent}38;`,
    `}`,
  ];

  if (isGlass) {
    chunks.push(`.pc-sidebar, .pc-chat, .pc-member-list, .pc-modal { backdrop-filter: blur(14px); }`);
  }

  if (hasAnim || isCyber) {
    chunks.push(`@keyframes aiAccentPulse {
  0%, 100% { box-shadow: 0 0 12px ${accent}44; border-color: ${accent}66; }
  50% { box-shadow: 0 0 24px ${accent}88; border-color: ${accent}; }
}
.pc-composer {
  animation: aiAccentPulse 3.2s ease-in-out infinite;
}
.pc-message {
  transition: transform 0.16s ease, background-color 0.16s ease;
}
.pc-message:hover {
  transform: translateX(3px);
  background: linear-gradient(90deg, ${accent}18, transparent) !important;
}`);
  } else {
    chunks.push(`.pc-composer {
  border-color: ${accent}45 !important;
  box-shadow: 0 6px 24px rgba(0,0,0,0.35);
}`);
  }

  return {
    patch: {
      presetId: 'custom',
      accentColor: accent,
      borderRadiusPx: radius,
      glassOpacity: opacity,
      fontFamily: font,
      customCss: chunks.join('\n'),
      safeMode: false,
    },
    summary: `CSS gerado com destaque ${accent}${isCyber ? ' • estilo Neon/Hyprland' : ''}${isGlass ? ' • vidro translúcido' : ''}${hasAnim ? ' • animações fluidas' : ''}.`,
  };
}

export async function generateOnlineAiCss(opts: {
  prompt: string;
  endpointUrl: string;
  apiKey: string;
  model: string;
}): Promise<string> {
  const systemPrompt = `You are an expert UI theme designer for Waver (a Discord-like desktop app).
Return ONLY valid CSS (no markdown code fences, no explanations).
Target these CSS variables in :root:
--pc-bg-rail, --pc-bg-sidebar, --pc-bg-main, --pc-bg-surface, --pc-bg-elevated, --pc-bg-dock, --pc-border, --pc-text, --pc-text-muted, --pc-accent, --pc-radius
Target these component classes:
.pc-titlebar, .pc-rail, .pc-sidebar, .pc-chat, .pc-voice-stage, .pc-member-list, .pc-user-dock, .pc-composer, .pc-message, .pc-modal
You can add @keyframes animations, hover transitions, gradients, glassmorphism, or borders, while keeping layout readable and functional.`;

  const isOllama = opts.endpointUrl.includes('11434') || (!opts.apiKey && opts.endpointUrl.includes('localhost'));
  if (isOllama && !opts.endpointUrl.includes('/v1/')) {
    const resp = await fetch(`${opts.endpointUrl.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || 'llama3.1',
        prompt: `${systemPrompt}\n\nUser request: ${opts.prompt}`,
        stream: false,
      }),
    });
    const data = await resp.json();
    return stripCodeFences(String(data?.response || ''));
  }

  const base = (opts.endpointUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: opts.prompt },
      ],
      temperature: 0.7,
    }),
  });
  if (!resp.ok) throw new Error(`API retornou HTTP ${resp.status}`);
  const data = await resp.json();
  return stripCodeFences(String(data?.choices?.[0]?.message?.content || ''));
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:css)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

export function buildExternalAiPromptTemplate(userWish: string): string {
  return `Gere apenas código CSS puro para personalizar o app Waver (estilo Discord / ricing Linux).
Variáveis CSS disponíveis em :root:
--pc-bg-rail, --pc-bg-sidebar, --pc-bg-main, --pc-bg-surface, --pc-bg-dock, --pc-border, --pc-text, --pc-text-muted, --pc-accent, --pc-radius
Classes disponíveis:
.pc-titlebar, .pc-rail, .pc-sidebar, .pc-chat, .pc-voice-stage, .pc-member-list, .pc-user-dock, .pc-composer, .pc-message, .pc-modal

Estilo desejado: ${userWish || 'Dark moderno estilo Hyprland com animações sutis nas mensagens e caixa de texto'}`;
}
