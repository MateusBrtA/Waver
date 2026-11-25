import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Code2,
  Download,
  FileText,
  Film,
  Flame,
  HardDrive,
  Hash,
  Image as ImageIcon,
  KanbanSquare,
  Loader2,
  Lock,
  Mic,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Settings,
  Smile,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { ApiClient, resolveMediaUrl } from '../lib/api';
import { detectCodeLanguage, formatLanguageLabel, parseMessageSegments } from '../lib/codeDetect';
import {
  Attachment,
  Channel,
  ChatMessage,
  FileTransfer,
  GifItem,
  Model3DViewerTarget,
  PrivateGroup,
  RolePermissions,
  User,
} from '../types';
import { Avatar } from './Avatar';
import { CodeBlock } from './CodeBlock';
import { FileTransferModal, formatBytes } from './FileTransferModal';
import { extractEmbeddableMediaUrls, LinkEmbedCard } from './LinkEmbedCard';
import { getFileExtension, is3DModelFilename } from '../lib/model3dUtils';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import { isTextureLikeName } from '../lib/model3dUtils';

const Model3DInlinePreview = React.lazy(() => import('./Model3DInlinePreview'));

const QUICK_EMOJIS = [
  '😂', '🤣', '🔥', '💀', '😭', '😎', '🤩', '🥳',
  '❤️', '💜', '👀', '👏', '🙌', '👍', '👎', '🤝',
  '🎮', '🎧', '🎬', '🎵', '💥', '⚡', '🏆', '👑',
  '😈', '🤡', '🫡', '🤔', '😱', '🤯', '🥶', '🥵',
  '🚀', '💯', '✅', '❌', '🎉', '🍿', '🍕', '☕',
];

const DIRECT_IMAGE_URL_REGEX = /^https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i;

