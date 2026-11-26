import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Palette,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  buildExternalAiPromptTemplate,
  DEFAULT_THEME_CONFIG,
  generateOfflineCssFromPrompt,
  generateOnlineAiCss,
  THEME_PRESETS,
} from '../lib/themeEngine';
import { ThemeConfig } from '../types';

interface AppearanceSettingsTabProps {
  themeConfig: ThemeConfig;
  onUpdateTheme: (next: ThemeConfig) => void;
}

const FONT_OPTIONS = [
  { label: 'Inter / Sistema (Moderna)', value: "'Inter', 'Segoe UI', system-ui, sans-serif" },
  { label: 'JetBrains / Cascadia Mono (Linux Dev)', value: "'Cascadia Code', 'JetBrains Mono', monospace" },
  { label: 'Segoe UI (Windows Nativo)', value: "'Segoe UI', Tahoma, sans-serif" },
  { label: 'Georgia / Editorial', value: "Georgia, serif" },
];

export const AppearanceSettingsTab: React.FC<AppearanceSettingsTabProps> = ({
  themeConfig,
  onUpdateTheme,
}) => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiEndpoint, setAiEndpoint] = useState('http://localhost:11434');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('llama3.1');
  const [showLlmConfig, setShowLlmConfig] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const handleSelectPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onUpdateTheme({
      ...preset.config,
      presetId: preset.id,
      safeMode: false,
    });
    setAiMessage(`Tema "${preset.name}" aplicado!`);
  };

  const handleGenerateOffline = () => {
    if (!aiPrompt.trim()) {
      setAiMessage('Descreva o visual que você quer (ex: "roxo cyberpunk com bordas animadas e vidro").');
      return;
    }
    const { patch, summary } = generateOfflineCssFromPrompt(aiPrompt);
    onUpdateTheme({ ...themeConfig, ...patch });
    setAiMessage(summary);
  };

  const handleGenerateWithLlm = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiMessage('');
    try {
      const css = await generateOnlineAiCss({
        prompt: aiPrompt,
        endpointUrl: aiEndpoint,
        apiKey: aiApiKey,
        model: aiModel,
      });
      if (!css) throw new Error('A IA retornou CSS vazio.');
      onUpdateTheme({ ...themeConfig, presetId: 'custom', customCss: css, safeMode: false });
      setAiMessage('CSS gerado via LLM e aplicado ao vivo!');
    } catch (err: unknown) {
      setAiMessage((err as Error).message || 'Erro ao conectar na IA externa. Use o Gerador Instantâneo Grátis!');
    } finally {
      setAiLoading(false);
    }
  };

  const handleExportCss = () => {
    const content = `/* Waver Theme Preset (${themeConfig.presetId}) */\n${themeConfig.customCss || ''}`;
    const blob = new Blob([content], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulsecord-${themeConfig.presetId || 'custom'}.css`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCss = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onUpdateTheme({
        ...themeConfig,
        presetId: 'custom',
        customCss: String(reader.result || ''),
        safeMode: false,
      });
      setAiMessage(`Tema "${file.name}" importado com sucesso!`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      {/* Presets Gallery */}
      <div className="bg-[#2b2d31] border border-[#404249] rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-white text-sm">
            <Palette className="w-4 h-4 text-[#5865f2]" />
            <span>Temas Prontos (Estilo Discord & Linux Ricing)</span>
          </div>
          <button
            type="button"
            onClick={() => onUpdateTheme({ ...DEFAULT_THEME_CONFIG })}
            className="px-2.5 py-1 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-[#b5bac1] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Resetar Padrão
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {THEME_PRESETS.map((p) => {
            const active = themeConfig.presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPreset(p.id)}
                className={`text-left p-3 rounded-lg border transition cursor-pointer ${
                  active
                    ? 'bg-[#5865f2]/15 border-[#5865f2] shadow-md'
                    : 'bg-[#1e1f22] border-[#383a40] hover:border-[#3e4661]'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1">
                    {p.preview.map((col, idx) => (
                      <span key={idx} className="w-4 h-4 rounded-full border border-white/15" style={{ backgroundColor: col }} />
                    ))}
                  </div>
                  {active && <Check className="w-4 h-4 text-[#4ade80]" />}
                </div>
                <div className="text-xs font-bold text-white">{p.name}</div>
                <div className="text-[11px] text-[#949ba4] line-clamp-2 mt-0.5">{p.tagline}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Visual Controls (Color, Radius, Opacity, Wallpaper, Font) */}
      <div className="bg-[#2b2d31] border border-[#404249] rounded-lg p-4 space-y-3">
        <div className="font-bold text-white text-sm">Ajustes Visuais Rápidos</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="font-bold text-[#949ba4] uppercase">Cor de Destaque</span>
            <div className="flex items-center gap-2 bg-[#1e1f22] border border-[#404249] rounded-lg px-2.5 py-1.5">
              <input
                type="color"
                value={themeConfig.accentColor}
                onChange={(e) => onUpdateTheme({ ...themeConfig, accentColor: e.target.value })}
                className="w-7 h-7 rounded cursor-pointer bg-transparent"
              />
              <span className="font-mono text-white">{themeConfig.accentColor}</span>
            </div>
          </label>

          <label className="space-y-1">
            <span className="font-bold text-[#949ba4] uppercase">Fonte do Sistema</span>
            <select
              value={themeConfig.fontFamily}
              onChange={(e) => onUpdateTheme({ ...themeConfig, fontFamily: e.target.value })}
              className="w-full bg-[#1e1f22] border border-[#404249] rounded-lg px-2.5 py-2 text-white outline-none"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.label} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="font-bold text-[#949ba4] uppercase">Arredondamento</span>
              <span className="font-mono text-white">{themeConfig.borderRadiusPx}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              value={themeConfig.borderRadiusPx}
              onChange={(e) => onUpdateTheme({ ...themeConfig, borderRadiusPx: Number(e.target.value) })}
              className="w-full accent-[#5865f2] cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="font-bold text-[#949ba4] uppercase">Transparência / Vidro</span>
              <span className="font-mono text-white">{Math.round(themeConfig.glassOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.55}
              max={1}
              step={0.02}
              value={themeConfig.glassOpacity}
              onChange={(e) => onUpdateTheme({ ...themeConfig, glassOpacity: Number(e.target.value) })}
              className="w-full accent-[#5865f2] cursor-pointer"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <input
            type="url"
            value={themeConfig.wallpaperUrl}
            onChange={(e) => onUpdateTheme({ ...themeConfig, wallpaperUrl: e.target.value })}
            placeholder="URL de Papel de Parede de fundo (opcional)..."
            className="sm:col-span-2 bg-[#1e1f22] border border-[#404249] rounded-lg px-3 py-2 text-white outline-none focus:border-[#5865f2]"
          />
          <div className="flex items-center gap-2 bg-[#1e1f22] border border-[#404249] rounded-lg px-2.5">
            <span className="text-[11px] text-[#949ba4]">Blur</span>
            <input
              type="range"
              min={0}
              max={24}
              value={themeConfig.wallpaperBlurPx}
              onChange={(e) => onUpdateTheme({ ...themeConfig, wallpaperBlurPx: Number(e.target.value) })}
              className="flex-1 accent-[#5865f2] cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* AI CSS Theme Studio */}
      <div className="bg-gradient-to-br from-[#2b2d31] to-[#1a162b] border border-[#5865f2]/40 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 font-bold text-white text-sm">
            <Sparkles className="w-4 h-4 text-[#eb459e]" />
            <span>Estúdio CSS com IA (Estilo Hyprland / BetterDiscord)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(buildExternalAiPromptTemplate(aiPrompt)).catch(() => {});
                setCopiedPrompt(true);
                window.setTimeout(() => setCopiedPrompt(false), 2000);
              }}
              className="px-2.5 py-1 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-[#dbdee1] text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              title="Copia o prompt técnico completo para colar no ChatGPT / Claude / Gemini"
            >
              {copiedPrompt ? <Check className="w-3 h-3 text-[#4ade80]" /> : <Copy className="w-3 h-3" />}
              {copiedPrompt ? 'Prompt Copiado!' : 'Copiar Prompt p/ IA Externa'}
            </button>
            <button
              type="button"
              onClick={() => setShowLlmConfig((v) => !v)}
              className="px-2.5 py-1 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-[#a5b4fc] text-[11px] font-semibold cursor-pointer"
            >
              {showLlmConfig ? 'Ocultar API/Ollama' : 'Conectar Ollama / OpenAI'}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-[#b5bac1]">
          Descreva o visual e animações desejados em português — os botões principais e controles continuam sempre nos
          lugares!
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleGenerateOffline();
            }}
            placeholder='Ex: "Tema cyberpunk roxo e ciano com vidro fosco e borda neon animada"'
            className="flex-1 bg-[#1e1f22] border border-[#404249] rounded-lg px-3 py-2 text-white outline-none focus:border-[#eb459e]"
          />
          <button
            type="button"
            onClick={handleGenerateOffline}
            className="px-3.5 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Wand2 className="w-4 h-4" />
            Gerar IA Grátis
          </button>
          {showLlmConfig && (
            <button
              type="button"
              onClick={handleGenerateWithLlm}
              disabled={aiLoading}
              className="px-3.5 py-2 rounded-lg bg-[#eb459e] hover:bg-[#db2777] disabled:opacity-50 text-white font-bold cursor-pointer shrink-0"
            >
              {aiLoading ? 'Gerando...' : 'Usar LLM'}
            </button>
          )}
        </div>

        {showLlmConfig && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <input
              type="text"
              value={aiEndpoint}
              onChange={(e) => setAiEndpoint(e.target.value)}
              placeholder="Endpoint (ex: http://localhost:11434)"
              className="bg-[#1e1f22] border border-[#404249] rounded-lg px-2.5 py-1.5 text-white outline-none"
            />
            <input
              type="text"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="Modelo (ex: llama3.1 / gpt-4o-mini)"
              className="bg-[#1e1f22] border border-[#404249] rounded-lg px-2.5 py-1.5 text-white outline-none"
            />
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder="API Key (vazio p/ Ollama local)"
              className="bg-[#1e1f22] border border-[#404249] rounded-lg px-2.5 py-1.5 text-white outline-none"
            />
          </div>
        )}

        {aiMessage && (
          <div className="text-[11px] bg-[#23a55a]/15 border border-[#23a55a]/40 text-[#86efac] px-3 py-1.5 rounded-lg">
            {aiMessage}
          </div>
        )}

        {/* Live CSS Code Editor */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="font-bold text-[#949ba4] uppercase">Editor CSS ao Vivo</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateTheme({ ...themeConfig, safeMode: !themeConfig.safeMode })}
                className={`px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                  themeConfig.safeMode ? 'bg-[#f0b232] text-[#111214]' : 'bg-[#383a40] text-[#dbdee1]'
                }`}
                title="Pausa instantaneamente o CSS customizado (atalho: Ctrl+Shift+F12)"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                {themeConfig.safeMode ? 'Modo Seguro Ativo' : 'Modo Seguro (Ctrl+Shift+F12)'}
              </button>
              <label className="px-2 py-1 rounded bg-[#383a40] hover:bg-[#4e5058] text-[#dbdee1] text-[11px] font-semibold flex items-center gap-1 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Importar .css
                <input type="file" accept=".css,text/css" className="hidden" onChange={handleImportCss} />
              </label>
              <button
                type="button"
                onClick={handleExportCss}
                className="px-2 py-1 rounded bg-[#383a40] hover:bg-[#4e5058] text-[#dbdee1] text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar .css
              </button>
            </div>
          </div>

          <textarea
            rows={8}
            value={themeConfig.customCss}
            onChange={(e) => onUpdateTheme({ ...themeConfig, presetId: 'custom', customCss: e.target.value })}
            spellCheck={false}
            placeholder={`/* Cole seu CSS aqui ou gere acima com IA!\nVariáveis: --pc-bg-rail, --pc-bg-sidebar, --pc-bg-main, --pc-bg-surface, --pc-accent\nClasses: .pc-rail, .pc-sidebar, .pc-chat, .pc-composer, .pc-message, .pc-user-dock */`}
            className="w-full bg-[#111214] border border-[#404249] rounded-lg p-3 font-mono text-[11px] text-[#a5f3fc] outline-none focus:border-[#5865f2] resize-y"
          />
        </div>
      </div>
    </div>
  );
};
