import React, { useEffect, useState } from 'react';
import {
  DEFAULT_DESKTOP_PREFS,
  DesktopPrefs,
  keyEventToAccelerator,
  prettyAccelerator,
  updateDesktopPrefs,
  useDesktopPrefs,
} from '../lib/desktopPrefs';

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ on, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`relative mt-0.5 w-10 h-6 rounded-full shrink-0 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
      on ? 'bg-[#23a55a]' : 'bg-[#80848e]'
    }`}
  >
    <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all ${on ? 'left-[19px]' : 'left-[3px]'}`} />
  </button>
);

const Row: React.FC<{ title: string; desc?: React.ReactNode; children: React.ReactNode }> = ({ title, desc, children }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <div className="text-[15px] font-medium text-[#dbdee1]">{title}</div>
      {desc && <p className="text-[13px] text-[#949ba4] mt-1 leading-snug">{desc}</p>}
    </div>
    {children}
  </div>
);

const SHORTCUT_LABELS: Record<keyof DesktopPrefs['shortcuts'], string> = {
  mute: 'Silenciar / ativar microfone',
  deafen: 'Desativar / ativar áudio',
  overlay: 'Mostrar / esconder overlay',
  clip: 'Salvar clipe da chamada',
};

const ShortcutEditor: React.FC<{ action: keyof DesktopPrefs['shortcuts']; value: string }> = ({ action, value }) => {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      const acc = keyEventToAccelerator(e);
      if (!acc) return;
      updateDesktopPrefs({ shortcuts: { [action]: acc } as DesktopPrefs['shortcuts'] });
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, action]);

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[14px] text-[#dbdee1]">{SHORTCUT_LABELS[action]}</span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setRecording((r) => !r)}
          className={`min-w-[150px] h-8 px-3 rounded text-[13px] font-mono cursor-pointer border ${
            recording ? 'border-[#f23f43] text-[#f23f43] bg-[#1e1f22] animate-pulse' : 'border-[#3f4147] text-white bg-[#1e1f22] hover:border-[#5865f2]'
          }`}
        >
          {recording ? 'Pressione as teclas…' : value ? prettyAccelerator(value) : 'Nenhum'}
        </button>
        {value && !recording && (
          <button
            type="button"
            onClick={() => updateDesktopPrefs({ shortcuts: { [action]: '' } as DesktopPrefs['shortcuts'] })}
            className="text-[12px] text-[#949ba4] hover:text-white cursor-pointer"
          >
            Limpar
          </button>
        )}
      </div>
    </div>
  );
};

/** Integração com o Windows: notificações, atalhos globais, overlay, "ouvindo agora" e menu do Explorer. */
export const WindowsIntegrationSettings: React.FC = () => {
  const prefs = useDesktopPrefs();
  const api = window.electronAPI;
  const [shareMenu, setShareMenu] = useState<{ supported: boolean; enabled: boolean } | null>(null);
  const [shareMsg, setShareMsg] = useState('');

  useEffect(() => {
    api?.getShareMenu?.().then(setShareMenu).catch(() => setShareMenu(null));
  }, [api]);

  if (!api) {
    return <p className="text-[13px] text-[#949ba4]">Essas opções existem só no app do PulseCord para Windows.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#b5bac1]">Notificações</div>
      <Row
        title="Notificações do Windows"
        desc="Mostra um aviso no canto da tela quando chega uma mensagem e o PulseCord não está em foco. Respeita o nível de notificação de cada canal e o modo Não perturbe."
      >
        <Switch on={prefs.notifications} onChange={(v) => updateDesktopPrefs({ notifications: v })} />
      </Row>
      <Row title="Som nas notificações de canais" desc="As mensagens diretas já tocam o som do PulseCord.">
        <Switch on={prefs.notificationSound} disabled={!prefs.notifications} onChange={(v) => updateDesktopPrefs({ notificationSound: v })} />
      </Row>
      <button
        type="button"
        disabled={!prefs.notifications}
        onClick={() =>
          api.showNotification?.({ title: 'PulseCord', body: 'As notificações estão funcionando.', route: null }).catch(() => {})
        }
        className="h-8 px-3 rounded bg-[#4e5058] hover:bg-[#6d6f78] text-white text-[13px] font-medium cursor-pointer disabled:opacity-40"
      >
        Testar notificação
      </button>

      <div className="h-px bg-[#3f4147]" />
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#b5bac1]">Atalhos globais</div>
      <p className="text-[13px] text-[#949ba4] -mt-2 leading-snug">
        Funcionam com o PulseCord minimizado ou dentro de um jogo. Use uma combinação com Ctrl, Alt ou Shift para não atrapalhar outros programas.
      </p>
      <div>
        {(Object.keys(SHORTCUT_LABELS) as Array<keyof DesktopPrefs['shortcuts']>).map((a) => (
          <ShortcutEditor key={a} action={a} value={prefs.shortcuts[a]} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => updateDesktopPrefs({ shortcuts: { ...DEFAULT_DESKTOP_PREFS.shortcuts } })}
        className="text-[13px] text-[#00a8fc] hover:underline cursor-pointer"
      >
        Restaurar atalhos padrão
      </button>

      <div className="h-px bg-[#3f4147]" />
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#b5bac1]">Overlay no jogo</div>
      <Row
        title="Mostrar quem está na chamada por cima dos jogos"
        desc="Uma lista pequena e transparente no canto da tela, com quem está falando. Os cliques passam direto para o jogo. Funciona em jogos em janela ou tela cheia sem borda; na tela cheia exclusiva o Windows não deixa nenhum programa aparecer por cima."
      >
        <Switch on={prefs.overlayEnabled} onChange={(v) => updateDesktopPrefs({ overlayEnabled: v })} />
      </Row>
      {prefs.overlayEnabled && (
        <div className="space-y-3 pl-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] text-[#dbdee1]">Posição</span>
            <select
              value={prefs.overlayCorner}
              onChange={(e) => updateDesktopPrefs({ overlayCorner: e.target.value as DesktopPrefs['overlayCorner'] })}
              className="h-8 rounded bg-[#1e1f22] border border-[#3f4147] px-2 text-[13px] text-white outline-none cursor-pointer"
            >
              <option value="top-left">Canto superior esquerdo</option>
              <option value="top-right">Canto superior direito</option>
              <option value="bottom-left">Canto inferior esquerdo</option>
              <option value="bottom-right">Canto inferior direito</option>
            </select>
          </div>
          <Row title="Só quem está falando">
            <Switch on={prefs.overlayOnlySpeaking} onChange={(v) => updateDesktopPrefs({ overlayOnlySpeaking: v })} />
          </Row>
          <Row title="Só quando um jogo for detectado" desc="Desligado, o overlay aparece sempre que você sai da janela do PulseCord durante uma chamada.">
            <Switch on={prefs.overlayOnlyInGames} onChange={(v) => updateDesktopPrefs({ overlayOnlyInGames: v })} />
          </Row>
        </div>
      )}

      <div className="h-px bg-[#3f4147]" />
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#b5bac1]">Clipes e gravação</div>
      <Row
        title="Clipes da chamada"
        desc={
          <>
            Enquanto você está numa chamada, o PulseCord guarda o último minuto (áudio de todos e, se você estiver transmitindo, a sua tela).
            Aperte <strong className="text-white">{prettyAccelerator(prefs.shortcuts.clip) || 'o atalho'}</strong> para salvar os últimos 30 a 60 segundos
            em Vídeos\PulseCord\Clipes. Os outros participantes veem o aviso "CLIPES" ao lado do seu nome. Usa um pouco mais de processador.
          </>
        }
      >
        <Switch on={prefs.clipsEnabled} onChange={(v) => updateDesktopPrefs({ clipsEnabled: v })} />
      </Row>
      <p className="text-[12px] text-[#949ba4]">
        Para gravar a chamada inteira, use o botão de gravar no painel da chamada. Todos veem o aviso "REC" enquanto grava; o arquivo vai para Vídeos\PulseCord\Gravações.
      </p>

      <div className="h-px bg-[#3f4147]" />
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#b5bac1]">Atividade</div>
      <Row
        title="Mostrar a música que estou ouvindo"
        desc="Lê o controle de mídia do Windows (Spotify, Deezer, YouTube no navegador...) e mostra a música e o artista no seu perfil. Jogos abertos têm prioridade."
      >
        <Switch on={prefs.mediaActivity} onChange={(v) => updateDesktopPrefs({ mediaActivity: v })} />
      </Row>

      <div className="h-px bg-[#3f4147]" />
      <div className="text-[12px] font-bold uppercase tracking-wide text-[#b5bac1]">Explorador de Arquivos</div>
      <Row
        title='"Compartilhar no PulseCord" no botão direito'
        desc={
          shareMenu && !shareMenu.supported
            ? 'Disponível só no app instalado ou portable (não no modo de desenvolvimento).'
            : 'Clique com o botão direito em qualquer arquivo e envie direto para um canal ou conversa. No Windows 11 a opção fica em "Mostrar mais opções".'
        }
      >
        <Switch
          on={Boolean(shareMenu?.enabled)}
          disabled={!shareMenu?.supported}
          onChange={async (v) => {
            setShareMsg('');
            const r = await api.setShareMenu?.(v).catch(() => null);
            if (r?.ok) setShareMenu((prev) => ({ supported: prev?.supported ?? true, enabled: Boolean(r.enabled) }));
            else setShareMsg(r?.error || 'Não foi possível alterar o menu.');
          }}
        />
      </Row>
      {shareMsg && <p className="text-[12px] text-[#f23f43]">{shareMsg}</p>}
    </div>
  );
};