interface ChatAreaProps {
  api?: ApiClient | null;
  serverUrl: string;
  user: User;
  members: User[];
  channel?: Channel | null;
  dmPeer?: User | null;
  dmGroup?: PrivateGroup | null;
  permissions?: RolePermissions;
  isPureLanDm?: boolean;
  messages: ChatMessage[];
  typingUsers: string[];
  savedGifs: GifItem[];
  blockedUserIds: Set<string>;
  mentionRequest: { text: string; seq: number } | null;
  activeVoiceLabel: string | null;
  showMembers: boolean;
  onToggleMembers: () => void;
  onReturnToVoice: () => void;
  onStartPrivateCall?: (peer: User) => void;
  onStartGroupCall?: (group: PrivateGroup) => void;
  onOpenGroupSettings?: (group: PrivateGroup) => void;
  onOpenTrello?: () => void;
  onCreateGroupFromDm?: (peer: User) => void;
  onOpen3DModel?: (target: Model3DViewerTarget) => void;
  onSendVideoUrlToVoice?: (url: string) => void;
  onSendMusicUrlToVoice?: (url: string) => void;
  onUserClick: (targetUser: User, e: React.MouseEvent) => void;
  onUserContextMenu: (targetUser: User, e: React.MouseEvent) => void;
  onUploadPendingAttachments?: (
    files: File[],
    meta?: Array<{ waveform?: number[]; durationSec?: number; isVoiceMessage?: boolean }>
  ) => Promise<Array<Attachment & { _rawBytes?: Uint8Array }>>;
  onSendMessage: (payload: {
    content: string;
    attachments: Array<Attachment & { _rawBytes?: Uint8Array }>;
    gifUrl?: string | null;
    transfer?: FileTransfer | null;
    replyTo?: ChatMessage['replyTo'];
  }) => void;
  onPinMessage?: (messageId: string, pinned: boolean) => void;
  onDeleteMessage?: (messageId: string) => void;
  onTyping?: (isTyping: boolean) => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  api,
  serverUrl,
  user,
  members,
  channel,
  dmPeer,
  dmGroup,
  permissions,
  isPureLanDm = false,
  messages,
  typingUsers,
  savedGifs,
  blockedUserIds,
  mentionRequest,
  activeVoiceLabel,
  showMembers,
  onToggleMembers,
  onReturnToVoice,
  onStartPrivateCall,
  onStartGroupCall,
  onOpenGroupSettings,
  onOpenTrello,
  onCreateGroupFromDm,
  onOpen3DModel,
  onSendVideoUrlToVoice,
  onSendMusicUrlToVoice,
  onUserClick,
  onUserContextMenu,
  onUploadPendingAttachments,
  onSendMessage,
  onPinMessage,
  onDeleteMessage,
  onTyping,
}) => {
  const isDm = Boolean(dmPeer);
  const isGroup = Boolean(dmGroup);
  const isPrivateScope = isDm || isGroup;
  const titleLabel = dmGroup ? dmGroup.name : dmPeer ? dmPeer.displayName : `#${channel?.name || 'geral'}`;

  const canSend = isPrivateScope ? true : permissions?.sendMessages !== false;
  const canAttach = isPrivateScope ? true : canSend && permissions?.attachFiles !== false;
  const canPin = isPrivateScope ? true : permissions?.pinMessages !== false;
  const canManageMessages = isPrivateScope ? false : Boolean(permissions?.manageMessages) || user.role === 'host';

  const [acceptedNsfwIds, setAcceptedNsfwIds] = useState<Set<string>>(() => new Set());
  const [slowModeLeftSec, setSlowModeLeftSec] = useState(0);

  const [text, setText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<Array<Attachment & { _rawBytes?: Uint8Array }>>([]);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [detectedCodeLang, setDetectedCodeLang] = useState<string | null>(null);
  const [wrapAsCode, setWrapAsCode] = useState(true);
  const [showPinsPopover, setShowPinsPopover] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(80);

  // Voice Message Recorder state
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [liveRecBars, setLiveRecBars] = useState<number[]>(new Array(18).fill(0.15));
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recAudioCtxRef = useRef<AudioContext | null>(null);
  const recTimerRef = useRef<number | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recSamplesRef = useRef<number[]>([]);
  const recStartTsRef = useRef<number>(0);

  // Pickers
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifTab, setGifTab] = useState<'server' | 'search' | 'add'>('server');
  const [gifQuery, setGifQuery] = useState('');
  const [gifSearchResults, setGifSearchResults] = useState<GifItem[]>([]);
  const [gifProvider, setGifProvider] = useState('local');
  const [gifLoading, setGifLoading] = useState(false);
  const [newGifTitle, setNewGifTitle] = useState('');
  const [newGifUrl, setNewGifUrl] = useState('');
  const [newGifTags, setNewGifTags] = useState('');
  const [newGifFile, setNewGifFile] = useState<File | null>(null);
  const [savingGif, setSavingGif] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<number | null>(null);

  const pinnedMessages = useMemo(() => messages.filter((m) => Boolean(m.pinned)), [messages]);
  const hiddenCount = Math.max(0, messages.length - visibleLimit);
  const visibleMessages = useMemo(() => messages.slice(-visibleLimit), [messages, visibleLimit]);

  useEffect(() => {
    setVisibleLimit(80);
    setShowPinsPopover(false);
    setSlowModeLeftSec(0);
  }, [channel?.id, dmPeer?.id, dmGroup?.id]);

  useEffect(() => {
    if (slowModeLeftSec <= 0) return;
    const t = window.setInterval(() => {
      setSlowModeLeftSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [slowModeLeftSec > 0]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, channel?.id, dmPeer?.id]);

  // Insert @mention from right-click context menu!
  useEffect(() => {
    if (!mentionRequest?.text) return;
    setText((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${mentionRequest.text} `);
    textAreaRef.current?.focus();
  }, [mentionRequest?.seq]);

  useEffect(() => {
    if (!showGifPicker || !api) return;
    let cancelled = false;
    setGifLoading(true);
    api
      .searchGifs(gifQuery)
      .then((res) => {
        if (cancelled) return;
        setGifProvider(res.provider);
        setGifSearchResults(res.results);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setGifLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showGifPicker, gifQuery, api]);

  const cleanupVoiceRecorder = () => {
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    if (recAudioCtxRef.current) {
      recAudioCtxRef.current.close().catch(() => {});
      recAudioCtxRef.current = null;
    }
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    mediaRecRef.current = null;
  };

  useEffect(() => () => cleanupVoiceRecorder(), []);

  const resampleWaveform = (raw: number[], targetLen = 48): number[] => {
    if (!raw || raw.length === 0) return new Array(targetLen).fill(0.25);
    const out: number[] = [];
    for (let i = 0; i < targetLen; i++) {
      const idx = Math.floor((i / targetLen) * raw.length);
      out.push(Number(Math.max(0.1, Math.min(1, raw[idx] || 0.1)).toFixed(2)));
    }
    return out;
  };

  const handleStartVoiceRecord = async () => {
    if (recordingVoice) return;
    setUploadError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      recStreamRef.current = stream;
      recChunksRef.current = [];
      recSamplesRef.current = [];
      recStartTsRef.current = Date.now();
      setRecordSec(0);

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
      mediaRecRef.current = mr;

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recChunksRef.current.push(ev.data);
      };

      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        recAudioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        recTimerRef.current = window.setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const dev = Math.abs(buf[i] - 128) / 128;
            if (dev > peak) peak = dev;
          }
          const normalized = Math.max(0.1, Math.min(1, peak * 3.1));
          recSamplesRef.current.push(normalized);
          setLiveRecBars((prev) => [...prev.slice(1), normalized]);
          setRecordSec(Math.round((Date.now() - recStartTsRef.current) / 1000));
        }, 80);
      } else {
        recTimerRef.current = window.setInterval(() => {
          setRecordSec(Math.round((Date.now() - recStartTsRef.current) / 1000));
        }, 500);
      }

      mr.start(150);
      setRecordingVoice(true);
    } catch {
      cleanupVoiceRecorder();
      setUploadError('Não foi possível acessar o microfone para gravar áudio.');
    }
  };

  const handleCancelVoiceRecord = () => {
    try {
      mediaRecRef.current?.stop();
    } catch {}
    cleanupVoiceRecorder();
    recChunksRef.current = [];
    setRecordingVoice(false);
    setRecordSec(0);
  };

  const handleFinishAndSendVoiceRecord = async () => {
    const mr = mediaRecRef.current;
    if (!mr) return;
    const durationSec = Math.max(1, (Date.now() - recStartTsRef.current) / 1000);
    const waveform = resampleWaveform(recSamplesRef.current, 48);

    const blob: Blob = await new Promise((resolve) => {
      mr.onstop = () => {
        resolve(new Blob(recChunksRef.current, { type: mr.mimeType || 'audio/webm' }));
      };
      try {
        if (mr.state !== 'inactive') mr.stop();
        else resolve(new Blob(recChunksRef.current, { type: mr.mimeType || 'audio/webm' }));
      } catch {
        resolve(new Blob(recChunksRef.current, { type: 'audio/webm' }));
      }
    });

    cleanupVoiceRecorder();
    setRecordingVoice(false);
    setRecordSec(0);
    if (blob.size < 200) return;

    const file = new File([blob], `audio-${Date.now()}.webm`, { type: 'audio/webm' });
    setUploading(true);
    try {
      const meta = [{ waveform, durationSec: Number(durationSec.toFixed(1)), isVoiceMessage: true }];
      const uploaded = onUploadPendingAttachments
        ? await onUploadPendingAttachments([file], meta)
        : api
        ? (await api.uploadChatFiles([file], meta)).attachments
        : [];
      if (uploaded.length > 0) {
        onSendMessage({
          content: '',
          attachments: uploaded,
          replyTo: replyTo
            ? {
                id: replyTo.id,
                authorName: replyTo.authorName,
                snippet: replyTo.content || '[Áudio]',
              }
            : null,
        });
        setReplyTo(null);
      }
    } catch (err: unknown) {
      setUploadError((err as Error).message || 'Falha ao enviar áudio.');
    } finally {
      setUploading(false);
    }
  };

  const handleFilesSelected = async (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, 6);
    if (!arr.length) return;
    // If any single file is > 55 MB in server mode, steer cleanly into the Heavy Transfer Modal
    if (!isPureLanDm && arr.some((f) => f.size > 55 * 1024 * 1024)) {
      setShowTransferModal(true);
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const attachments = onUploadPendingAttachments
        ? await onUploadPendingAttachments(arr)
        : api
        ? (await api.uploadChatFiles(arr)).attachments
        : [];
      setPendingAttachments((prev) => [...prev, ...attachments].slice(0, 6));
    } catch (err: unknown) {
      setUploadError((err as Error).message || 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFilesSelected(files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const triggerTyping = () => {
    if (!onTyping) return;
    onTyping(true);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => onTyping(false), 2200);
  };

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend || slowModeLeftSec > 0) return;
    let trimmed = text.trim();
    if (!trimmed && pendingAttachments.length === 0) return;

    if (trimmed && detectedCodeLang && wrapAsCode && !trimmed.includes('```')) {
      trimmed = `\`\`\`${detectedCodeLang}\n${trimmed}\n\`\`\``;
    }

    onSendMessage({
      content: trimmed,
      attachments: pendingAttachments,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            authorName: replyTo.authorName,
            snippet: replyTo.content || (replyTo.gifUrl ? '[GIF]' : '[Anexo]'),
          }
        : null,
    });
    if (!isPrivateScope && channel?.slowModeSec && channel.slowModeSec > 0 && !canManageMessages && !permissions?.manageChannels) {
      setSlowModeLeftSec(channel.slowModeSec);
    }
    setText('');
    setDetectedCodeLang(null);
    setWrapAsCode(true);
    setPendingAttachments([]);
    setReplyTo(null);
    onTyping?.(false);
  };

  const handleSendGif = (url: string) => {
    onSendMessage({
      content: '',
      attachments: [],
      gifUrl: url,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            authorName: replyTo.authorName,
            snippet: replyTo.content || '[Mídia]',
          }
        : null,
    });
    setShowGifPicker(false);
    setReplyTo(null);
  };

  const handleSaveNewGif = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api || (!newGifFile && !newGifUrl.trim())) return;
    setSavingGif(true);
    try {
      const { gif } = await api.saveGif({
        title: newGifTitle.trim() || 'GIF da Galera',
        tags: newGifTags.trim(),
        url: newGifUrl.trim() || undefined,
        file: newGifFile || undefined,
      });
      setNewGifTitle('');
      setNewGifUrl('');
      setNewGifTags('');
      setNewGifFile(null);
      setGifTab('server');
      handleSendGif(gif.url);
    } catch (err: unknown) {
      setUploadError((err as Error).message || 'Erro ao salvar GIF.');
    } finally {
      setSavingGif(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return isToday ? `Hoje às ${hm}` : `${d.toLocaleDateString('pt-BR')} ${hm}`;
  };

  const resolveAuthor = (msg: ChatMessage): User => {
    return (
      members.find((m) => m.id === msg.authorId) || {
        id: msg.authorId,
        username: msg.authorName.toLowerCase(),
        displayName: msg.authorName,
        avatarUrl: msg.authorAvatar,
        avatarColor: msg.authorColor,
        role: 'member',
        createdAt: msg.createdAt,
      }
    );
  };

  const filteredSavedGifs = gifQuery.trim()
    ? savedGifs.filter(
        (g) =>
          g.title.toLowerCase().includes(gifQuery.toLowerCase()) ||
          (g.tags || '').toLowerCase().includes(gifQuery.toLowerCase())
      )
    : savedGifs;

  return (
    <div
      className="flex-1 flex flex-col bg-[#313338] pc-chat min-w-0 h-full relative"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-40 bg-[#5865f2]/20 border-2 border-dashed border-[#5865f2] m-3 rounded-lg flex flex-col items-center justify-center pointer-events-none">
          <Upload className="w-12 h-12 text-[#5865f2] mb-2" />
          <p className="text-lg font-bold text-white">Solte imagens, GIFs ou modelos 3D aqui!</p>
          <p className="text-xs text-[#dbdee1]">Para enviar em {titleLabel}</p>
        </div>
      )}

      {/* Header (48px authentic Discord bar) */}
      <header className="h-12 shrink-0 px-4 border-b border-white/10 shadow-[0_1px_0_rgba(0,0,0,0.3)] flex items-center justify-between gap-3 bg-[#313338]">
        <div className="flex items-center gap-2.5 min-w-0">
          {isGroup && dmGroup ? (
            <>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#5865f2] to-[#eb459e] flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden">
                {dmGroup.iconUrl ? (
                  <img
                    src={resolveMediaUrl(dmGroup.hostP2pUrl || serverUrl, dmGroup.iconUrl)}
                    alt={dmGroup.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Users className="w-4 h-4" />
                )}
              </div>
              <h2 className="font-bold text-white text-base truncate">{dmGroup.name}</h2>
              <span className="text-[11px] text-[#949ba4] shrink-0">• {dmGroup.memberIds.length} membros</span>
            </>
          ) : isDm && dmPeer ? (
            <>
              <div
                onClick={(e) => onUserClick(dmPeer, e)}
                className="cursor-pointer flex items-center gap-2 min-w-0"
              >
                <Avatar
                  name={dmPeer.displayName}
                  avatarUrl={dmPeer.avatarUrl}
                  color={dmPeer.avatarColor}
                  decoration={dmPeer.avatarDecoration}
                  serverUrl={serverUrl}
                  size="xs"
                  online={Boolean(dmPeer.online)}
                  statusType={dmPeer.statusType}
                />
                <h2 className="font-bold text-white text-base truncate">{dmPeer.displayName}</h2>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#23a55a]/15 text-[#4ade80]">
                <Lock className="w-2.5 h-2.5" />
                Salvo localmente (AES-256)
              </span>
            </>
          ) : (
            <>
              <span className="relative shrink-0">
                <Hash className="w-5 h-5 text-[#80848e]" />
                {channel?.isPrivate && (
                  <Lock className="w-2.5 h-2.5 text-[#f0b232] absolute -bottom-0.5 -right-0.5 bg-[#313338] rounded-full" />
                )}
              </span>
              <h2 className="font-bold text-white text-base truncate">{channel?.name}</h2>
              {channel?.topic && (
                <>
                  <span className="text-[#4e5058] hidden sm:inline">|</span>
                  <span className="text-xs text-[#949ba4] truncate hidden sm:inline">{channel.topic}</span>
                </>
              )}
              {Boolean(channel?.slowModeSec && channel.slowModeSec > 0) && (
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full bg-[#f0b232]/15 text-[#f0b232] text-[10px] font-bold shrink-0">
                  Modo lento {channel?.slowModeSec}s
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 relative">
          {onOpenTrello && (isPrivateScope || permissions?.useTrello !== false) && (
            <button
              type="button"
              onClick={onOpenTrello}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#2b2d31] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white text-xs font-semibold transition cursor-pointer"
              title="Abrir quadros do Trello"
            >
              <KanbanSquare className="w-3.5 h-3.5 text-[#60a5fa]" />
              <span className="hidden sm:inline">Trello</span>
            </button>
          )}
          {onPinMessage && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPinsPopover((v) => !v)}
                className={`relative p-1.5 rounded-md transition cursor-pointer ${
                  showPinsPopover ? 'text-white bg-[#404249]' : 'text-[#b5bac1] hover:text-white hover:bg-[#383a40]'
                }`}
                title="Mensagens Fixadas"
              >
                <Pin className="w-4 h-4" />
                {pinnedMessages.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#f0b232] text-[#111214] text-[9px] font-bold flex items-center justify-center">
                    {pinnedMessages.length}
                  </span>
                )}
              </button>

              {showPinsPopover && (
                <div className="absolute right-0 top-10 w-80 sm:w-96 max-h-96 bg-[#2b2d31] border border-white/15 rounded-lg shadow-2xl z-40 flex flex-col overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between bg-[#0d0f14]">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Pin className="w-3.5 h-3.5 text-[#f0b232]" />
                      Mensagens Fixadas ({pinnedMessages.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPinsPopover(false)}
                      className="text-[#949ba4] hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="overflow-y-auto p-2.5 space-y-2">
                    {pinnedMessages.length === 0 ? (
                      <div className="py-6 text-center text-xs text-[#949ba4]">
                        Nenhuma mensagem fixada aqui ainda. Passe o mouse sobre uma mensagem e clique no ícone 📌.
                      </div>
                    ) : (
                      pinnedMessages.map((pm) => (
                        <div
                          key={pm.id}
                          className="bg-[#313338] border border-white/10 rounded-lg p-2.5 space-y-1.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-white truncate">{pm.authorName}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setVisibleLimit((prev) => Math.max(prev, messages.length));
                                  setShowPinsPopover(false);
                                  setHighlightedMsgId(pm.id);
                                  window.setTimeout(() => {
                                    document
                                      .getElementById(`msg-${pm.id}`)
                                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  }, 40);
                                  window.setTimeout(() => setHighlightedMsgId(null), 2200);
                                }}
                                className="px-2 py-0.5 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-[10px] font-bold cursor-pointer"
                              >
                                Ir
                              </button>
                              {canPin && (
                                <button
                                  type="button"
                                  onClick={() => onPinMessage(pm.id, false)}
                                  className="p-0.5 rounded text-[#949ba4] hover:text-[#f23f42] cursor-pointer"
                                  title="Desafixar"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="text-[#dbdee1] line-clamp-3 break-words">
                            {pm.content || (pm.attachments?.length ? '[Anexo / Áudio]' : pm.gifUrl ? '[GIF]' : '[Mensagem]')}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {isGroup && dmGroup && (
            <>
              {onStartGroupCall && (
                <button
                  type="button"
                  onClick={() => onStartGroupCall(dmGroup)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#23a55a] hover:bg-[#1e8e4c] text-white text-xs font-bold transition cursor-pointer"
                  title="Iniciar chamada de voz e vídeo no grupo"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Ligar no Grupo
                </button>
              )}
              {onOpenGroupSettings && (
                <button
                  type="button"
                  onClick={() => onOpenGroupSettings(dmGroup)}
                  className="p-1.5 rounded-md bg-[#2b2d31] hover:bg-[#383a40] text-[#b5bac1] hover:text-white transition cursor-pointer"
                  title="Configurações e imagem do grupo"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
            </>
          )}
          {isDm && dmPeer && onCreateGroupFromDm && (
            <button
              type="button"
              onClick={() => onCreateGroupFromDm(dmPeer)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#2b2d31] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white text-xs font-semibold transition cursor-pointer"
              title="Adicionar amigos e transformar em Grupo Privado"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Criar Grupo</span>
            </button>
          )}
          {isDm && dmPeer && onStartPrivateCall && (
            <button
              type="button"
              onClick={() => onStartPrivateCall(dmPeer)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#23a55a] hover:bg-[#1e8e4c] text-white text-xs font-bold transition cursor-pointer"
              title="Iniciar chamada privada de voz/vídeo"
            >
              <Phone className="w-3.5 h-3.5" />
              Ligar
            </button>
          )}
          {activeVoiceLabel && (
            <button
              type="button"
              onClick={onReturnToVoice}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#23a55a]/20 hover:bg-[#23a55a]/30 border border-[#23a55a]/40 text-[#4ade80] text-xs font-semibold transition cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Voltar à Chamada ({activeVoiceLabel})
            </button>
          )}
          {!isPrivateScope && (
            <button
              type="button"
              onClick={onToggleMembers}
              className={`p-1.5 rounded-md transition cursor-pointer ${
                showMembers ? 'text-white bg-[#404249]' : 'text-[#b5bac1] hover:text-white hover:bg-[#383a40]'
              }`}
              title="Mostrar/ocultar membros"
            >
              <Users className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* NSFW Channel Gate */}
      {!isPrivateScope && channel?.visibility === 'nsfw' && !acceptedNsfwIds.has(channel.id) ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[#232428]">
          <div className="max-w-md w-full rounded-lg bg-[#313338] border border-[#da373c]/40 p-6 space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-[#da373c]/20 text-[#f23f42] flex items-center justify-center mx-auto font-bold text-lg">
              +18
            </div>
            <h3 className="text-lg font-bold text-white">Canal com Conteúdo Restrito (NSFW)</h3>
            <p className="text-xs text-[#b5bac1] leading-relaxed">
              O canal <strong>#{channel.name}</strong> foi marcado com restrição de idade/NSFW pela moderação. Deseja continuar mesmo assim?
            </p>
            <button
              type="button"
              onClick={() => setAcceptedNsfwIds((prev) => new Set(prev).add(channel.id))}
              className="w-full py-2.5 rounded-lg bg-[#da373c] hover:bg-[#b92d31] text-white text-xs font-bold cursor-pointer"
            >
              Continuar para #{channel.name}
            </button>
          </div>
        </div>
      ) : (
        <>
      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        <div className="pb-4 mb-3 border-b border-[#3f4147]/60">
          {isGroup && dmGroup ? (
            <>
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#5865f2] to-[#eb459e] flex items-center justify-center text-white text-xl font-bold mb-2 overflow-hidden">
                {dmGroup.iconUrl ? (
                  <img
                    src={resolveMediaUrl(dmGroup.hostP2pUrl || serverUrl, dmGroup.iconUrl)}
                    alt={dmGroup.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Users className="w-8 h-8" />
                )}
              </div>
              <h3 className="text-2xl font-bold text-white">{dmGroup.name}</h3>
              <p className="text-sm text-[#b5bac1] mt-1">
                Grupo Privado com {dmGroup.memberIds.length} participantes. Vocês podem fazer chamadas em grupo e gerenciar projetos no Trello juntos!
              </p>
            </>
          ) : isDm && dmPeer ? (
            <>
              <Avatar
                name={dmPeer.displayName}
                avatarUrl={dmPeer.avatarUrl}
                color={dmPeer.avatarColor}
                decoration={dmPeer.avatarDecoration}
                serverUrl={serverUrl}
                size="lg"
                online={Boolean(dmPeer.online)}
                statusType={dmPeer.statusType}
                className="mb-2"
              />
              <h3 className="text-2xl font-bold text-white">{dmPeer.displayName}</h3>
              <p className="text-sm text-[#b5bac1] mt-1">
                Este é o início da sua conversa privada com <strong>@{dmPeer.username}</strong>. Suas mensagens também ficam salvas localmente com criptografia!
              </p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-[#41434a] flex items-center justify-center mb-2">
                <Hash className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white">Bem-vindo a #{channel?.name}!</h3>
              <p className="text-sm text-[#b5bac1] mt-1">
                {channel?.topic || `Este é o início do canal #${channel?.name}.`}
              </p>
            </>
          )}
        </div>

        {hiddenCount > 0 && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + 80)}
              className="px-3.5 py-1.5 rounded-full bg-[#383a40] hover:bg-[#5865f2] text-xs font-bold text-[#dbdee1] hover:text-white transition cursor-pointer"
            >
              Carregar mensagens anteriores (+{Math.min(80, hiddenCount)} de {hiddenCount})
            </button>
          </div>
        )}

        {visibleMessages.map((msg, i) => {
          if (blockedUserIds.has(msg.authorId)) {
            return (
              <div key={msg.id} className="px-3 py-1 text-[11px] text-[#80848e] italic">
                Mensagem oculta de usuário bloqueado ({msg.authorName})
              </div>
            );
          }

          const prev = visibleMessages[i - 1];
          const compact =
            prev &&
            prev.authorId === msg.authorId &&
            !msg.replyTo &&
            !msg.pinned &&
            msg.createdAt - prev.createdAt < 5 * 60 * 1000;
          const canDelete = !isPrivateScope && Boolean(onDeleteMessage) && (msg.authorId === user.id || canManageMessages);
          const isDirectImg = DIRECT_IMAGE_URL_REGEX.test(msg.content.trim());
          const authorObj = resolveAuthor(msg);
          const isHighlighted = highlightedMsgId === msg.id;

          return (
            <div
              id={`msg-${msg.id}`}
              key={msg.id}
              className={`group relative flex gap-3.5 px-2.5 py-1 rounded-md pc-message transition ${
                isHighlighted
                  ? 'bg-[#f0b232]/20 ring-1 ring-[#f0b232]/60'
                  : msg.pinned
                  ? 'bg-[#f0b232]/[0.04] hover:bg-[#f0b232]/[0.07]'
                  : 'hover:bg-white/[0.03]'
              } ${compact ? '' : 'mt-3 pt-1.5'}`}
            >
              {compact ? (
                <div className="w-10 shrink-0 text-[10px] text-transparent group-hover:text-[#949ba4] text-right pr-1 pt-0.5 select-none">
                  {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              ) : (
                <div
                  onClick={(e) => msg.authorId !== 'system' && onUserClick(authorObj, e)}
                  onContextMenu={(e) => {
                    if (msg.authorId === 'system') return;
                    e.preventDefault();
                    onUserContextMenu(authorObj, e);
                  }}
                  className={msg.authorId !== 'system' ? 'cursor-pointer' : ''}
                >
                  <Avatar
                    name={authorObj.displayName}
                    avatarUrl={authorObj.avatarUrl}
                    color={authorObj.avatarColor}
                    decoration={authorObj.avatarDecoration}
                    serverUrl={serverUrl}
                    size="md"
                    className="mt-0.5"
                  />
                </div>
              )}

              <div className="flex-1 min-w-0">
                {msg.replyTo && (
                  <div className="flex items-center gap-1.5 text-xs text-[#949ba4] mb-1 pl-2 border-l-2 border-[#5865f2]">
                    <Reply className="w-3 h-3 text-[#5865f2]" />
                    <span className="font-semibold text-[#dbdee1]">{msg.replyTo.authorName}</span>
                    <span className="truncate opacity-80">{msg.replyTo.snippet}</span>
                  </div>
                )}

                {!compact && (
                  <div className="flex items-baseline gap-2">
                    <button
                      type="button"
                      onClick={(e) => msg.authorId !== 'system' && onUserClick(authorObj, e)}
                      onContextMenu={(e) => {
                        if (msg.authorId === 'system') return;
                        e.preventDefault();
                        onUserContextMenu(authorObj, e);
                      }}
                      className="font-semibold text-sm text-white hover:underline cursor-pointer"
                    >
                      {authorObj.displayName}
                    </button>
                    <span className="text-[11px] text-[#949ba4]">{formatTime(msg.createdAt)}</span>
                  </div>
                )}

                {msg.content && (
                  <div className="text-sm text-[#dbdee1] leading-relaxed">
                    {parseMessageSegments(msg.content).map((seg, segIdx) => {
                      if (seg.type === 'code') {
                        return (
                          <CodeBlock
                            key={segIdx}
                            language={seg.language}
                            code={seg.code}
                            autoDetected={seg.autoDetected}
                          />
                        );
                      }
                      const parts = seg.content.split(/(https?:\/\/[^\s<>"']+)/gi);
                      return (
                        <div key={segIdx} className="whitespace-pre-wrap break-words">
                          {parts.map((part, pi) =>
                            /^https?:\/\//i.test(part) ? (
                              <a
                                key={pi}
                                href={part}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#00a8fc] hover:underline break-all"
                              >
                                {part}
                              </a>
                            ) : (
                              <React.Fragment key={pi}>{part}</React.Fragment>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {!isDirectImg &&
                  extractEmbeddableMediaUrls(msg.content).map((mediaUrl) => (
                    <LinkEmbedCard
                      key={mediaUrl}
                      url={mediaUrl}
                      api={api}
                      serverUrl={serverUrl}
                      inVoiceCall={Boolean(activeVoiceLabel)}
                      onSendToVoiceVideo={onSendVideoUrlToVoice}
                      onSendToVoiceMusic={onSendMusicUrlToVoice}
                    />
                  ))}

                {isDirectImg && (
                  <div className="mt-2">
                    <img
                      src={msg.content.trim()}
                      alt="Mídia"
                      onClick={() => setLightboxUrl(msg.content.trim())}
                      className="max-h-80 max-w-full rounded-lg cursor-zoom-in border border-[#1e1f22] bg-[#1e1f22]"
                    />
                  </div>
                )}

                {msg.gifUrl && (
                  <div className="mt-2 inline-block relative">
                    <img
                      src={resolveMediaUrl(serverUrl, msg.gifUrl)}
                      alt="GIF"
                      onClick={() => setLightboxUrl(resolveMediaUrl(serverUrl, msg.gifUrl))}
                      className="max-h-72 max-w-full rounded-lg cursor-zoom-in border border-[#1e1f22] bg-[#1e1f22]"
                    />
                    <span className="absolute top-2 left-2 text-[10px] font-bold bg-black/70 text-white px-1.5 py-0.5 rounded">
                      GIF
                    </span>
                  </div>
                )}

                {/* Heavy File Transfer Card (up to 1.85 GB + Reusable vs One-Time Burn!) */}
                {msg.transfer && (
                  <div className="mt-2 max-w-md bg-[#2b2d31] border border-[#3f4147] rounded-lg p-3.5 space-y-2.5 shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            msg.transfer.burned || msg.transfer.expiredByCache
                              ? 'bg-[#383a40] text-[#80848e]'
                              : msg.transfer.oneTime
                              ? 'bg-[#f97316]/20 text-[#f97316]'
                              : 'bg-[#5865f2]/20 text-[#5865f2]'
                          }`}
                        >
                          {msg.transfer.oneTime ? <Flame className="w-5 h-5" /> : <HardDrive className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white truncate">{msg.transfer.originalName}</div>
                          <div className="text-[11px] text-[#949ba4] flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[#dbdee1]">{formatBytes(msg.transfer.size)}</span>
                            <span>•</span>
                            {msg.transfer.oneTime ? (
                              <span className="text-[#f97316] font-bold">Download Único 🔥</span>
                            ) : (
                              <span>Disponível ({msg.transfer.downloadedCount || 0} downloads)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {msg.transfer.burned ? (
                      <div className="text-xs bg-[#1e1f22] text-[#f97316] px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 shrink-0" />
                        Arquivo já baixado e apagado automaticamente (download único).
                      </div>
                    ) : msg.transfer.expiredByCache ? (
                      <div className="text-xs bg-[#1e1f22] text-[#949ba4] px-3 py-2 rounded-lg">
                        Arquivo removido automaticamente para manter o cache abaixo de 2 GB.
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <a
                          href={resolveMediaUrl(serverUrl, msg.transfer.downloadUrl)}
                          download={msg.transfer.originalName}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2 transition ${
                            msg.transfer.oneTime
                              ? 'bg-[#f97316] hover:bg-[#ea580c]'
                              : 'bg-[#5865f2] hover:bg-[#4752c4]'
                          }`}
                        >
                          <Download className="w-4 h-4" />
                          {msg.transfer.oneTime ? 'Baixar Agora (Download Único)' : 'Baixar Arquivo (LAN Rápido)'}
                        </a>
                        {is3DModelFilename(msg.transfer.originalName) && onOpen3DModel && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpen3DModel({
                                name: msg.transfer!.originalName,
                                url: msg.transfer!.downloadUrl,
                                ext: getFileExtension(msg.transfer!.originalName),
                              })
                            }
                            className="py-2 px-3 rounded-lg text-xs font-bold bg-[#ea7600] hover:bg-[#d96b00] text-white flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                          >
                            <Box className="w-4 h-4" />
                            Abrir 3D
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Standard Attachments */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {msg.attachments.map((att) => {
                      if (att.prunedByCache) {
                        return (
                          <div
                            key={att.id}
                            className="bg-[#2b2d31] border border-[#3f4147] rounded-lg px-3 py-2 text-xs text-[#949ba4]"
                          >
                            🗑️ <strong>{att.name}</strong> removido pelo limite automático de cache (2 GB)
                          </div>
                        );
                      }
                      const url = resolveMediaUrl(serverUrl, att.url);
                      if (att.kind === 'image' || att.kind === 'gif') {
                        return (
                          <div key={att.id} className="relative">
                            <img
                              src={url}
                              alt={att.name}
                              loading="lazy"
                              decoding="async"
                              onClick={() => setLightboxUrl(url)}
                              className="max-h-80 max-w-md rounded-lg cursor-zoom-in border border-[#1e1f22] bg-[#1e1f22] object-contain"
                            />
                            {att.kind === 'gif' && (
                              <span className="absolute top-2 left-2 text-[10px] font-bold bg-black/70 text-white px-1.5 py-0.5 rounded">
                                GIF
                              </span>
                            )}
                          </div>
                        );
                      }
                      if (att.kind === 'video') {
                        return (
                          <video
                            key={att.id}
                            src={url}
                            controls
                            className="max-h-80 max-w-md rounded-lg border border-[#1e1f22] bg-black"
                          />
                        );
                      }
                      if (att.kind === 'audio' || att.isVoiceMessage) {
                        return (
                          <VoiceMessagePlayer
                            key={att.id}
                            src={url}
                            name={att.name}
                            durationSec={att.durationSec}
                            waveform={att.waveform}
                            isOwn={msg.authorId === user.id}
                          />
                        );
                      }
                      if (is3DModelFilename(att.name) && onOpen3DModel) {
                        const companions = msg
                          .attachments!.filter((o) => o.id !== att.id && isTextureLikeName(o.name))
                          .map((o) => ({ name: o.name, url: o.url }));
                        const t3d = { name: att.name, url: att.url, ext: getFileExtension(att.name), companions };
                        return (
                          <React.Suspense
                            key={att.id}
                            fallback={<div className="w-[400px] max-w-full aspect-video rounded-lg bg-[#2b2d31]" />}
                          >
                            <Model3DInlinePreview
                              target={t3d}
                              size={att.size}
                              api={api}
                              serverUrl={serverUrl}
                              onExpand={(t) => onOpen3DModel(t)}
                            />
                          </React.Suspense>
                        );
                      }
                      return (
                        <a
                          key={att.id}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2.5 bg-[#2b2d31] hover:bg-[#1e2330] border border-white/10 rounded-lg px-3 py-2 text-xs text-[#00a8fc] transition"
                        >
                          <FileText className="w-5 h-5 text-[#949ba4]" />
                          <div>
                            <div className="font-semibold">{att.name}</div>
                            <div className="text-[10px] text-[#949ba4]">{formatBytes(att.size)}</div>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Hover actions */}
              <div className="opacity-0 group-hover:opacity-100 absolute right-3 -top-2.5 bg-[#2b2d31] border border-[#1e1f22] rounded-md shadow-lg flex items-center p-0.5 transition">
                {msg.pinned && (
                  <span className="px-1.5 text-[10px] font-bold text-[#f0b232]" title={`Fixada por ${msg.pinnedBy || 'alguém'}`}>
                    Fixada
                  </span>
                )}
                {onPinMessage && canPin && (
                  <button
                    type="button"
                    onClick={() => onPinMessage(msg.id, !msg.pinned)}
                    className={`p-1.5 rounded cursor-pointer hover:bg-[#383a40] ${
                      msg.pinned ? 'text-[#f0b232]' : 'text-[#b5bac1] hover:text-white'
                    }`}
                    title={msg.pinned ? 'Desafixar mensagem' : 'Fixar mensagem'}
                  >
                    <Pin className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setReplyTo(msg)}
                  className="p-1.5 text-[#b5bac1] hover:text-white hover:bg-[#383a40] rounded cursor-pointer"
                  title="Responder"
                >
                  <Reply className="w-3.5 h-3.5" />
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onDeleteMessage?.(msg.id)}
                    className="p-1.5 text-[#b5bac1] hover:text-[#f23f42] hover:bg-[#383a40] rounded cursor-pointer"
                    title="Excluir mensagem"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing Indicator */}
      <div className="h-5 px-5 text-xs text-[#949ba4] flex items-center">
        {typingUsers.length > 0 && (
          <span className="animate-pulse">
            <strong>{typingUsers.join(', ')}</strong> {typingUsers.length === 1 ? 'está' : 'estão'} digitando...
          </span>
        )}
      </div>

      {/* Composer */}
      <div className="px-4 pb-4 relative">
        {uploadError && (
          <div className="mb-2 flex items-center justify-between text-xs bg-[#f23f42]/15 border border-[#f23f42]/40 text-[#ff8b8d] px-3 py-1.5 rounded-lg">
            <span>{uploadError}</span>
            <button type="button" onClick={() => setUploadError('')} className="cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {replyTo && (
          <div className="bg-[#2b2d31] rounded-t-lg px-3 py-1.5 border-b border-[#3f4147] flex items-center justify-between text-xs text-[#b5bac1]">
            <span>
              Respondendo a <strong className="text-white">{replyTo.authorName}</strong>
            </span>
            <button type="button" onClick={() => setReplyTo(null)} className="hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {pendingAttachments.length > 0 && (
          <div className="bg-[#2b2d31] border-b border-[#3f4147] px-3 py-2 flex flex-wrap gap-2 first:rounded-t-lg">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="relative bg-[#1e1f22] rounded-lg p-1.5 border border-[#3f4147] flex items-center gap-2"
              >
                {att.kind === 'image' || att.kind === 'gif' ? (
                  <img src={resolveMediaUrl(serverUrl, att.url)} alt={att.name} className="w-16 h-16 object-cover rounded" />
                ) : (
                  <div className="w-16 h-16 flex flex-col items-center justify-center text-[#949ba4] text-[10px] text-center px-1">
                    <FileText className="w-5 h-5 mb-1" />
                    <span className="truncate w-full">{att.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#f23f42] text-white flex items-center justify-center shadow cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* GIF Picker */}
        {showGifPicker && (
          <div className="absolute bottom-18 right-4 z-30 w-96 max-w-[calc(100vw-2rem)] bg-[#2b2d31] border border-[#1e1f22] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[460px]">
            <div className="p-3 border-b border-[#1e1f22] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Film className="w-4 h-4 text-[#5865f2]" />
                  GIFs do Chat
                </span>
                <button type="button" onClick={() => setShowGifPicker(false)} className="text-[#949ba4] hover:text-white cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-1 bg-[#1e1f22] p-1 rounded-lg text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setGifTab('server')}
                  className={`flex-1 py-1 rounded-md cursor-pointer ${gifTab === 'server' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4]'}`}
                >
                  Galeria ({savedGifs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setGifTab('search')}
                  className={`flex-1 py-1 rounded-md cursor-pointer ${gifTab === 'search' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4]'}`}
                >
                  Buscar Web
                </button>
                <button
                  type="button"
                  onClick={() => setGifTab('add')}
                  className={`flex-1 py-1 rounded-md cursor-pointer ${gifTab === 'add' ? 'bg-[#23a55a] text-white' : 'text-[#949ba4]'}`}
                >
                  + Subir / Link
                </button>
              </div>

              {gifTab !== 'add' && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#949ba4] absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={gifQuery}
                    onChange={(e) => setGifQuery(e.target.value)}
                    placeholder="Buscar GIFs..."
                    className="w-full bg-[#1e1f22] text-xs text-white rounded-lg pl-8 pr-3 py-2 outline-none border border-[#3f4147]"
                  />
                </div>
              )}
            </div>

            <div className="p-3 overflow-y-auto flex-1">
              {gifTab === 'server' &&
                (filteredSavedGifs.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <Sparkles className="w-8 h-8 text-[#5865f2] mx-auto opacity-80" />
                    <p className="text-xs text-[#b5bac1]">Nenhum GIF salvo na galeria ainda!</p>
                    <button
                      type="button"
                      onClick={() => setGifTab('add')}
                      className="px-3 py-1.5 bg-[#5865f2] text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Enviar primeiro GIF
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {filteredSavedGifs.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleSendGif(g.url)}
                        className="relative rounded-lg overflow-hidden bg-[#1e1f22] aspect-video cursor-pointer border border-transparent hover:border-[#5865f2]"
                      >
                        <img src={resolveMediaUrl(serverUrl, g.previewUrl || g.url)} alt={g.title} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                ))}

              {gifTab === 'search' &&
                (gifLoading ? (
                  <div className="py-10 flex justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-[#5865f2]" />
                  </div>
                ) : gifSearchResults.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {gifSearchResults.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleSendGif(g.url)}
                        className="rounded-lg overflow-hidden bg-[#1e1f22] aspect-video cursor-pointer border border-transparent hover:border-[#5865f2]"
                      >
                        <img src={g.previewUrl || g.url} alt={g.title} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs text-[#b5bac1]">
                    {gifProvider === 'local'
                      ? 'Configure uma chave grátis Tenor/Giphy em Configurações → Servidor, ou use a aba + Subir / Link!'
                      : 'Nenhum GIF encontrado.'}
                  </div>
                ))}

              {gifTab === 'add' && (
                <form onSubmit={handleSaveNewGif} className="space-y-3 text-xs">
                  <input
                    type="text"
                    value={newGifTitle}
                    onChange={(e) => setNewGifTitle(e.target.value)}
                    placeholder="Nome do GIF"
                    className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-2.5 py-2 text-white outline-none"
                  />
                  <input
                    type="url"
                    value={newGifUrl}
                    onChange={(e) => setNewGifUrl(e.target.value)}
                    placeholder="Link .gif (ou suba abaixo)"
                    className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-2.5 py-2 text-white outline-none"
                  />
                  <label className="flex items-center justify-center gap-2 border border-dashed border-[#4e5058] rounded-lg p-3 cursor-pointer text-[#dbdee1]">
                    <ImageIcon className="w-4 h-4 text-[#5865f2]" />
                    <span>{newGifFile ? newGifFile.name : 'Escolher arquivo .gif'}</span>
                    <input
                      type="file"
                      accept="image/gif,image/webp"
                      className="hidden"
                      onChange={(e) => setNewGifFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <input
                    type="text"
                    value={newGifTags}
                    onChange={(e) => setNewGifTags(e.target.value)}
                    placeholder="Tags (opcional)"
                    className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-2.5 py-2 text-white outline-none"
                  />
                  <button
                    type="submit"
                    disabled={savingGif || (!newGifFile && !newGifUrl.trim())}
                    className="w-full py-2 bg-[#23a55a] text-white font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {savingGif ? 'Salvando...' : 'Salvar e Enviar GIF'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Emoji Picker */}
        {showEmojiPicker && (
          <div className="absolute bottom-18 right-12 z-30 w-72 bg-[#2b2d31] border border-[#1e1f22] rounded-lg shadow-2xl p-3">
            <div className="grid grid-cols-8 gap-1">
              {QUICK_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => {
                    setText((prev) => prev + em);
                    setShowEmojiPicker(false);
                  }}
                  className="text-xl p-1 hover:bg-[#383a40] rounded cursor-pointer"
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Auto Code Detection Pill (C#, C++, HLSL, GDScript, Python, etc.) */}
        {detectedCodeLang && (
          <div className="mb-1.5 bg-[#2b2d31] border border-[#5865f2]/45 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Code2 className="w-4 h-4 text-[#5865f2] shrink-0" />
              <span className="text-[#dbdee1] truncate">
                Código detectado: <strong>{formatLanguageLabel(detectedCodeLang)}</strong>
              </span>
              <select
                value={detectedCodeLang}
                onChange={(e) => setDetectedCodeLang(e.target.value)}
                className="bg-[#1e1f22] border border-white/15 rounded px-1.5 py-0.5 text-[11px] text-white outline-none"
              >
                <option value="csharp">C#</option>
                <option value="cpp">C++</option>
                <option value="hlsl">HLSL / Shader</option>
                <option value="glsl">GLSL</option>
                <option value="gdscript">GDScript</option>
                <option value="typescript">TypeScript</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="lua">Lua</option>
                <option value="json">JSON</option>
                <option value="css">CSS</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer shrink-0 text-[11px] text-[#dbdee1]">
              <input
                type="checkbox"
                checked={wrapAsCode}
                onChange={(e) => setWrapAsCode(e.target.checked)}
                className="accent-[#5865f2]"
              />
              Enviar como bloco de código
            </label>
          </div>
        )}

        {/* Input Box */}
        <form
          onSubmit={handleSend}
          className={`bg-[#2b2d31] pc-composer px-3 py-2 flex items-end gap-1.5 ${
            replyTo || pendingAttachments.length > 0 ? 'rounded-b-xl' : 'rounded-lg'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.gif,.pdf,.zip,.txt,.glb,.gltf,.obj,.fbx,.stl,.blend,.cs,.cpp,.h,.hlsl,.glsl,.shader,.py,.ts,.js,.json,.gd,.lua"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !canAttach}
            className="p-2 rounded-full text-[#b5bac1] hover:text-white hover:bg-[#4e5058] transition cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            title={!canAttach ? 'Seu cargo não pode enviar arquivos aqui' : 'Enviar imagem/GIF/modelo 3D (ou cole Ctrl+V)'}
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin text-[#5865f2]" /> : <Plus className="w-5 h-5" />}
          </button>

          {!isPureLanDm && (
            <button
              type="button"
              disabled={!canAttach}
              onClick={() => setShowTransferModal(true)}
              className="p-2 rounded-full text-[#4ade80] hover:text-white hover:bg-[#23a55a] transition cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title={!canAttach ? 'Cargo sem permissão para anexos' : 'Enviar arquivo pesado até 1.85 GB (Disponível ou Download Único 🔥)'}
            >
              <HardDrive className="w-4 h-4" />
            </button>
          )}

          {recordingVoice ? (
            <div className="flex-1 flex items-center justify-between gap-3 py-1 px-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f23f42] animate-ping shrink-0" />
                <span className="text-xs font-mono font-bold text-[#ff8b8d] shrink-0">
                  {Math.floor(recordSec / 60)}:{(recordSec % 60).toString().padStart(2, '0')}
                </span>
                <div className="flex items-center gap-0.5 h-6 flex-1 max-w-[220px] overflow-hidden">
                  {liveRecBars.map((val, idx) => (
                    <span
                      key={idx}
                      className="flex-1 rounded-full bg-gradient-to-t from-[#5865f2] to-[#22d3ee] transition-all duration-75"
                      style={{ height: `${Math.max(18, Math.round(val * 100))}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleCancelVoiceRecord}
                  className="p-1.5 rounded-lg bg-[#2b2d31] hover:bg-[#da373c] text-[#dbdee1] hover:text-white cursor-pointer"
                  title="Cancelar áudio"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleFinishAndSendVoiceRecord}
                  className="px-3 py-1.5 rounded-lg bg-[#23a55a] hover:bg-[#1e8e4c] text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow"
                  title="Enviar áudio no chat"
                >
                  <Send className="w-3.5 h-3.5" />
                  Enviar Áudio
                </button>
              </div>
            </div>
          ) : (
            <>
              <textarea
                ref={textAreaRef}
                rows={1}
                value={text}
                disabled={!canSend || slowModeLeftSec > 0}
                onChange={(e) => {
                  const val = e.target.value;
                  setText(val);
                  triggerTyping();
                  if (val.includes('```')) {
                    setDetectedCodeLang(null);
                  } else {
                    const lang = detectCodeLanguage(val);
                    setDetectedCodeLang(lang);
                  }
                }}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  !canSend
                    ? `Você não tem permissão para enviar mensagens em ${titleLabel}.`
                    : slowModeLeftSec > 0
                    ? `Modo lento ativo — aguarde ${slowModeLeftSec}s...`
                    : `Conversar em ${titleLabel} (Ctrl+V para prints/GIFs)...`
                }
                className="flex-1 bg-transparent text-sm text-white placeholder-[#949ba4] outline-none resize-none max-h-36 py-2 disabled:opacity-60"
              />

              <div className="flex items-center gap-1 shrink-0 pb-0.5">
                {!isPureLanDm && (
                  <button
                    type="button"
                    disabled={!canAttach}
                    onClick={() => {
                      setShowGifPicker((v) => !v);
                      setShowEmojiPicker(false);
                    }}
                    className={`px-2 py-1 rounded text-xs font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      showGifPicker
                        ? 'bg-[#5865f2] text-white border-[#5865f2]'
                        : 'border-[#949ba4]/50 text-[#b5bac1] hover:text-white hover:border-white'
                    }`}
                    title="GIFs"
                  >
                    GIF
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => {
                    setShowEmojiPicker((v) => !v);
                    setShowGifPicker(false);
                  }}
                  className="p-1.5 rounded-md text-[#b5bac1] hover:text-white hover:bg-[#4e5058] cursor-pointer disabled:opacity-40"
                  title="Emojis"
                >
                  <Smile className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={!canAttach}
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded-md text-[#b5bac1] hover:text-white hover:bg-[#4e5058] cursor-pointer hidden sm:inline-flex disabled:opacity-40"
                  title="Anexar mídia / áudio"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                {text.trim() || pendingAttachments.length > 0 ? (
                  <button
                    type="submit"
                    disabled={!canSend || slowModeLeftSec > 0}
                    className="p-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white cursor-pointer disabled:opacity-40"
                    title="Enviar"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canAttach}
                    onClick={handleStartVoiceRecord}
                    className="p-2 rounded-lg bg-[#383a40] hover:bg-[#f43f5e] text-[#dbdee1] hover:text-white cursor-pointer transition disabled:opacity-40"
                    title="Gravar mensagem de áudio"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                )}
              </div>
            </>
          )}
        </form>
      </div>
        </>
      )}

      {/* Heavy Transfer Modal (up to 1.85 GB + One-Time Burn!) */}
      {showTransferModal && api && (
        <FileTransferModal
          api={api}
          targetLabel={titleLabel}
          onClose={() => setShowTransferModal(false)}
          onUploaded={(transfer, caption) => {
            onSendMessage({
              content: caption,
              attachments: [],
              transfer,
            });
          }}
        />
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6 cursor-zoom-out"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxUrl}
            alt="Visualização"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[92vw] rounded-lg shadow-2xl object-contain cursor-default"
          />
        </div>
      )}
    </div>
  );
};
