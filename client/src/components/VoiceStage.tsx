import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  Activity,
  Camera,
  Captions,
  Check,
  Gauge,
  CameraOff,
  Clapperboard,
  Crosshair,
  Eye,
  EyeOff,
  Gamepad2,
  HeadphoneOff,
  Headphones,
  KanbanSquare,
  Keyboard,
  Maximize2,
  MessageSquare,
  Minimize2,
  Mic,
  MicOff,
  MonitorCog,
  MonitorOff,
  MonitorPlay,
  Mouse,
  MousePointerClick,
  Music,
  Palette,
  Pause,
  PhoneOff,
  PictureInPicture2,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ShieldOff,
  SkipBack,
  SkipForward,
  UserPlus,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { ApiClient, resolveMediaUrl } from '../lib/api';
import {
  MusicState,
  RcPeerSession,
  RcPermissions,
  RemoteInputEvent,
  RemotePeerMedia,
  RolePermissions,
  SoundItem,
  SoundPlayedToast,
  StreamStats,
  User,
  VideoState,
  VoiceParticipant,
} from '../types';
import { isSpeaking, subscribeAnySpeaking, useIsSpeaking } from '../lib/speakingStore';
import { StageGrid } from './StageGrid';
import { PATH_LABEL } from '../lib/icePath';

const PATH_HINT: Record<'lan' | 'direct' | 'vpn' | 'relay', string> = {
  lan: 'Mesma rede: o caminho mais curto possível.',
  direct: 'Direto pela internet entre os dois PCs (sem passar por VPN nem servidor).',
  vpn: 'Passando pela VPN (Radmin/Hamachi). Se o ping estiver alto, a VPN está usando um servidor dela no meio: o Waver tenta o caminho direto sozinho, mas o roteador de um dos lados pode estar bloqueando (CGNAT).',
  relay: 'Passando por um servidor TURN (relé): mais lento que o direto.',
};
import { Avatar } from './Avatar';
import { MusicPlayerPanel } from './MusicPlayerPanel';
import { SoundboardPanel } from './SoundboardPanel';
import { VideoPlayerPanel } from './VideoPlayerPanel';
import { PanelResizer, usePersistentWidth } from './PanelResizer';
import { CaptionTrack, expectedVideoPosition, YouTubeSyncPlayer } from './YouTubeSyncPlayer';
import { LazyBoundary } from './LazyBoundary';

// o quadro (e o motor de desenho) só carrega quando alguém abre
const WhiteboardPanel = React.lazy(() => import('./WhiteboardPanel').then((m) => ({ default: m.WhiteboardPanel })));

const VideoView: React.FC<{
  stream: MediaStream;
  muted?: boolean;
  mirror?: boolean;
  className?: string;
  videoRefExternal?: React.RefObject<HTMLVideoElement | null>;
}> = ({ stream, muted = true, mirror = false, className = '', videoRefExternal }) => {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRefExternal || internalRef;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream, ref]);

  return (
    <video ref={ref} autoPlay playsInline muted={muted} className={`${mirror ? '-scale-x-100' : ''} ${className}`} />
  );
};

/** Computes exact normalized (0..1, 0..1) pointer coordinates inside an object-contain <video> element! */
function getNormalizedVideoCoords(video: HTMLVideoElement, clientX: number, clientY: number): { nx: number; ny: number } | null {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth || rect.width;
  const vh = video.videoHeight || rect.height;
  if (!vw || !vh || !rect.width || !rect.height) return null;

  const videoRatio = vw / vh;
  const elemRatio = rect.width / rect.height;

  let renderW = rect.width;
  let renderH = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (videoRatio > elemRatio) {
    renderH = rect.width / videoRatio;
    offsetY = (rect.height - renderH) / 2;
  } else {
    renderW = rect.height * videoRatio;
    offsetX = (rect.width - renderW) / 2;
  }

  const x = clientX - (rect.left + offsetX);
  const y = clientY - (rect.top + offsetY);
  if (x < 0 || y < 0 || x > renderW || y > renderH) return null;

  return {
    nx: Math.max(0, Math.min(1, x / renderW)),
    ny: Math.max(0, Math.min(1, y / renderH)),
  };
}

const StatsBadge: React.FC<{ stats: StreamStats | null; label?: string }> = ({ stats, label }) => {
  if (!stats) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 text-[11px] font-bold text-white border border-white/15">
        <span className="w-2 h-2 rounded-full bg-[#f23f42] animate-pulse" />
        AO VIVO {label ? `• ${label}` : ''}
      </span>
    );
  }
  const is1080Plus = stats.height >= 1080;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/75 text-[11px] font-mono font-bold text-white border border-white/15">
      <span className="w-2 h-2 rounded-full bg-[#f23f42] animate-pulse" />
      <span className={is1080Plus ? 'text-[#4ade80]' : 'text-[#f0b232]'}>
        {stats.width > 0 ? `${stats.width}×${stats.height}` : 'HD'}
      </span>
      {stats.fps > 0 && <span>• {stats.fps} FPS</span>}
      {stats.bitrateMbps > 0 && <span>• {stats.bitrateMbps} Mbps</span>}
      {stats.adaptiveTargetMbps && <span className="text-[#a5b4fc]">• AUTO</span>}
      {stats.codec && <span className="text-[#949ba4]">• {stats.codec}</span>}
      {stats.rttMs > 0 && <span className="text-[#949ba4]">• {stats.rttMs}ms</span>}
      {stats.path && (
        <span
          className={stats.path === 'vpn' || stats.path === 'relay' ? 'text-[#f0b232]' : 'text-[#4ade80]'}
          title={PATH_HINT[stats.path]}
        >
          • {PATH_LABEL[stats.path]}
        </span>
      )}
      {stats.limited === 'cpu' && (
        <span className="text-[#f0b232]" title="O PC está no limite para codificar a tela: o Waver baixou para 30 fps para não travar.">
          • CPU
        </span>
      )}
    </span>
  );
};


/** Contorno verde do tile enquanto a pessoa fala (lido do speakingStore, sem re-render do palco) */
const SpeakingOutline: React.FC<{ socketId: string }> = React.memo(({ socketId }) => {
  const speaking = useIsSpeaking(socketId);
  if (!speaking) return null;
  return <div className="pointer-events-none absolute inset-0 z-10 rounded-lg ring-2 ring-inset ring-[#23a55a]" />;
});

interface VoiceStageProps {
  /** a pessoa foi para o chat: a call continua montada (vídeo e som seguem tocando), só fora da tela */
  backgrounded?: boolean;
  api?: ApiClient | null;
  socket?: Socket | null;
  channelId?: string;
  serverUrl: string;
  user: User;
  members: User[];
  channelName: string;
  permissions?: RolePermissions;
  isPrivateCall?: boolean;
  onOpenTrello?: () => void;
  onInviteToGroupCall?: () => void;
  participants: VoiceParticipant[];
  selfSocketId: string;
  remotePeers: Record<string, RemotePeerMedia>;
  localCamStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localSpeaking: boolean;
  localScreenStats: StreamStats | null;
  localScreenLabel: string;
  muted: boolean;
  deafened: boolean;
  hasLocalMic: boolean;
  onReconnectAudio: () => void;
  peerVolumes: Record<string, number>;
  streamAudioVolume: number;
  onPeerVolumeChange: (socketId: string, volume: number) => void;
  onStreamAudioVolumeChange: (volume: number) => void;
  clockOffsetMs?: number;
  // Parsec / Remote Control (mouse, keyboard & Xbox gamepad permissions)
  rcControllingPeer: { socketId: string; name: string; permissions?: RcPermissions } | null;
  rcControlledByPeer: { socketId: string; name: string } | null;
  rcControlledPeers?: RcPeerSession[];
  /** Quem eu controlo está usando o próprio mouse/teclado (meus comandos ficam pausados). */
  rcRemoteHostBusy?: boolean;
  /** Eu (host) estou usando meu mouse/teclado: o controle remoto está pausado. */
  rcLocalHostBusy?: boolean;
  vigemStatus?: string;
  connectedGamepads?: Array<{ index: number; id: string }>;
  onUpdateRcPermissions?: (targetSocketId: string, perms: RcPermissions) => void;
  onRetryViGEm?: () => void;
  onInstallViGEmBus?: () => void;
  onInviteRemoteControl: (targetSocketId: string) => void;
  onRequestRemoteControl: (targetSocketId: string) => void;
  onRevokeRemoteControl: (targetSocketId?: string) => void;
  onSendRemoteInput: (targetSocketId: string, evt: RemoteInputEvent) => void;
  // Profile & Context Menu hooks
  onUserClick: (targetUser: User, e: React.MouseEvent) => void;
  onUserContextMenu: (
    targetUser: User,
    e: React.MouseEvent,
    meta?: { socketId?: string; isSharingScreen?: boolean }
  ) => void;
  // Soundboard, Music (Audio-Only + Playlists) & Watch-Party Videos
  sounds: SoundItem[];
  soundToasts: SoundPlayedToast[];
  soundboardActiveUserIds: Set<string>;
  soundboardVolume: number;
  musicState: MusicState | null;
  musicCurrentSec: number;
  musicDurationSec: number;
  musicVolume: number;
  videoState: VideoState | null;
  videoVolume: number;
  activeDrawer: 'none' | 'soundboard' | 'music' | 'video';
  onSetDrawer: (drawer: 'none' | 'soundboard' | 'music' | 'video') => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  onOpenScreenShare: () => void;
  onStopScreenShare: () => void;
  onLeaveVoice: () => void;
  onOpenChat: () => void;
  onPlaySound: (soundId: string) => void;
  onStopAllSounds: () => void;
  onSoundboardVolumeChange: (val: number) => void;
  onMusicVolumeChange: (val: number) => void;
  onMusicAddUrl: (url: string) => Promise<{ ok?: boolean; error?: string; count?: number }>;
  onMusicPlay: (index?: number) => void;
  onMusicPause: () => void;
  onMusicSeek: (sec: number) => void;
  onMusicNext: () => void;
  onMusicPrev: () => void;
  onMusicRemove: (index: number) => void;
  onMusicRemoveBlock: (playlistBlockId: string) => void;
  onMusicClear: () => void;
  onMusicLoop: (mode: 'none' | 'one' | 'all') => void;
  onVideoVolumeChange: (val: number) => void;
  onVideoAddUrl: (url: string) => Promise<{ ok?: boolean; error?: string }>;
  onVideoPlay: (index?: number) => void;
  onVideoPause: () => void;
  onVideoSeek: (sec: number) => void;
  onVideoRate?: (rate: number) => void;
  /** pedido externo para focar uma transmissão (ex.: clique na miniatura da barra lateral) */
  spotlightRequest?: { key: string; seq: number } | null;
  /** de quem eu saí da transmissão (não baixo nada da tela dessas pessoas) */
  notWatching?: string[];
  onSetWatching?: (socketId: string, watching: boolean) => void;
  onVideoNext: () => void;
  onVideoPrev: () => void;
  onVideoEnded: (queueId: string, durationSec?: number) => void;
  onVideoRemove: (index: number) => void;
  onVideoClear: () => void;
  /** faixa no topo (modo palco) e botões extras no painel (gravar, clipe) */
  topBanner?: React.ReactNode;
  extraControls?: React.ReactNode;
}

export const VoiceStage: React.FC<VoiceStageProps> = ({
  backgrounded = false,
  api,
  socket = null,
  channelId,
  serverUrl,
  user,
  members,
  channelName,
  permissions,
  isPrivateCall = false,
  onOpenTrello,
  onInviteToGroupCall,
  participants,
  selfSocketId,
  remotePeers,
  localCamStream,
  localScreenStream,
  localSpeaking,
  localScreenStats,
  localScreenLabel,
  muted,
  deafened,
  hasLocalMic,
  onReconnectAudio,
  peerVolumes,
  streamAudioVolume,
  onPeerVolumeChange,
  onStreamAudioVolumeChange,
  clockOffsetMs = 0,
  rcControllingPeer,
  rcControlledByPeer,
  rcControlledPeers = [],
  rcRemoteHostBusy = false,
  rcLocalHostBusy = false,
  vigemStatus = 'unknown',
  connectedGamepads = [],
  onUpdateRcPermissions,
  onRetryViGEm,
  onInstallViGEmBus,
  onInviteRemoteControl,
  onRequestRemoteControl,
  onRevokeRemoteControl,
  onSendRemoteInput,
  onUserClick,
  onUserContextMenu,
  sounds,
  soundToasts,
  soundboardActiveUserIds,
  soundboardVolume,
  musicState,
  musicCurrentSec,
  musicDurationSec,
  musicVolume,
  videoState,
  videoVolume,
  activeDrawer,
  onSetDrawer,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  onOpenScreenShare,
  onStopScreenShare,
  onLeaveVoice,
  onOpenChat,
  onPlaySound,
  onStopAllSounds,
  onSoundboardVolumeChange,
  onMusicVolumeChange,
  onMusicAddUrl,
  onMusicPlay,
  onMusicPause,
  onMusicSeek,
  onMusicNext,
  onMusicPrev,
  onMusicRemove,
  onMusicRemoveBlock,
  onMusicClear,
  onMusicLoop,
  onVideoVolumeChange,
  onVideoAddUrl,
  onVideoPlay,
  onVideoPause,
  onVideoSeek,
  onVideoRate,
  spotlightRequest,
  notWatching = [],
  onSetWatching,
  onVideoNext,
  onVideoPrev,
  onVideoEnded,
  onVideoRemove,
  onVideoClear,
  topBanner,
  extraControls,
}) => {
  // quadro em foco: 'watch-party' | 'screen:<sid>' | 'user:<sid>'; null = grade com todos do mesmo tamanho
  const [spotlightKey, setSpotlightKey] = useState<string | null>(null);
  // fixado: o foco não troca sozinho (quem fala, etc.)
  const [focusPinned, setFocusPinned] = useState(false);
  const [stageWeights, setStageWeights] = useState<Record<string, number>>({});
  // altura do palco escolhida arrastando a borda de baixo (null = automática); o resto da call ocupa o que sobra
  const [stageHeight, setStageHeight] = useState<number | null>(null);
  const stageScrollRef = useRef<HTMLDivElement>(null);
  const changeStageHeight = useCallback((px: number | null) => {
    if (px === null) return setStageHeight(null);
    const box = stageScrollRef.current?.clientHeight || 800;
    // sobra espaço para a faixa de participantes (e o palco nunca fica minúsculo)
    setStageHeight(Math.round(Math.max(200, Math.min(px, box - 32 - 130))));
  }, []);
  const [showWhiteboard, setShowWhiteboard] = useState(false);

  const canSpeak = isPrivateCall ? true : permissions?.speakVoice !== false;
  const canStream = isPrivateCall ? true : permissions?.streamVideo !== false;
  const canSoundboard = isPrivateCall ? true : permissions?.useSoundboard !== false;
  const canMediaQueue = isPrivateCall ? true : permissions?.useMediaQueue !== false;
  const canWhiteboard = isPrivateCall ? true : permissions?.useWhiteboard !== false;
  const canTrello = isPrivateCall ? true : permissions?.useTrello !== false;
  const [showStatsOverlay, setShowStatsOverlay] = useState(true);
  const [volumePopoverId, setVolumePopoverId] = useState<string | null>(null);
  const [showInviteRcMenu, setShowInviteRcMenu] = useState(false);
  const [watchCurSec, setWatchCurSec] = useState(0);
  const [watchDurSec, setWatchDurSec] = useState(0);
  const [ytFallbackIds, setYtFallbackIds] = useState<Set<string>>(() => new Set());
  const [ytEmbedBlocked, setYtEmbedBlocked] = useState<Set<string>>(() => new Set());
  // legenda é individual: fica só neste PC
  const [captionsOn, setCaptionsOn] = useState(() => {
    try {
      return localStorage.getItem('pc.videoCaptions') === '1';
    } catch {
      return false;
    }
  });
  const [captionsLang, setCaptionsLang] = useState(() => {
    try {
      return localStorage.getItem('pc.videoCaptionsLang') || '';
    } catch {
      return '';
    }
  });
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([]);
  const [videoMenu, setVideoMenu] = useState<null | 'speed' | 'captions'>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [drawerWidth, setDrawerWidth] = usePersistentWidth('pc.voiceDrawerWidth', 340, 280, 560);
  const heldKeysRef = useRef<Set<string>>(new Set());
  const heldButtonsRef = useRef<Set<number>>(new Set());

  const spotlightContainerRef = useRef<HTMLDivElement>(null);
  const spotlightVideoRef = useRef<HTMLVideoElement | null>(null);
  const watchVideoRef = useRef<HTMLVideoElement | null>(null);
  const watchAudioRef = useRef<HTMLAudioElement | null>(null);
  const prevHasWatchVideoRef = useRef(false);
  const lastMouseMoveSentRef = useRef<number>(0);
  const lastVideoSeqRef = useRef<number>(-1);

  const currentWatchVideo =
    videoState && videoState.currentIndex >= 0 ? videoState.queue[videoState.currentIndex] || null : null;
  const hasWatchVideo = Boolean(currentWatchVideo);
  const hasDirectStream = Boolean(currentWatchVideo?.streamPath);
  const useYouTubeWatchPlayer = Boolean(
    currentWatchVideo?.youtubeId && (!ytFallbackIds.has(currentWatchVideo.queueId) || !hasDirectStream)
  );
  const videoRate = videoState?.rate && videoState.rate > 0 ? videoState.rate : 1;

  useEffect(() => {
    try {
      localStorage.setItem('pc.videoCaptions', captionsOn ? '1' : '0');
      localStorage.setItem('pc.videoCaptionsLang', captionsLang);
    } catch {}
  }, [captionsOn, captionsLang]);
  useEffect(() => {
    setCaptionTracks([]);
    setVideoMenu(null);
  }, [currentWatchVideo?.queueId]);

  // Track Pointer-Lock changes for Parsec 3D game relative aiming
  useEffect(() => {
    const onPlChange = () => {
      setPointerLocked(Boolean(document.pointerLockElement));
    };
    document.addEventListener('pointerlockchange', onPlChange);
    return () => document.removeEventListener('pointerlockchange', onPlChange);
  }, []);

  // Modo foco: sai sozinho quando a tela cheia termina (Esc segurado, F11, etc.)
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setFocusMode(false);
        try {
          (navigator as any).keyboard?.unlock?.();
        } catch {}
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleWatchSeekOptimistic = (sec: number) => {
    const targetSec = Math.max(0, sec);
    setWatchCurSec(targetSec);
    const el = watchVideoRef.current;
    const aud = watchAudioRef.current;
    if (el && !useYouTubeWatchPlayer) {
      try {
        el.currentTime = targetSec;
      } catch {}
      if (aud && currentWatchVideo?.audioStreamPath) {
        try {
          aud.currentTime = targetSec;
        } catch {}
      }
    }
    onVideoSeek(targetSec);
  };

  // Volume individual do vídeo: separado da sincronização (mexer no volume não pode mexer na posição)
  useEffect(() => {
    if (useYouTubeWatchPlayer) return;
    const el = watchVideoRef.current;
    const aud = watchAudioRef.current;
    if (!el || !currentWatchVideo) return;
    const effectiveVol = deafened ? 0 : Math.max(0, Math.min(1, videoVolume));
    const hasSeparateAudio = Boolean(currentWatchVideo.audioStreamPath);
    el.muted = hasSeparateAudio;
    el.volume = hasSeparateAudio ? 0 : effectiveVol;
    if (aud && hasSeparateAudio) aud.volume = effectiveVol;
  }, [videoVolume, deafened, currentWatchVideo, useYouTubeWatchPlayer]);

  // Velocidade da sala
  useEffect(() => {
    if (useYouTubeWatchPlayer) return;
    const el = watchVideoRef.current;
    const aud = watchAudioRef.current;
    if (el) el.playbackRate = videoRate;
    if (aud) aud.playbackRate = videoRate;
  }, [videoRate, currentWatchVideo, useYouTubeWatchPlayer]);

  // Segundo plano: se a sala está tocando e o vídeo (ou o áudio separado) parou sozinho — janela minimizada,
  // escondida na bandeja, rede engasgou —, volta a tocar na posição da sala. Só local: ninguém mais é pausado.
  const watchLatestRef = useRef({ videoState, clockOffsetMs, currentWatchVideo, useYouTubeWatchPlayer });
  watchLatestRef.current = { videoState, clockOffsetMs, currentWatchVideo, useYouTubeWatchPlayer };
  useEffect(() => {
    const kick = (force: boolean) => {
      const L = watchLatestRef.current;
      if (L.useYouTubeWatchPlayer || !L.videoState?.isPlaying || !L.currentWatchVideo) return;
      if (L.videoState.queue[L.videoState.currentIndex]?.queueId !== L.currentWatchVideo.queueId) return;
      const el = watchVideoRef.current;
      if (!el || el.readyState < 1) return;
      const aud = L.currentWatchVideo.audioStreamPath ? watchAudioRef.current : null;
      const target = expectedVideoPosition(
        L.videoState.positionSec,
        L.videoState.serverNow,
        L.clockOffsetMs,
        true,
        L.videoState.rate || 1,
        L.videoState.receivedAt
      );
      const dur = el.duration || 0;
      if (dur > 0 && target >= dur - 0.5) return; // acabou de verdade
      const stopped = el.paused || el.ended || (aud ? aud.paused : false);
      if (!stopped && !force) return;
      if (Number.isFinite(target) && Math.abs((el.currentTime || 0) - target) > 1.5) {
        try {
          el.currentTime = target;
          if (aud) aud.currentTime = target;
        } catch {}
      }
      el.play().catch(() => {});
      aud?.play().catch(() => {});
    };
    const timer = window.setInterval(() => kick(false), 1500);
    const onBack = () => {
      if (document.visibilityState !== 'hidden') kick(true);
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, []);

  // Sync Watch-Party HTMLVideoElement (and companion DASH <audio>) state with server VideoState
  useEffect(() => {
    if (useYouTubeWatchPlayer) return;
    const el = watchVideoRef.current;
    const aud = watchAudioRef.current;
    if (!el || !currentWatchVideo || !videoState) return;
    const hasSeparateAudio = Boolean(currentWatchVideo.audioStreamPath);

    const incomingSeq = typeof videoState.seq === 'number' ? videoState.seq : -1;
    const isNewSeq = incomingSeq !== -1 && incomingSeq !== lastVideoSeqRef.current;
    if (incomingSeq !== -1) lastVideoSeqRef.current = incomingSeq;

    // Antes a latência tinha teto de 1,5 s: quando o efeito rodava de novo 30 s depois (sincronia do
    // relógio, volume), o alvo ficava 28 s atrás e o vídeo "voltava" sozinho em loop.
    const targetSec = expectedVideoPosition(
      videoState.positionSec,
      videoState.serverNow,
      clockOffsetMs,
      videoState.isPlaying,
      videoState.rate || 1,
      videoState.receivedAt
    );
    const driftThreshold = isNewSeq && (videoState.lastAction === 'seek' || videoState.lastAction === 'track') ? 0.18 : 0.75;

    if (Number.isFinite(targetSec) && Math.abs((el.currentTime || 0) - targetSec) > driftThreshold) {
      try {
        el.currentTime = targetSec;
      } catch {}
      if (aud && hasSeparateAudio) {
        try {
          aud.currentTime = targetSec;
        } catch {}
      }
    }
    if (videoState.isPlaying) {
      if (el.paused) el.play().catch(() => {});
      if (aud && hasSeparateAudio && aud.paused) aud.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (aud && hasSeparateAudio && !aud.paused) aud.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoState, currentWatchVideo, useYouTubeWatchPlayer]);

  const activeStreams = useMemo(() => {
    const list: Array<{
      key: string;
      socketId: string;
      ownerName: string;
      isSelf: boolean;
      label: string;
      stream: MediaStream;
      stats: StreamStats | null;
      hasAudio: boolean;
      /** false = saí desta transmissão: o quadro não aparece e nada da tela é baixado */
      watching: boolean;
    }> = [];

    if (localScreenStream) {
      list.push({
        key: `screen:${selfSocketId}`,
        socketId: selfSocketId,
        ownerName: `${user.displayName} (você)`,
        isSelf: true,
        label: localScreenLabel || 'Sua Tela',
        stream: localScreenStream,
        stats: localScreenStats,
        hasAudio: localScreenStream.getAudioTracks().length > 0,
        watching: true,
      });
    }

    for (const p of participants) {
      if (p.socketId === selfSocketId) continue;
      const media = remotePeers[p.socketId];
      if (media?.screenStream) {
        list.push({
          watching: !notWatching.includes(p.socketId),
          key: `screen:${p.socketId}`,
          socketId: p.socketId,
          ownerName: p.displayName,
          isSelf: false,
          label: p.screenLabel || 'Tela Compartilhada',
          stream: media.screenStream,
          stats: media.screenStats,
          hasAudio: Boolean(media.screenAudioStream),
        });
      }
    }
    return list;
  }, [localScreenStream, localScreenLabel, localScreenStats, participants, remotePeers, selfSocketId, user.displayName, notWatching]);

  const watchedStreams = useMemo(() => activeStreams.filter((s) => s.watching), [activeStreams]);
  // quadros do palco (vídeo sincronizado + telas que estou assistindo), na ordem da grade
  const stageKeys = useMemo(() => {
    const keys: string[] = [];
    if (hasWatchVideo) keys.push('watch-party');
    for (const s of watchedStreams) keys.push(s.key);
    return keys;
  }, [hasWatchVideo, watchedStreams]);
  const stageKeysSig = stageKeys.join('|');

  // foco que deixou de existir (a transmissão acabou, a pessoa saiu da call): volta para a grade
  useEffect(() => {
    if (!spotlightKey) return;
    const valid = spotlightKey.startsWith('user:')
      ? participants.some((p) => `user:${p.socketId}` === spotlightKey)
      : stageKeys.includes(spotlightKey);
    if (!valid) {
      setSpotlightKey(null);
      setFocusPinned(false);
    }
  }, [spotlightKey, stageKeysSig, participants]);
  useEffect(() => {
    prevHasWatchVideoRef.current = hasWatchVideo;
  }, [hasWatchVideo]);

  const focusTile = useCallback((key: string | null) => {
    setSpotlightKey(key);
    if (!key) setFocusPinned(false);
  }, []);
  // clicar no quadro em foco desfoca (volta à grade com os tamanhos que a pessoa tinha deixado)
  const toggleFocusTile = useCallback(
    (key: string) => {
      setSpotlightKey((cur) => {
        if (cur === key) {
          setFocusPinned(false);
          return null;
        }
        return key;
      });
    },
    []
  );

  // pedido de foco que chegou antes da tela (ex.: acabou de entrar na call) fica pendente até ela aparecer
  const pendingSpotlightRef = useRef<{ key: string; seq: number } | null>(null);
  useEffect(() => {
    if (spotlightRequest) pendingSpotlightRef.current = spotlightRequest;
  }, [spotlightRequest?.seq]);
  useEffect(() => {
    const req = pendingSpotlightRef.current;
    if (!req) return;
    if (watchedStreams.some((s) => s.key === req.key)) {
      setSpotlightKey(req.key);
      pendingSpotlightRef.current = null;
    }
  }, [watchedStreams, spotlightRequest?.seq]);

  // Controle remoto: os eventos do mouse/teclado vão no quadro da tela que eu controlo (em qualquer layout)
  const rcStream =
    (rcControllingPeer && watchedStreams.find((s) => !s.isSelf && s.socketId === rcControllingPeer.socketId)) || null;
  const isActivelyControllingFocused = Boolean(rcStream);
  // ao começar a controlar, a tela dessa pessoa vai para o foco e fica fixada
  const prevRcKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = rcStream?.key || null;
    if (key && key !== prevRcKeyRef.current) {
      setSpotlightKey(key);
      setFocusPinned(true);
    }
    prevRcKeyRef.current = key;
  }, [rcStream?.key]);

  const userFocusSid = spotlightKey?.startsWith('user:') ? spotlightKey.slice(5) : null;
  const userFocusParticipant = userFocusSid ? participants.find((p) => p.socketId === userFocusSid) || null : null;
  const stageFocusKey = spotlightKey && stageKeys.includes(spotlightKey) ? spotlightKey : null;
  /** tem algo no palco (telas, vídeo ou uma pessoa em foco): as pessoas da call vão para a faixa de baixo */
  const hasAnySpotlight = stageKeys.length > 0 || Boolean(userFocusParticipant);
  const anyFocus = Boolean(stageFocusKey || userFocusParticipant);

  // Foco numa pessoa, sem telas nem vídeo: o foco acompanha quem está falando. Se alguém está com a câmera
  // ligada, alterna só entre essas pessoas. Fixar (pin) desliga.
  const followRef = useRef({ participants, selfSocketId, remotePeers, localCamStream });
  followRef.current = { participants, selfSocketId, remotePeers, localCamStream };
  const followActive = Boolean(userFocusParticipant) && stageKeys.length === 0 && !focusPinned;
  useEffect(() => {
    if (!followActive) return;
    let candidate: string | null = null;
    let candidateTimer: number | null = null;
    let lastSwitch = performance.now();
    const pick = () => {
      const { participants: ps, selfSocketId: me, remotePeers: rp } = followRef.current;
      const others = ps.filter((p) => p.socketId !== me);
      const withCam = others.filter((p) => p.cameraOn || rp[p.socketId]?.camStream);
      const pool = withCam.length > 0 ? withCam : others;
      return pool.find((p) => isSpeaking(p.socketId))?.socketId || null;
    };
    const check = () => {
      const sid = pick();
      if (!sid) return;
      if (`user:${sid}` === spotlightKeyRef.current) {
        candidate = null;
        return;
      }
      if (candidate === sid) return;
      candidate = sid;
      if (candidateTimer) window.clearTimeout(candidateTimer);
      // só troca depois de ~0,7 s falando, e o quadro atual fica pelo menos 2 s (sem piscar a cada respiro)
      const wait = Math.max(700, 2000 - (performance.now() - lastSwitch));
      candidateTimer = window.setTimeout(() => {
        candidateTimer = null;
        if (candidate && isSpeaking(candidate)) {
          lastSwitch = performance.now();
          setSpotlightKey(`user:${candidate}`);
        }
        candidate = null;
      }, wait);
    };
    const unsub = subscribeAnySpeaking(check);
    check();
    return () => {
      unsub();
      if (candidateTimer) window.clearTimeout(candidateTimer);
    };
  }, [followActive]);
  const spotlightKeyRef = useRef(spotlightKey);
  spotlightKeyRef.current = spotlightKey;

  const otherParticipants = participants.filter((p) => p.socketId !== selfSocketId);

  // Parsec Remote Control Mouse & Keyboard Handlers on the Spotlight Video!
  const canSendMouse = rcControllingPeer?.permissions ? rcControllingPeer.permissions.mouse : true;
  const canSendKey = rcControllingPeer?.permissions ? rcControllingPeer.permissions.keyboard : true;

  // Solta tudo que ficou pressionado no PC remoto (evita tecla/botão "preso" ao perder o foco)
  const releaseHeldRemoteInput = useCallback(() => {
    const target = rcControllingPeer?.socketId;
    if (!target) {
      heldKeysRef.current.clear();
      heldButtonsRef.current.clear();
      return;
    }
    heldKeysRef.current.forEach((code) => onSendRemoteInput(target, { type: 'keyup', code }));
    heldButtonsRef.current.forEach((button) => onSendRemoteInput(target, { type: 'mouseup', button }));
    heldKeysRef.current.clear();
    heldButtonsRef.current.clear();
  }, [rcControllingPeer?.socketId, onSendRemoteInput]);

  useEffect(() => {
    const onBlur = () => releaseHeldRemoteInput();
    const onVis = () => {
      if (document.hidden) releaseHeldRemoteInput();
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [releaseHeldRemoteInput]);

  const exitFocusMode = useCallback(() => {
    try {
      (navigator as any).keyboard?.unlock?.();
    } catch {}
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setFocusMode(false);
  }, []);

  useEffect(() => {
    if (!isActivelyControllingFocused) {
      releaseHeldRemoteInput();
      // perdeu o controle (host tirou / saiu): não deixa a pessoa presa em tela cheia com teclado travado
      if (focusMode) exitFocusMode();
    }
  }, [isActivelyControllingFocused, releaseHeldRemoteInput, focusMode, exitFocusMode]);

  // Segurar Esc por 1s sai do modo foco (o Electron não mostra a dica de saída do Chrome).
  // Esc rápido continua indo para o jogo no PC remoto.
  useEffect(() => {
    if (!focusMode) return;
    let timer: number | null = null;
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || e.repeat || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        exitFocusMode();
      }, 1000);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [focusMode, exitFocusMode]);

  /**
   * Modo foco (jogos): tela cheia + Keyboard Lock (captura Alt+Tab, Win, Alt+F4, Esc curto)
   * + trava do mouse. Segure Esc para sair, como no Chrome/Parsec.
   */
  const toggleFocusMode = async () => {
    const el = spotlightContainerRef.current;
    if (!el) return;
    if (focusMode || document.fullscreenElement) {
      exitFocusMode();
      return;
    }
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      return;
    }
    try {
      await (navigator as any).keyboard?.lock?.();
    } catch {}
    setFocusMode(true);
    el.focus();
    if (canSendMouse) {
      try {
        await (el.requestPointerLock as any)?.call(el, { unadjustedMovement: true });
      } catch {
        try {
          el.requestPointerLock?.();
        } catch {}
      }
    }
  };

  const handleRemoteMouseMove = (e: React.MouseEvent) => {
    if (!isActivelyControllingFocused || !rcControllingPeer || !canSendMouse || !spotlightVideoRef.current) return;
    if (document.pointerLockElement === spotlightContainerRef.current) {
      if (e.movementX !== 0 || e.movementY !== 0) {
        onSendRemoteInput(rcControllingPeer.socketId, {
          type: 'mouserel',
          dx: e.movementX,
          dy: e.movementY,
        });
      }
      return;
    }
    const now = performance.now();
    if (now - lastMouseMoveSentRef.current < 8) return; // ~125Hz Parsec-speed LAN mouse
    lastMouseMoveSentRef.current = now;
    const coords = getNormalizedVideoCoords(spotlightVideoRef.current, e.clientX, e.clientY);
    if (!coords) return;
    onSendRemoteInput(rcControllingPeer.socketId, { type: 'mousemove', nx: coords.nx, ny: coords.ny });
  };

  const handleRemoteMouseDown = (e: React.MouseEvent) => {
    if (!isActivelyControllingFocused || !rcControllingPeer || !canSendMouse || !spotlightVideoRef.current) return;
    e.preventDefault();
    spotlightContainerRef.current?.focus();
    heldButtonsRef.current.add(e.button);
    if (document.pointerLockElement === spotlightContainerRef.current) {
      onSendRemoteInput(rcControllingPeer.socketId, { type: 'mousedown', button: e.button });
      return;
    }
    const coords = getNormalizedVideoCoords(spotlightVideoRef.current, e.clientX, e.clientY);
    if (!coords) return;
    onSendRemoteInput(rcControllingPeer.socketId, {
      type: 'mousedown',
      nx: coords.nx,
      ny: coords.ny,
      button: e.button,
    });
  };

  const handleRemoteMouseUp = (e: React.MouseEvent) => {
    if (!isActivelyControllingFocused || !rcControllingPeer || !canSendMouse || !spotlightVideoRef.current) return;
    e.preventDefault();
    heldButtonsRef.current.delete(e.button);
    if (document.pointerLockElement === spotlightContainerRef.current) {
      onSendRemoteInput(rcControllingPeer.socketId, { type: 'mouseup', button: e.button });
      return;
    }
    const coords = getNormalizedVideoCoords(spotlightVideoRef.current, e.clientX, e.clientY);
    if (!coords) return;
    onSendRemoteInput(rcControllingPeer.socketId, {
      type: 'mouseup',
      nx: coords.nx,
      ny: coords.ny,
      button: e.button,
    });
  };

  const handleRemoteWheel = (e: React.WheelEvent) => {
    if (!isActivelyControllingFocused || !rcControllingPeer || !canSendMouse) return;
    e.preventDefault();
    onSendRemoteInput(rcControllingPeer.socketId, { type: 'wheel', deltaY: e.deltaY });
  };

  const handleRemoteKeyDown = (e: React.KeyboardEvent) => {
    if (!isActivelyControllingFocused || !rcControllingPeer || !canSendKey) return;
    e.preventDefault();
    e.stopPropagation();
    // repetições (segurar Backspace/setas) também são enviadas: tecla injetada não repete sozinha no host
    heldKeysRef.current.add(e.code);
    onSendRemoteInput(rcControllingPeer.socketId, { type: 'keydown', code: e.code });
  };

  const handleRemoteKeyUp = (e: React.KeyboardEvent) => {
    if (!isActivelyControllingFocused || !rcControllingPeer || !canSendKey) return;
    e.preventDefault();
    e.stopPropagation();
    heldKeysRef.current.delete(e.code);
    onSendRemoteInput(rcControllingPeer.socketId, { type: 'keyup', code: e.code });
  };

  // cada quadro do palco tem seus botões: a tela cheia / PiP vale para o quadro onde o botão foi clicado
  const tileOf = (e?: React.SyntheticEvent) =>
    ((e?.currentTarget as HTMLElement | undefined)?.closest('[data-stage-tile]') as HTMLElement | null) || null;

  const handleFullscreen = (e?: React.SyntheticEvent) => {
    const el = tileOf(e) || spotlightContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  };

  const handlePip = async (e?: React.SyntheticEvent) => {
    const vid = (tileOf(e)?.querySelector('video') as HTMLVideoElement | null) || spotlightVideoRef.current;
    if (!vid) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await vid.requestPictureInPicture();
    } catch {}
  };

  const focusedKeyAll = stageFocusKey || (userFocusParticipant ? `user:${userFocusParticipant.socketId}` : null);

  /** botões do canto superior direito de cada quadro: fixar (pin) e focar / voltar para a grade */
  const renderTileCorner = (key: string) => {
    const focused = focusedKeyAll === key;
    const canFocus = stageKeys.length > 1 || key.startsWith('user:') || focused;
    if (!canFocus) return null;
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    return (
      <div
        onClick={stop}
        onMouseDown={stop}
        onMouseUp={stop}
        className={`absolute top-3 right-3 z-20 flex items-center gap-1.5 transition ${
          focused && focusPinned ? 'opacity-100' : 'opacity-95 sm:opacity-0 sm:group-hover:opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            if (focused) setFocusPinned((v) => !v);
            else {
              setSpotlightKey(key);
              setFocusPinned(true);
            }
          }}
          className={`p-1.5 rounded-lg cursor-pointer shadow ${
            focused && focusPinned ? 'bg-[#5865f2] text-white' : 'bg-black/70 text-[#dbdee1] hover:bg-black'
          }`}
          title={focused && focusPinned ? 'Soltar (o foco volta a trocar sozinho)' : 'Fixar em tela cheia (o foco não troca sozinho)'}
        >
          {focused && focusPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => toggleFocusTile(key)}
          className="p-1.5 rounded-lg bg-black/70 text-[#dbdee1] hover:bg-black cursor-pointer shadow"
          title={focused ? 'Voltar para a grade' : 'Focar'}
        >
          {focused ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    );
  };

  /** quadros do palco escondidos pelo foco: atalhos na faixa de baixo para trocar o foco */
  const renderHiddenStageChips = () =>
    stageKeys
      .filter((k) => k !== focusedKeyAll)
      .map((k) => {
        const st = k === 'watch-party' ? null : watchedStreams.find((s) => s.key === k);
        return (
          <button
            key={`chip:${k}`}
            type="button"
            onClick={() => focusTile(k)}
            className="w-44 shrink-0 h-full rounded-lg bg-[#111214] border-2 border-[#2b2d31] hover:border-[#5865f2] flex flex-col items-center justify-center gap-1.5 text-xs font-semibold text-white cursor-pointer px-2"
            title="Focar este quadro"
          >
            {k === 'watch-party' ? (
              <>
                <Clapperboard className="w-6 h-6 text-[#ff4d6d]" />
                <span className="truncate max-w-full">{currentWatchVideo?.title || 'Vídeo sincronizado'}</span>
              </>
            ) : (
              <>
                <MonitorPlay className="w-6 h-6 text-[#f23f42]" />
                <span className="truncate max-w-full">Tela: {st?.ownerName}</span>
              </>
            )}
          </button>
        );
      });

  const renderScreenTile = (st: (typeof activeStreams)[number]) => {
    const controlling = rcStream?.key === st.key;
    const focused = stageFocusKey === st.key;
    const viewers = participants.filter((p) => p.socketId !== st.socketId && !(p.notWatching || []).includes(st.socketId));
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    return (
      <div
        ref={controlling ? spotlightContainerRef : undefined}
        tabIndex={controlling ? 0 : -1}
        onMouseMove={controlling ? handleRemoteMouseMove : undefined}
        onMouseDown={controlling ? handleRemoteMouseDown : undefined}
        onMouseUp={controlling ? handleRemoteMouseUp : undefined}
        onWheel={controlling ? handleRemoteWheel : undefined}
        onKeyDown={controlling ? handleRemoteKeyDown : undefined}
        onKeyUp={controlling ? handleRemoteKeyUp : undefined}
        // clicar na tela foca; clicar de novo desfoca (no controle remoto o clique vai para o PC da pessoa)
        onClick={controlling ? undefined : () => toggleFocusTile(st.key)}
        onContextMenu={(e) => {
          if (controlling) e.preventDefault();
        }}
        className={`relative w-full h-full bg-black rounded-lg overflow-hidden border-2 shadow-2xl group flex items-center justify-center outline-none ${
          controlling
            ? 'border-[#23a55a] cursor-crosshair ring-2 ring-[#23a55a]/40'
            : focused
            ? 'border-[#5865f2]/60 cursor-pointer'
            : 'border-[#2b2d31] hover:border-[#5865f2]/60 cursor-pointer'
        }`}
      >
        <VideoView
          stream={st.stream}
          muted={true}
          videoRefExternal={controlling ? spotlightVideoRef : undefined}
          className="w-full h-full object-contain pointer-events-none"
        />

        {controlling && rcRemoteHostBusy && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none px-3 py-1.5 rounded-md bg-[#111214]/90 text-xs text-[#dbdee1] shadow-lg">
            <strong className="text-[#f0b232]">{rcControllingPeer?.name}</strong> está mexendo no PC agora. Você volta a controlar quando ele parar.
          </div>
        )}
        {controlling && focusMode && (
          <div className="pc-focus-hint absolute top-14 right-3 z-10 pointer-events-none px-2.5 py-1 rounded bg-black/70 text-[11px] text-[#b5bac1]">
            Modo foco: segure <kbd className="px-1 rounded bg-[#2b2d31] text-white">Esc</kbd> para sair
          </div>
        )}

        {/* Top-left Stats & Owner Badge */}
        <div className="absolute top-3 left-3 right-24 flex flex-wrap items-center gap-2 pointer-events-none min-w-0">
          {showStatsOverlay && <StatsBadge stats={st.stats} label={st.label} />}
          <span className="px-2.5 py-1 rounded-full bg-black/65 text-xs font-semibold text-white truncate max-w-full">
            {st.ownerName}
          </span>
        </div>

        {renderTileCorner(st.key)}

        {/* quem está assistindo esta transmissão */}
        <div
          onClick={stop}
          className="absolute bottom-3 left-3 z-10 group/viewers"
        >
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/70 text-[11px] font-semibold text-white">
            <Eye className="w-3.5 h-3.5" />
            {viewers.length}
          </span>
          {viewers.length > 0 && (
            <div className="hidden group-hover/viewers:block absolute bottom-8 left-0 w-48 max-h-48 overflow-y-auto bg-[#111214] border border-[#2b2d31] rounded-lg shadow-2xl p-1.5">
              <div className="px-1.5 py-1 text-[10px] font-bold uppercase text-[#949ba4]">Assistindo</div>
              {viewers.map((v) => (
                <div key={v.socketId} className="px-1.5 py-1 text-xs text-white truncate">
                  {v.displayName}
                  {v.socketId === selfSocketId ? ' (você)' : ''}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stream Controls Overlay */}
        <div
          onMouseDown={stop}
          onMouseUp={stop}
          onClick={stop}
          className="absolute bottom-3 right-3 flex items-center gap-2 bg-black/80 px-3 py-2 rounded-lg border border-white/10 opacity-95 sm:opacity-0 sm:group-hover:opacity-100 transition max-w-[calc(100%-5rem)] flex-wrap justify-end"
        >
          {st.isSelf ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowInviteRcMenu((v) => !v)}
                disabled={otherParticipants.length === 0}
                className="px-2.5 py-1.5 rounded-lg bg-[#23a55a] hover:bg-[#1e8e4c] disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                title="Convidar alguém da call para controlar sua tela (AnyDesk)"
              >
                <MonitorCog className="w-4 h-4" />
                Controle Remoto
              </button>
              {showInviteRcMenu && otherParticipants.length > 0 && (
                <div className="absolute bottom-11 right-0 w-52 bg-[#111214] border border-[#2b2d31] rounded-lg shadow-2xl p-1.5 space-y-1 z-30">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase text-[#949ba4]">Convidar para mexer na tela:</div>
                  {otherParticipants.map((p) => (
                    <button
                      key={p.socketId}
                      type="button"
                      onClick={() => {
                        onInviteRemoteControl(p.socketId);
                        setShowInviteRcMenu(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[#5865f2] text-xs font-semibold text-white cursor-pointer truncate"
                    >
                      🖱️ {p.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => (controlling ? onRevokeRemoteControl() : onRequestRemoteControl(st.socketId))}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                  controlling ? 'bg-[#da373c] hover:bg-[#b92d31] text-white' : 'bg-[#5865f2] hover:bg-[#4752c4] text-white'
                }`}
                title="Pedir permissão para controlar mouse e teclado (AnyDesk)"
              >
                <MonitorCog className="w-4 h-4" />
                {controlling ? 'Parar Controle' : 'Pedir Controle'}
              </button>
              {!controlling && onSetWatching && (
                <button
                  type="button"
                  onClick={() => onSetWatching(st.socketId, false)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer bg-[#4e5058] hover:bg-[#6d6f78] text-white"
                  title="Sair da transmissão: você continua só no áudio da call e não baixa nada desta tela"
                >
                  <EyeOff className="w-4 h-4" />
                  Parar de assistir
                </button>
              )}
            </>
          )}

          {!st.isSelf && st.hasAudio && (
            <div className="flex items-center gap-2 px-2 border-l border-r border-white/15">
              <Volume2 className="w-4 h-4 text-[#23a55a]" />
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={streamAudioVolume}
                onChange={(e) => onStreamAudioVolumeChange(Number(e.target.value))}
                className="w-20 accent-[#23a55a] cursor-pointer"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowStatsOverlay((v) => !v)}
            className={`p-1.5 rounded-lg cursor-pointer ${showStatsOverlay ? 'bg-[#5865f2] text-white' : 'text-[#dbdee1] hover:bg-white/10'}`}
            title="Estatísticas da transmissão"
          >
            <Activity className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handlePip}
            className="p-1.5 rounded-lg text-[#dbdee1] hover:bg-white/10 cursor-pointer"
            title="Picture-in-Picture"
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleFullscreen}
            className="p-1.5 rounded-lg text-[#dbdee1] hover:bg-white/10 cursor-pointer"
            title="Tela cheia"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  /** card de uma pessoa da call: na grade, na faixa de baixo ou em foco (grande, no palco) */
  const renderParticipantCard = (p: VoiceParticipant, variant: 'grid' | 'strip' | 'focus') => {
    const isSelf = p.socketId === selfSocketId;
    const remote = remotePeers[p.socketId];
    const camStream = isSelf ? localCamStream : remote?.camStream || null;
    const isSoundboardActive = soundboardActiveUserIds.has(p.userId);
    const vol = peerVolumes[p.socketId] ?? peerVolumes[p.userId] ?? 1;
    const memberObj = members.find((m) => m.id === p.userId);
    const focusKeyOfCard = `user:${p.socketId}`;
    const isFocusedCard = focusedKeyAll === focusKeyOfCard;
    const unwatchedLive = !isSelf && p.screenSharing && notWatching.includes(p.socketId);
    const watchedLive = !isSelf && p.screenSharing && !unwatchedLive && stageKeys.includes(`screen:${p.socketId}`);
    const big = variant !== 'strip';

    return (
      <div
        key={variant === 'focus' ? `focus:${p.socketId}` : p.socketId}
        // clicar foca o card (clicar de novo desfoca); o perfil abre clicando no nome ou com o botão direito
        onClick={() => toggleFocusTile(focusKeyOfCard)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (memberObj) {
            onUserContextMenu(memberObj, e, {
              socketId: p.socketId,
              isSharingScreen: p.screenSharing,
            });
          }
        }}
        className={`relative rounded-lg bg-[#2b2d31] border-2 overflow-hidden flex flex-col items-center justify-center transition select-none cursor-pointer group ${
          variant === 'strip'
            ? stageHeight
              ? 'shrink-0 h-full aspect-video min-w-[13rem]'
              : 'w-52 shrink-0 h-full'
            : variant === 'focus'
            ? 'w-full h-full'
            : 'min-h-[200px] aspect-video max-h-[60vh]'
        } ${
          isSoundboardActive
            ? 'border-[#f0b232]'
            : isFocusedCard && variant === 'strip'
            ? 'border-[#5865f2]'
            : 'border-transparent hover:border-white/10'
        }`}
      >
        <SpeakingOutline socketId={p.socketId} />
        {camStream ? (
          <VideoView
            stream={camStream}
            muted={true}
            mirror={isSelf}
            className={`w-full h-full ${variant === 'focus' ? 'object-contain bg-black' : 'object-cover'}`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-4">
            <Avatar
              name={p.displayName}
              avatarUrl={p.avatarUrl}
              color={p.avatarColor}
              decoration={p.avatarDecoration}
              serverUrl={serverUrl}
              size={big ? 'xl' : 'md'}
              speakingId={p.socketId}
              soundboardActive={isSoundboardActive}
            />
          </div>
        )}

        {isSoundboardActive && (
          <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#22c55e] text-[#051109] shadow animate-pulse flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Soundboard
          </span>
        )}

        {/* saiu da transmissão desta pessoa: volta a assistir com um clique */}
        {unwatchedLive && onSetWatching && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetWatching(p.socketId, true);
              pendingSpotlightRef.current = { key: `screen:${p.socketId}`, seq: Date.now() };
            }}
            className={`absolute left-1/2 -translate-x-1/2 z-20 px-2.5 py-1 rounded-lg bg-[#f23f42] hover:bg-[#d83c3e] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow ${
              big ? 'top-1/2 translate-y-8' : 'top-2'
            }`}
            title="Voltar a assistir a transmissão"
          >
            <Eye className="w-3.5 h-3.5" />
            Assistir
          </button>
        )}

        {variant === 'focus' && renderTileCorner(focusKeyOfCard)}

        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 bg-black/65 px-2 py-1 rounded-lg max-w-[75%]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (memberObj) onUserClick(memberObj, e);
              }}
              className="text-xs font-semibold text-white truncate hover:underline cursor-pointer"
              title="Ver perfil"
            >
              {p.displayName}
              {isSelf ? ' (você)' : ''}
            </button>
            {p.screenSharing && (
              <span
                onClick={(e) => {
                  if (!watchedLive) return;
                  e.stopPropagation();
                  focusTile(`screen:${p.socketId}`);
                }}
                className={`text-[9px] font-bold bg-[#f23f42] text-white px-1.5 py-0.5 rounded ${watchedLive ? 'cursor-pointer' : ''}`}
                title={watchedLive ? 'Focar a transmissão' : undefined}
              >
                AO VIVO
              </span>
            )}
            {p.recording && (
              <span
                className="text-[9px] font-bold bg-black/80 text-[#f23f42] px-1.5 py-0.5 rounded flex items-center gap-1"
                title={p.recording === 'record' ? 'Gravando a chamada' : 'Guardando clipes da chamada'}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#f23f42] animate-pulse" />
                {p.recording === 'record' ? 'REC' : 'CLIPES'}
              </span>
            )}
            {p.handRaised && <span title="Levantou a mão">✋</span>}
            {p.stageRole === 'audience' && (
              <span className="text-[9px] font-bold bg-[#4e5058] text-white px-1.5 py-0.5 rounded">PLATEIA</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {p.deafened || p.serverDeafened ? (
              <span className="p-1 rounded-md bg-[#f23f42]/85 text-white">
                <HeadphoneOff className="w-3 h-3" />
              </span>
            ) : p.muted || p.serverMuted ? (
              <span className="p-1 rounded-md bg-[#f23f42]/85 text-white">
                <MicOff className="w-3 h-3" />
              </span>
            ) : null}

            {!isSelf && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setVolumePopoverId((cur) => (cur === p.socketId ? null : p.socketId));
                }}
                className="p-1 rounded-md bg-black/65 hover:bg-black/90 text-[#dbdee1] cursor-pointer"
                title="Volume deste amigo"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {!isSelf && volumePopoverId === p.socketId && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-2 top-2 z-20 bg-[#2b2d31]/95 border border-[#4e5058] rounded-lg p-2.5 shadow-xl space-y-1.5"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-white truncate">Volume: {p.displayName}</span>
              <span className="font-mono text-[#4ade80]">{Math.round(vol * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={vol}
              onChange={(e) => onPeerVolumeChange(p.socketId, Number(e.target.value))}
              className="w-full accent-[#23a55a] cursor-pointer"
            />
          </div>
        )}

        {!isSelf && remote && remote.connectionState !== 'connected' && (
          <span
            className={`absolute right-2 text-[10px] px-2 py-0.5 rounded-full bg-black/70 text-[#f0b232] ${
              variant === 'focus' ? 'top-14' : 'top-2'
            }`}
          >
            {remote.connectionState === 'connecting'
              ? remote.viaSfu
                ? 'Conectando ao servidor...'
                : 'Conectando P2P...'
              : remote.connectionState}
          </span>
        )}
      </div>
    );
  };

  const currentMusic = musicState && musicState.currentIndex >= 0 ? musicState.queue[musicState.currentIndex] : null;

  return (
    <div
      className="flex-1 flex h-full min-w-0 bg-[#313338] pc-voice-stage relative overflow-hidden"
      // Fora da tela (e não display:none): o player do "assistir junto" e o áudio continuam tocando enquanto
      // a pessoa lê o chat; inert impede foco/clique/teclado em qualquer coisa aqui dentro.
      style={
        backgrounded
          ? { position: 'fixed', left: -20000, top: 0, width: 960, height: 540, pointerEvents: 'none', flex: 'none' }
          : undefined
      }
      aria-hidden={backgrounded || undefined}
      inert={backgrounded || undefined}
    >
      <div className="flex-1 flex flex-col min-w-0 h-full relative bg-[#1e1f22]">
        {/* Top Bar (48px authentic Discord bar) */}
        <header className="@container h-12 shrink-0 px-4 bg-[#2b2d31]/95 border-b border-white/10 flex items-center justify-between gap-3 z-10">
          <div className="flex flex-1 items-center gap-2.5 min-w-0 overflow-hidden">
            <Volume2 className="w-5 h-5 text-[#23a55a] shrink-0" />
            <h2 className="font-bold text-white text-sm sm:text-base truncate">{channelName}</h2>
            <span className="hidden @lg:inline text-xs px-2 py-0.5 rounded-full bg-[#2b2d31] text-[#b5bac1] shrink-0 whitespace-nowrap">
              {participants.length} na call
            </span>

            {!hasLocalMic && (
              <button
                type="button"
                onClick={onReconnectAudio}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f0b232]/20 border border-[#f0b232]/50 text-[11px] font-bold text-[#f0b232] cursor-pointer shrink-0"
              >
                <MicOff className="w-3 h-3" />
                Sem microfone
              </button>
            )}

            {Object.values(remotePeers).length > 0 && (
              <button
                type="button"
                onClick={onReconnectAudio}
                className={`hidden @2xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer shrink-0 whitespace-nowrap ${
                  Object.values(remotePeers).every((p) => p.connectionState === 'connected')
                    ? 'border-transparent text-[#23a55a] hover:bg-[#35373c]'
                    : 'border-transparent text-[#f0b232] hover:bg-[#35373c]'
                }`}
                title={
                  Object.values(remotePeers).some((p) => p.viaSfu)
                    ? 'Mídia pelo servidor (SFU) — clique para reconectar'
                    : 'Status P2P — clique para reconectar'
                }
              >
                <RefreshCw className="w-3 h-3" />
                {Object.values(remotePeers).every((p) => p.connectionState === 'connected')
                  ? Object.values(remotePeers).some((p) => p.viaSfu)
                    ? 'Voz conectada (SFU)'
                    : 'Voz conectada'
                  : 'Conectando…'}
              </button>
            )}

            {currentMusic && musicState?.isPlaying && (
              <button
                type="button"
                onClick={() => onSetDrawer(activeDrawer === 'music' ? 'none' : 'music')}
                className="hidden @5xl:inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1] cursor-pointer truncate max-w-[220px]"
              >
                <Music className="w-3.5 h-3.5 text-[#b5bac1] shrink-0" />
                <span className="truncate">{currentMusic.title}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isPrivateCall && onInviteToGroupCall && (
              <button
                type="button"
                onClick={onInviteToGroupCall}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1] flex items-center gap-1.5 cursor-pointer"
                title="Adicionar amigo ou criar chamada em grupo"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span className="hidden @4xl:inline">+ Grupo</span>
              </button>
            )}
            {onOpenTrello && canTrello && (
              <button
                type="button"
                onClick={onOpenTrello}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1] flex items-center gap-1.5 cursor-pointer"
                title="Abrir quadro Trello / Projetos"
              >
                <KanbanSquare className="w-3.5 h-3.5" />
                <span className="hidden @4xl:inline">Trello</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowWhiteboard((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                showWhiteboard
                  ? 'bg-[#404249] text-white'
                  : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1]'
              }`}
              title="Whiteboard"
            >
              <Palette className="w-3.5 h-3.5" />
              <span className="hidden @4xl:inline">Whiteboard</span>
            </button>
            <button
              type="button"
              onClick={onOpenChat}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1] flex items-center gap-1.5 cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="hidden @4xl:inline">Chat</span>
            </button>
            <button
              type="button"
              onClick={() => onSetDrawer(activeDrawer === 'video' ? 'none' : 'video')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                activeDrawer === 'video'
                  ? 'bg-[#404249] text-white'
                  : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1]'
              }`}
              title="Vídeos (YouTube, X, Instagram, TikTok)"
            >
              <Clapperboard className="w-3.5 h-3.5" />
              <span className="hidden @4xl:inline">Vídeos</span>
            </button>
            <button
              type="button"
              onClick={() => onSetDrawer(activeDrawer === 'soundboard' ? 'none' : 'soundboard')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                activeDrawer === 'soundboard'
                  ? 'bg-[#404249] text-white'
                  : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1]'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span className="hidden @4xl:inline">Soundboard</span>
            </button>
            <button
              type="button"
              onClick={() => onSetDrawer(activeDrawer === 'music' ? 'none' : 'music')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                activeDrawer === 'music'
                  ? 'bg-[#404249] text-white'
                  : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1]'
              }`}
            >
              <Music className="w-3.5 h-3.5" />
              <span className="hidden @4xl:inline">Músicas</span>
            </button>
          </div>
        </header>

        {/* ACTIVE PARSEC / REMOTE CONTROL HOST PERMISSIONS & CONTROLLER BARS */}
        {(rcControlledPeers.length > 0 || rcControlledByPeer) && (
          <div className="bg-[#2b2d31] border-b border-black/25 text-[#dbdee1] px-4 py-2 space-y-1.5 text-xs z-20">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 font-semibold text-[#f2f3f5]">
                <MonitorCog className="w-4 h-4 text-[#f23f42] shrink-0" />
                <span>Controle remoto ativo</span>
                {rcLocalHostBusy ? (
                  <span className="px-2 py-0.5 rounded bg-[#f0b232] text-[#1e1f22] text-[10px] font-bold">
                    Você está usando o PC: controle dos outros pausado
                  </span>
                ) : (
                  <span className="text-[10px] font-normal text-[#b5bac1]">
                    Mexer no seu mouse/teclado pausa os outros na hora. Ctrl+Shift+Esc encerra tudo.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {vigemStatus === 'ok' ? (
                  <span className="px-2 py-0.5 rounded-full bg-[#23a55a]/20 border border-[#23a55a]/50 text-[#4ade80] text-[10px] font-bold flex items-center gap-1">
                    <Gamepad2 className="w-3 h-3" />
                    Xbox Virtual Conectado
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-[#f0b232]">Joystick: modo teclado/mouse</span>
                    {onInstallViGEmBus && (
                      <button
                        type="button"
                        onClick={onInstallViGEmBus}
                        className="px-2 py-0.5 rounded bg-[#5865f2] hover:bg-[#4752c4] text-[10px] font-bold text-white cursor-pointer"
                        title="Instalar driver nativo Xbox 360 Virtual (ViGEmBus)"
                      >
                        Instalar Driver Controle
                      </button>
                    )}
                    {onRetryViGEm && (
                      <button
                        type="button"
                        onClick={onRetryViGEm}
                        className="p-1 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
                        title="Verificar driver novamente"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRevokeRemoteControl()}
                  className="px-2.5 py-1 rounded bg-[#4e5058] hover:bg-[#6d6f78] text-white font-bold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <ShieldOff className="w-3.5 h-3.5" />
                  Tirar controle de todos
                </button>
                {localScreenStream && (
                  <button
                    type="button"
                    onClick={() => {
                      onRevokeRemoteControl();
                      onStopScreenShare();
                    }}
                    className="px-2.5 py-1 rounded bg-[#da373c] hover:bg-[#a12828] text-white font-bold cursor-pointer shrink-0"
                    title="Encerra a transmissão e o controle remoto"
                  >
                    Parar transmissão
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(rcControlledPeers.length > 0
                ? rcControlledPeers
                : rcControlledByPeer
                ? [
                    {
                      socketId: rcControlledByPeer.socketId,
                      name: rcControlledByPeer.name,
                      permissions: { mouse: true, keyboard: true, gamepad: true },
                      gamepadSlot: 0,
                    },
                  ]
                : []
              ).map((peer) => (
                <div
                  key={peer.socketId}
                  className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1"
                >
                  <span className="font-bold text-white mr-1">{peer.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateRcPermissions?.(peer.socketId, { ...peer.permissions, mouse: !peer.permissions.mouse })
                    }
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                      peer.permissions.mouse ? 'bg-[#23a55a] text-white' : 'bg-[#2b2d31] text-[#949ba4]'
                    }`}
                    title="Permitir / Bloquear Mouse"
                  >
                    <Mouse className="w-3 h-3" />
                    Mouse
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateRcPermissions?.(peer.socketId, {
                        ...peer.permissions,
                        keyboard: !peer.permissions.keyboard,
                      })
                    }
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                      peer.permissions.keyboard ? 'bg-[#23a55a] text-white' : 'bg-[#2b2d31] text-[#949ba4]'
                    }`}
                    title="Permitir / Bloquear Teclado"
                  >
                    <Keyboard className="w-3 h-3" />
                    Teclado
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateRcPermissions?.(peer.socketId, {
                        ...peer.permissions,
                        gamepad: !peer.permissions.gamepad,
                      })
                    }
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                      peer.permissions.gamepad ? 'bg-[#5865f2] text-white' : 'bg-[#2b2d31] text-[#949ba4]'
                    }`}
                    title={`Permitir / Bloquear Controle #${peer.gamepadSlot + 1}`}
                  >
                    <Gamepad2 className="w-3 h-3" />
                    Controle #{peer.gamepadSlot + 1}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRevokeRemoteControl(peer.socketId)}
                    className="ml-1 text-[10px] font-bold text-[#ff8b8d] hover:underline cursor-pointer"
                  >
                    Sair
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {rcControllingPeer && (
          <div className="bg-[#2b2d31] border-b border-black/25 text-[#dbdee1] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold z-20">
            <div className="flex flex-wrap items-center gap-2">
              <MousePointerClick className="w-4 h-4 text-[#4ade80] shrink-0" />
              <span>
                Controlando <strong>{rcControllingPeer.name}</strong>
              </span>
              {rcRemoteHostBusy && (
                <span className="px-2 py-0.5 rounded bg-[#f0b232] text-[#1e1f22] text-[10px] font-bold">
                  {rcControllingPeer.name} está usando o PC: aguarde
                </span>
              )}
              <div className="flex items-center gap-1 text-[10px]">
                <span className={`px-1.5 py-0.5 rounded ${canSendMouse ? 'bg-[#23a55a]' : 'bg-black/40 opacity-50 line-through'}`}>
                  Mouse
                </span>
                <span className={`px-1.5 py-0.5 rounded ${canSendKey ? 'bg-[#23a55a]' : 'bg-black/40 opacity-50 line-through'}`}>
                  Teclado
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded flex items-center gap-1 ${
                    rcControllingPeer.permissions?.gamepad !== false ? 'bg-[#5865f2]' : 'bg-black/40 opacity-50 line-through'
                  }`}
                >
                  <Gamepad2 className="w-3 h-3" />
                  {connectedGamepads.length > 0 ? `${connectedGamepads.length} Controle(s) Ativo(s)` : 'Sem Joystick Plugado'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isActivelyControllingFocused && (
                <button
                  type="button"
                  onClick={toggleFocusMode}
                  className={`px-2.5 py-1 rounded font-bold flex items-center gap-1 cursor-pointer ${
                    focusMode ? 'bg-[#5865f2] text-white' : 'bg-black/40 hover:bg-black/60 text-white'
                  }`}
                  title="Tela cheia capturando Alt+Tab, tecla Windows e o mouse (para jogos). Segure Esc para sair."
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  {focusMode ? 'Sair do modo foco' : 'Modo foco'}
                </button>
              )}
              {canSendMouse && rcStream && (
                <button
                  type="button"
                  onClick={() => {
                    if (document.pointerLockElement) document.exitPointerLock?.();
                    else spotlightContainerRef.current?.requestPointerLock?.();
                  }}
                  className={`px-2.5 py-1 rounded font-bold flex items-center gap-1 cursor-pointer ${
                    pointerLocked ? 'bg-[#22d3ee] text-[#041418]' : 'bg-black/40 hover:bg-black/60 text-white'
                  }`}
                  title="Travar cursor para jogos 3D em primeira/terceira pessoa (Esc para soltar)"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  {pointerLocked ? 'Mouse Travado (Esc)' : 'Modo Jogo 3D'}
                </button>
              )}
              <button
                type="button"
                onClick={() => onRevokeRemoteControl()}
                className="px-3 py-1 rounded bg-[#da373c] hover:bg-[#b92d31] text-white font-bold cursor-pointer shrink-0"
              >
                Sair do Controle
              </button>
            </div>
          </div>
        )}

        {/* Soundboard Toasts */}
        {soundToasts.length > 0 && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex flex-col gap-1.5 pointer-events-none">
            {soundToasts.map((t) => (
              <div
                key={t.id}
                className="toast-enter flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#1e1f22]/95 border border-[#f0b232]/50 shadow-2xl text-xs text-white"
              >
                <span className="text-base">{t.sound.emoji}</span>
                <span>
                  <strong style={{ color: t.playedBy.avatarColor }}>{t.playedBy.displayName}</strong> tocou{' '}
                  <strong>{t.sound.name}</strong>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Main Video / Screen / Watch-Party / Whiteboard Stage */}
        <div ref={stageScrollRef} className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto min-h-0">
          {showWhiteboard && !backgrounded && (
            socket ? (
              // mesma altura do palco (igual ao player de vídeo); o resto da call fica abaixo, rolando
              <div className="shrink-0 h-full min-h-[420px] flex flex-col">
                <LazyBoundary
                  label="o Whiteboard"
                  fallback={<div className="flex-1 grid place-items-center text-xs text-[#949ba4]">Carregando o Whiteboard…</div>}
                >
                  <WhiteboardPanel
                    socket={socket}
                    channelId={channelId || channelName}
                    user={user}
                    canDraw={canWhiteboard}
                    onClose={() => setShowWhiteboard(false)}
                  />
                </LazyBoundary>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-[#2b2d31] border border-white/10 text-xs text-[#949ba4]">
                Aguardando conexão em sala para abrir o Whiteboard colaborativo.
              </div>
            )
          )}
          {hasAnySpotlight && (
            <StageGrid
              className="flex-1 min-h-[300px] -m-1"
              focusKey={stageFocusKey || (userFocusParticipant ? `user:${userFocusParticipant.socketId}` : null)}
              weights={stageWeights}
              onWeightsChange={setStageWeights}
              onCollapseTo={focusTile}
              heightPx={stageHeight}
              onHeightChange={changeStageHeight}
              tiles={[
                ...(currentWatchVideo
                  ? [
                      {
                        key: 'watch-party',
                        content: (
            <div
              className="relative w-full h-full bg-black rounded-lg overflow-hidden border-2 border-[#ff0033]/65 shadow-2xl group flex flex-col items-center justify-center"
            >
              {useYouTubeWatchPlayer && currentWatchVideo.youtubeId ? (
                <YouTubeSyncPlayer
                  youtubeId={currentWatchVideo.youtubeId}
                  serverUrl={serverUrl}
                  isPlaying={Boolean(videoState?.isPlaying)}
                  positionSec={videoState?.positionSec || 0}
                  serverNow={videoState?.serverNow || Date.now()}
                  clockOffsetMs={clockOffsetMs}
                  receivedAt={videoState?.receivedAt}
                  seq={videoState?.seq || 0}
                  lastAction={videoState?.lastAction}
                  rate={videoRate}
                  volume={videoVolume}
                  deafened={deafened}
                  captionsOn={captionsOn}
                  captionsLang={captionsLang}
                  onCaptionTracks={setCaptionTracks}
                  onTimeUpdate={(cur, dur) => {
                    setWatchCurSec((prev) => (Math.floor(prev) === Math.floor(cur) ? prev : cur));
                    if (dur > 0) setWatchDurSec(dur);
                    // player só demorou para subir: tira o aviso de bloqueado
                    if (cur > 0.5 && ytEmbedBlocked.has(currentWatchVideo.queueId)) {
                      setYtEmbedBlocked((prev) => {
                        const next = new Set(prev);
                        next.delete(currentWatchVideo.queueId);
                        return next;
                      });
                    }
                  }}
                  onEnded={(dur) => onVideoEnded(currentWatchVideo.queueId, dur)}
                  onFallbackNeeded={() => {
                    if (!currentWatchVideo.streamPath) {
                      // sem stream direto (YouTube bloqueou o download): avisa em vez de trocar
                      setYtEmbedBlocked((prev) => new Set(prev).add(currentWatchVideo.queueId));
                      return;
                    }
                    setYtFallbackIds((prev) => {
                      const next = new Set(prev);
                      next.add(currentWatchVideo.queueId);
                      return next;
                    });
                  }}
                  className="w-full h-full"
                />
              ) : (
                <>
                  <video
                    ref={watchVideoRef}
                    key={currentWatchVideo.queueId}
                    src={resolveMediaUrl(serverUrl, currentWatchVideo.streamPath || '')}
                    playsInline
                    muted={Boolean(currentWatchVideo.audioStreamPath)}
                    autoPlay={Boolean(videoState?.isPlaying)}
                    onPlay={(e) => {
                      const v = e.currentTarget as HTMLVideoElement;
                      const aud = watchAudioRef.current;
                      if (aud && currentWatchVideo.audioStreamPath) {
                        try {
                          if (Math.abs((aud.currentTime || 0) - (v.currentTime || 0)) > 0.15) {
                            aud.currentTime = v.currentTime || 0;
                          }
                        } catch {}
                        aud.volume = deafened ? 0 : Math.max(0, Math.min(1, videoVolume));
                        aud.play().catch(() => {});
                      }
                    }}
                    onPause={() => {
                      watchAudioRef.current?.pause();
                    }}
                    onWaiting={() => {
                      watchAudioRef.current?.pause();
                    }}
                    onPlaying={(e) => {
                      const v = e.currentTarget as HTMLVideoElement;
                      const aud = watchAudioRef.current;
                      if (aud && currentWatchVideo.audioStreamPath) {
                        if (Math.abs((aud.currentTime || 0) - (v.currentTime || 0)) > 0.15) {
                          try {
                            aud.currentTime = v.currentTime || 0;
                          } catch {}
                        }
                        aud.volume = deafened ? 0 : Math.max(0, Math.min(1, videoVolume));
                        aud.play().catch(() => {});
                      }
                    }}
                    onSeeked={(e) => {
                      const v = e.currentTarget as HTMLVideoElement;
                      const aud = watchAudioRef.current;
                      if (aud && currentWatchVideo.audioStreamPath) {
                        try {
                          aud.currentTime = v.currentTime || 0;
                        } catch {}
                      }
                    }}
                    onTimeUpdate={(e) => {
                      const v = e.currentTarget as HTMLVideoElement;
                      const vt = v.currentTime || 0;
                      setWatchCurSec((prev) => (Math.floor(prev) === Math.floor(vt) ? prev : vt));
                      const aud = watchAudioRef.current;
                      if (aud && currentWatchVideo.audioStreamPath && !v.paused) {
                        if (Math.abs((aud.currentTime || 0) - (v.currentTime || 0)) > 0.25) {
                          try {
                            aud.currentTime = v.currentTime || 0;
                          } catch {}
                        }
                      }
                    }}
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget as HTMLVideoElement;
                      const aud = watchAudioRef.current;
                      const hasSeparateAudio = Boolean(currentWatchVideo.audioStreamPath);
                      const effectiveVol = deafened ? 0 : Math.max(0, Math.min(1, videoVolume));
                      setWatchDurSec(el.duration || 0);
                      el.muted = hasSeparateAudio;
                      el.volume = hasSeparateAudio ? 0 : effectiveVol;
                      if (aud && hasSeparateAudio) {
                        aud.volume = effectiveVol;
                      }
                      el.playbackRate = videoRate;
                      if (aud) aud.playbackRate = videoRate;
                      if (videoState && videoState.queue[videoState.currentIndex]?.queueId === currentWatchVideo.queueId) {
                        const targetSec = expectedVideoPosition(
                          videoState.positionSec,
                          videoState.serverNow,
                          clockOffsetMs,
                          videoState.isPlaying,
                          videoState.rate || 1,
                          videoState.receivedAt
                        );
                        if (Number.isFinite(targetSec) && targetSec > 0.25 && Math.abs((el.currentTime || 0) - targetSec) > 0.25) {
                          try {
                            el.currentTime = targetSec;
                          } catch {
                            /* ignore */
                          }
                          if (aud && hasSeparateAudio) {
                            try {
                              aud.currentTime = targetSec;
                            } catch {
                              /* ignore */
                            }
                          }
                        }
                        if (videoState.isPlaying) {
                          el.play().catch(() => {});
                          if (aud && hasSeparateAudio) aud.play().catch(() => {});
                        } else {
                          el.pause();
                          if (aud && hasSeparateAudio) aud.pause();
                        }
                      }
                    }}
                    onEnded={(e) => {
                      watchAudioRef.current?.pause();
                      onVideoEnded(currentWatchVideo.queueId, (e.currentTarget as HTMLVideoElement).duration || 0);
                    }}
                    onClick={() => (videoState?.isPlaying ? onVideoPause() : onVideoPlay())}
                    className="w-full h-full object-contain cursor-pointer"
                  />
                  {currentWatchVideo.audioStreamPath && (
                    <audio
                      ref={watchAudioRef}
                      key={`${currentWatchVideo.queueId}-aud`}
                      src={resolveMediaUrl(serverUrl, currentWatchVideo.audioStreamPath)}
                      preload="auto"
                    />
                  )}
                </>
              )}

              {/* Click-overlay to toggle play/pause cleanly on YouTube iframe without breaking sync */}
              {useYouTubeWatchPlayer && (
                <div
                  onClick={() => (videoState?.isPlaying ? onVideoPause() : onVideoPlay())}
                  className="absolute inset-0 cursor-pointer z-0"
                  title="Clique para pausar ou retomar para todos"
                />
              )}

              {ytEmbedBlocked.has(currentWatchVideo.queueId) && useYouTubeWatchPlayer && (
                <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-black/85 text-center px-6">
                  <div className="text-sm font-semibold text-white">Este vídeo não pode ser tocado aqui</div>
                  <p className="text-xs text-[#b5bac1] max-w-sm">
                    O dono do vídeo bloqueou o player incorporado e o YouTube recusou o download direto.
                    Pule para o próximo ou peça ao host para colar um cookies.txt nas configurações do servidor.
                  </p>
                  <button
                    type="button"
                    onClick={onVideoNext}
                    className="mt-1 px-3 h-8 rounded-[4px] bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold cursor-pointer"
                  >
                    Próximo vídeo
                  </button>
                </div>
              )}

              {/* Top-left Watch-Party Info */}
              <div className="absolute top-3 left-3 right-3 flex items-center gap-2 pointer-events-none z-10 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ff0033] text-[11px] font-bold text-white shadow">
                  <Clapperboard className="w-3.5 h-3.5" />
                  {useYouTubeWatchPlayer ? 'YOUTUBE SYNC' : 'CINEMA SYNC'}
                </span>
                <span className="min-w-0 px-2.5 py-1 rounded-full bg-black/75 text-xs font-semibold text-white max-w-md truncate">
                  {currentWatchVideo.title} • {currentWatchVideo.author}
                </span>
              </div>

              {renderTileCorner('watch-party')}

              {/* Bottom Interactive YouTube-Style Watch-Party Controls Bar */}
              <div className="absolute bottom-3 left-3 right-3 bg-gradient-to-t from-black/95 via-black/85 to-black/70 border border-white/10 rounded-lg px-3.5 py-2 flex flex-col gap-1.5 opacity-95 sm:opacity-0 sm:group-hover:opacity-100 transition z-10">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[#dbdee1] w-10">
                    {Math.floor(watchCurSec / 60)}:{Math.floor(watchCurSec % 60).toString().padStart(2, '0')}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={watchDurSec > 0 ? watchDurSec : currentWatchVideo.duration || 100}
                    step={0.25}
                    value={Math.min(watchCurSec, watchDurSec || currentWatchVideo.duration || 100)}
                    onChange={(e) => handleWatchSeekOptimistic(Number(e.target.value))}
                    className="flex-1 h-1.5 accent-[#ff0033] cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-[#949ba4] w-10 text-right">
                    {Math.floor((watchDurSec || currentWatchVideo.duration || 0) / 60)}:
                    {Math.floor((watchDurSec || currentWatchVideo.duration || 0) % 60)
                      .toString()
                      .padStart(2, '0')}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={onVideoPrev}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-white cursor-pointer"
                      title="Vídeo anterior"
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleWatchSeekOptimistic(Math.max(0, watchCurSec - 10))}
                      className="px-1.5 py-1 rounded-lg hover:bg-white/10 text-[10px] font-bold text-white flex items-center cursor-pointer"
                      title="Voltar 10s para todos"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-0.5" />
                      10s
                    </button>
                    <button
                      type="button"
                      onClick={() => (videoState?.isPlaying ? onVideoPause() : onVideoPlay())}
                      className="w-8 h-8 rounded-full bg-[#ff0033] hover:bg-[#cc0029] text-white flex items-center justify-center cursor-pointer shadow"
                      title={videoState?.isPlaying ? 'Pausar para todos' : 'Tocar para todos'}
                    >
                      {videoState?.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleWatchSeekOptimistic(watchCurSec + 10)}
                      className="px-1.5 py-1 rounded-lg hover:bg-white/10 text-[10px] font-bold text-white flex items-center cursor-pointer"
                      title="Avançar 10s para todos"
                    >
                      10s
                      <RotateCw className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                    <button
                      type="button"
                      onClick={onVideoNext}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-white cursor-pointer"
                      title="Próximo vídeo"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetDrawer(activeDrawer === 'video' ? 'none' : 'video')}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-bold text-white cursor-pointer ml-1"
                    >
                      Fila ({videoState?.queue.length || 0})
                    </button>
                  </div>

                  <div className="flex items-center gap-2" title="Volume individual (apenas seu fone)">
                    <span className="hidden md:inline text-[10px] text-[#949ba4]">Vol. individual</span>
                    <button
                      type="button"
                      onClick={() => onVideoVolumeChange(videoVolume > 0 ? 0 : 0.85)}
                      className="text-white cursor-pointer"
                      title="Mutar vídeo localmente"
                    >
                      {videoVolume === 0 || deafened ? (
                        <VolumeX className="w-4 h-4 text-[#ff0033]" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-[#4ade80]" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={videoVolume}
                      onChange={(e) => onVideoVolumeChange(Number(e.target.value))}
                      className="w-20 accent-[#ff0033] cursor-pointer"
                    />
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setVideoMenu((m) => (m === 'captions' ? null : 'captions'))}
                        className={`p-1.5 rounded-lg hover:bg-white/10 cursor-pointer ${
                          captionsOn && useYouTubeWatchPlayer ? 'text-white bg-white/15' : 'text-[#dbdee1]'
                        }`}
                        title={useYouTubeWatchPlayer ? 'Legendas (só para você)' : 'Legendas: disponíveis no modo YouTube'}
                      >
                        <Captions className="w-4 h-4" />
                      </button>
                      {videoMenu === 'captions' && (
                        <div className="absolute bottom-9 right-0 w-56 max-h-72 overflow-y-auto rounded-[6px] bg-[#111214] border border-white/10 shadow-xl p-1.5 text-[12px] z-20">
                          <div className="px-2 py-1 text-[11px] font-bold uppercase text-[#949ba4]">Legendas · só você</div>
                          {!useYouTubeWatchPlayer ? (
                            <div className="px-2 py-1.5 text-[#b5bac1]">
                              Legendas funcionam no player do YouTube. Volte para ele em “Fonte”.
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setCaptionsOn(false);
                                  setVideoMenu(null);
                                }}
                                className="w-full flex items-center justify-between px-2 h-8 rounded-[4px] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white cursor-pointer"
                              >
                                Desligadas {!captionsOn && <Check className="w-3.5 h-3.5" />}
                              </button>
                              {captionTracks.length === 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCaptionsOn(true);
                                    setCaptionsLang('');
                                  }}
                                  className="w-full flex items-center justify-between px-2 h-8 rounded-[4px] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white cursor-pointer"
                                >
                                  Ligadas (idioma automático) {captionsOn && !captionsLang && <Check className="w-3.5 h-3.5" />}
                                </button>
                              )}
                              {captionTracks.map((t) => (
                                <button
                                  key={t.code}
                                  type="button"
                                  onClick={() => {
                                    setCaptionsOn(true);
                                    setCaptionsLang(t.code);
                                    setVideoMenu(null);
                                  }}
                                  className="w-full flex items-center justify-between gap-2 px-2 h-8 rounded-[4px] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white cursor-pointer"
                                >
                                  <span className="truncate">{t.name}</span>
                                  {captionsOn && captionsLang === t.code && <Check className="w-3.5 h-3.5 shrink-0" />}
                                </button>
                              ))}
                              {captionsOn && captionTracks.length === 0 && (
                                <div className="px-2 py-1 text-[11px] text-[#949ba4]">Carregando idiomas do vídeo…</div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setVideoMenu((m) => (m === 'speed' ? null : 'speed'))}
                        className={`h-7 px-1.5 rounded-lg hover:bg-white/10 cursor-pointer flex items-center gap-1 text-[11px] font-bold ${
                          videoRate !== 1 ? 'text-white bg-white/15' : 'text-[#dbdee1]'
                        }`}
                        title="Velocidade e fonte (velocidade vale para todos)"
                      >
                        <Gauge className="w-4 h-4" />
                        {videoRate !== 1 && `${videoRate}x`}
                      </button>
                      {videoMenu === 'speed' && (
                        <div className="absolute bottom-9 right-0 w-48 rounded-[6px] bg-[#111214] border border-white/10 shadow-xl p-1.5 text-[12px] z-20">
                          <div className="px-2 py-1 text-[11px] font-bold uppercase text-[#949ba4]">Velocidade · todos</div>
                          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                            <button
                              key={r}
                              type="button"
                              disabled={!onVideoRate}
                              onClick={() => {
                                onVideoRate?.(r);
                                setVideoMenu(null);
                              }}
                              className="w-full flex items-center justify-between px-2 h-7 rounded-[4px] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white cursor-pointer disabled:opacity-50"
                            >
                              {r === 1 ? 'Normal' : `${r}x`} {videoRate === r && <Check className="w-3.5 h-3.5" />}
                            </button>
                          ))}
                          {currentWatchVideo.youtubeId && (
                            <>
                              <div className="h-px bg-white/10 my-1" />
                              <div className="px-2 py-1 text-[11px] font-bold uppercase text-[#949ba4]">Fonte · só você</div>
                              <button
                                type="button"
                                onClick={() => {
                                  setYtFallbackIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(currentWatchVideo.queueId);
                                    return next;
                                  });
                                  setVideoMenu(null);
                                }}
                                className="w-full flex items-center justify-between px-2 h-7 rounded-[4px] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white cursor-pointer"
                              >
                                Player do YouTube {useYouTubeWatchPlayer && <Check className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                disabled={!hasDirectStream}
                                onClick={() => {
                                  setYtFallbackIds((prev) => new Set(prev).add(currentWatchVideo.queueId));
                                  setVideoMenu(null);
                                }}
                                title={hasDirectStream ? undefined : 'O YouTube recusou o download direto deste vídeo'}
                                className="w-full flex items-center justify-between px-2 h-7 rounded-[4px] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                              >
                                Stream direto 1080p {!useYouTubeWatchPlayer && <Check className="w-3.5 h-3.5" />}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const vid = watchVideoRef.current;
                        if (vid && document.pictureInPictureElement !== vid) {
                          vid.requestPictureInPicture().catch(() => {});
                        } else if (document.pictureInPictureElement) {
                          document.exitPictureInPicture().catch(() => {});
                        }
                      }}
                      className="p-1.5 rounded-lg text-[#dbdee1] hover:bg-white/10 cursor-pointer"
                      title="Picture-in-Picture"
                    >
                      <PictureInPicture2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleFullscreen}
                      className="p-1.5 rounded-lg text-[#dbdee1] hover:bg-white/10 cursor-pointer"
                      title="Tela cheia"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
                        ),
                      },
                    ]
                  : []),
                ...watchedStreams.map((st) => ({ key: st.key, content: renderScreenTile(st) })),
                ...(userFocusParticipant
                  ? [{ key: `user:${userFocusParticipant.socketId}`, content: renderParticipantCard(userFocusParticipant, 'focus') }]
                  : []),
              ]}
            />
          )}

          {topBanner}

          {/* Participants Grid / Strip */}
          <div
            className={
              hasAnySpotlight
                ? stageHeight
                  ? 'flex gap-3 overflow-x-auto pb-1 flex-1 min-h-[9rem]'
                  : 'flex gap-3 overflow-x-auto pb-1 shrink-0 h-36'
                : 'flex-1 grid gap-3 auto-rows-fr place-content-center'
            }
            style={
              !hasAnySpotlight
                ? {
                    gridTemplateColumns:
                      participants.length <= 1
                        ? 'minmax(280px, 520px)'
                        : participants.length === 2
                        ? 'repeat(2, minmax(240px, 1fr))'
                        : 'repeat(auto-fit, minmax(240px, 1fr))',
                  }
                : undefined
            }
          >
            {anyFocus && renderHiddenStageChips()}
            {participants.map((p) => renderParticipantCard(p, hasAnySpotlight ? 'strip' : 'grid'))}
          </div>
        </div>

        {/* Bottom Floating Call Control Dock */}
        <div className="shrink-0 pb-4 pt-2 px-4 flex justify-center">
          <div className="flex items-center gap-2.5 bg-[#2b2d31]/95 border border-white/10 px-4 py-2.5 rounded-lg shadow-2xl">
            <button
              type="button"
              disabled={!canSpeak && muted}
              onClick={onToggleMute}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                muted || deafened || user.serverMuted
                  ? 'bg-[#f23f42] text-white'
                  : 'bg-[#313338] hover:bg-[#404249] text-white'
              }`}
              title={!canSpeak ? 'Seu cargo não tem permissão para falar aqui' : 'Mutar/Desmutar'}
            >
              {muted || deafened || user.serverMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <button
              type="button"
              onClick={onToggleDeafen}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition cursor-pointer ${
                deafened || user.serverDeafened
                  ? 'bg-[#f23f42] text-white'
                  : 'bg-[#313338] hover:bg-[#404249] text-white'
              }`}
              title="Ensurdecer"
            >
              {deafened || user.serverDeafened ? <HeadphoneOff className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
            </button>

            {extraControls}

            <button
              type="button"
              disabled={!canStream && !localCamStream}
              onClick={onToggleCamera}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                localCamStream ? 'bg-[#23a55a] text-white' : 'bg-[#313338] hover:bg-[#404249] text-white'
              }`}
              title={!canStream ? 'Cargo sem permissão para câmera/transmissão' : 'Câmera'}
            >
              {localCamStream ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
            </button>

            <button
              type="button"
              disabled={!canStream && !localScreenStream}
              onClick={localScreenStream ? onStopScreenShare : onOpenScreenShare}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                localScreenStream
                  ? 'bg-[#23a55a] hover:bg-[#f23f42] text-white'
                  : 'bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1]'
              }`}
              title={
                !canStream
                  ? 'Cargo sem permissão para transmitir tela'
                  : localScreenStream
                  ? 'Parar transmissão de tela'
                  : 'Transmitir tela'
              }
            >
              {localScreenStream ? <MonitorOff className="w-5 h-5" /> : <MonitorPlay className="w-5 h-5" />}
            </button>

            <div className="w-px h-7 bg-white/10 mx-0.5" />

            <button
              type="button"
              onClick={() => setShowWhiteboard((v) => !v)}
              className={`w-11 h-11 rounded-full flex items-center justify-center cursor-pointer ${
                showWhiteboard
                  ? 'bg-[#dbdee1] text-[#1e1f22]'
                  : 'bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1]'
              }`}
              title="Whiteboard"
            >
              <Palette className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => onSetDrawer(activeDrawer === 'video' ? 'none' : 'video')}
              className={`w-11 h-11 rounded-full flex items-center justify-center cursor-pointer ${
                activeDrawer === 'video'
                  ? 'bg-[#dbdee1] text-[#1e1f22]'
                  : 'bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1]'
              }`}
              title="Vídeos (assistir junto)"
            >
              <Clapperboard className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => onSetDrawer(activeDrawer === 'soundboard' ? 'none' : 'soundboard')}
              className={`w-11 h-11 rounded-full flex items-center justify-center cursor-pointer ${
                activeDrawer === 'soundboard'
                  ? 'bg-[#dbdee1] text-[#1e1f22]'
                  : 'bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1]'
              }`}
              title="Soundboard"
            >
              <Zap className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => onSetDrawer(activeDrawer === 'music' ? 'none' : 'music')}
              className={`w-11 h-11 rounded-full flex items-center justify-center cursor-pointer ${
                activeDrawer === 'music'
                  ? 'bg-[#dbdee1] text-[#1e1f22]'
                  : 'bg-[#2b2d31] hover:bg-[#404249] text-[#dbdee1]'
              }`}
              title="Músicas"
            >
              <Music className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={onLeaveVoice}
              className="w-12 h-11 rounded-full bg-[#f23f42] hover:bg-[#da373c] text-white flex items-center justify-center cursor-pointer ml-1"
              title="Sair da chamada"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {activeDrawer !== 'none' && (
        <div className="relative shrink-0 h-full flex" style={{ width: drawerWidth }}>
          <PanelResizer side="left" width={drawerWidth} defaultWidth={340} onResize={setDrawerWidth} />
      {activeDrawer === 'soundboard' && (
        <SoundboardPanel
          api={api}
          user={user}
          sounds={sounds}
          volume={soundboardVolume}
          onVolumeChange={onSoundboardVolumeChange}
          onPlaySound={canSoundboard ? onPlaySound : () => {}}
          onStopAll={canSoundboard ? onStopAllSounds : () => {}}
          onClose={() => onSetDrawer('none')}
        />
      )}

      {activeDrawer === 'music' && (
        <MusicPlayerPanel
          musicState={musicState}
          currentSec={musicCurrentSec}
          durationSec={musicDurationSec}
          volume={musicVolume}
          onVolumeChange={onMusicVolumeChange}
          onAddMusicUrl={
            canMediaQueue ? onMusicAddUrl : async () => ({ error: 'Seu cargo não tem permissão para adicionar músicas.' })
          }
          onPlay={canMediaQueue ? onMusicPlay : () => {}}
          onPause={canMediaQueue ? onMusicPause : () => {}}
          onSeek={canMediaQueue ? onMusicSeek : () => {}}
          onNext={canMediaQueue ? onMusicNext : () => {}}
          onPrev={canMediaQueue ? onMusicPrev : () => {}}
          onRemoveFromQueue={canMediaQueue ? onMusicRemove : () => {}}
          onRemovePlaylistBlock={canMediaQueue ? onMusicRemoveBlock : () => {}}
          onClearQueue={canMediaQueue ? onMusicClear : () => {}}
          onLoopChange={canMediaQueue ? onMusicLoop : () => {}}
          onClose={() => onSetDrawer('none')}
        />
      )}

      {activeDrawer === 'video' && (
        <VideoPlayerPanel
          videoState={videoState}
          currentSec={watchCurSec}
          durationSec={watchDurSec || currentWatchVideo?.duration || 0}
          volume={videoVolume}
          onVolumeChange={onVideoVolumeChange}
          onAddVideoUrl={
            canMediaQueue ? onVideoAddUrl : async () => ({ error: 'Seu cargo não tem permissão para controlar a fila de vídeo.' })
          }
          onPlay={canMediaQueue ? onVideoPlay : () => {}}
          onPause={canMediaQueue ? onVideoPause : () => {}}
          onSeek={canMediaQueue ? handleWatchSeekOptimistic : () => {}}
          onNext={canMediaQueue ? onVideoNext : () => {}}
          onPrev={canMediaQueue ? onVideoPrev : () => {}}
          onRemoveFromQueue={canMediaQueue ? onVideoRemove : () => {}}
          onClearQueue={canMediaQueue ? onVideoClear : () => {}}
          onClose={() => onSetDrawer('none')}
        />
      )}
        </div>
      )}
    </div>
  );
};
