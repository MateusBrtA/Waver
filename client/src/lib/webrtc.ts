import { Socket } from 'socket.io-client';
import {
  AudioSettings,
  RemoteInputEvent,
  RemotePeerMedia,
  ScreenShareConfig,
  StreamStats,
  StreamsMeta,
  VoiceParticipant,
} from '../types';
import { createProcessLoopbackAudioTrack, LoopbackBridgeHandle } from './loopbackAudio';
import { setSpeaking } from './speakingStore';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

interface PeerContext {
  socketId: string;
  pc: RTCPeerConnection;
  rcChannel: RTCDataChannel | null;
  rcFastChannel: RTCDataChannel | null;
  lastFastSeq: number;
  polite: boolean;
  awaitingInitialOffer: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  remoteMeta: StreamsMeta | null;
  micSender: RTCRtpSender | null;
  camSender: RTCRtpSender | null;
  screenVideoSender: RTCRtpSender | null;
  screenAudioSender: RTCRtpSender | null;
  media: RemotePeerMedia;
  prevInboundScreenBytes: number;
  prevInboundScreenTs: number;
  prevInboundCamBytes: number;
  prevInboundCamTs: number;
  vadCleanup?: () => void;
}

export interface WebRTCManagerCallbacks {
  onPeersUpdated: (peers: Record<string, RemotePeerMedia>) => void;
  onLocalStateUpdated: (state: {
    micStream: MediaStream | null;
    camStream: MediaStream | null;
    screenStream: MediaStream | null;
    localSpeaking: boolean;
    localMicLevel: number;
    localScreenStats: StreamStats | null;
    screenLabel: string;
  }) => void;
  onRemoteInputReceived?: (fromSocketId: string, event: RemoteInputEvent) => void;
  onMutedMicSpeaking?: () => void;
  onError: (msg: string) => void;
}

function getResolutionDimensions(res: ScreenShareConfig['resolution']): { width?: number; height?: number } {
  switch (res) {
    case '720p':
      return { width: 1280, height: 720 };
    case '1080p':
      return { width: 1920, height: 1080 };
    case '1440p':
      return { width: 2560, height: 1440 };
    case 'source':
    default:
      return { width: 3840, height: 2160 };
  }
}

function preferHighQualityVideoCodecs(pc: RTCPeerConnection, sender: RTCRtpSender) {
  try {
    const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
    if (!transceiver || typeof transceiver.setCodecPreferences !== 'function') return;
    const caps = RTCRtpReceiver.getCapabilities?.('video');
    if (!caps?.codecs?.length) return;

    const priority = (mime: string) => {
      const m = mime.toLowerCase();
      if (m.includes('h264')) return 1;
      if (m.includes('vp9')) return 2;
      if (m.includes('av1')) return 3;
      if (m.includes('vp8')) return 4;
      return 5;
    };

    const sorted = [...caps.codecs].sort((a, b) => priority(a.mimeType) - priority(b.mimeType));
    transceiver.setCodecPreferences(sorted);
  } catch {
    // ignore
  }
}

export class WebRTCManager {
  private socket: Socket | null = null;
  private selfSocketId = '';
  private activeChannelId: string | null = null;
  private settings: AudioSettings;
  private callbacks: WebRTCManagerCallbacks;

  private peers = new Map<string, PeerContext>();
  private pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
  private pendingRemoteMeta = new Map<string, StreamsMeta | null>();

  // Raw microphone stream + processed DSP stream (Input Volume, HighPass, VAD Gate / Push-to-Talk!)
  private rawMicStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private micDspCtx: AudioContext | null = null;
  private micInputGain: GainNode | null = null;
  private micGateGain: GainNode | null = null;
  private micHighPass: BiquadFilterNode | null = null;
  private micDspTimer: number | null = null;

  private camStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private loopbackBridge: LoopbackBridgeHandle | null = null;
  private screenConfig: ScreenShareConfig | null = null;
  private screenLabel = '';
  private adaptiveBitrateMbps = 14;

  private muted = false;
  private deafened = false;
  private serverMuted = false;
  private serverDeafened = false;
  private pttPressed = false;
  private localSpeaking = false;
  private localMicLevel = 0;
  private mutedTalkFrames = 0;
  private lastMutedWarnTs = 0;

  private statsTimer: number | null = null;
  private localScreenStats: StreamStats | null = null;
  private prevOutboundScreenBytes = 0;
  private prevOutboundScreenTs = 0;
  private prevPacketsLost = 0;
  private prevPacketsSent = 0;

  private sharedAudioCtx: AudioContext | null = null;

  constructor(settings: AudioSettings, callbacks: WebRTCManagerCallbacks) {
    this.settings = settings;
    this.callbacks = callbacks;
  }

  updateSettings(newSettings: AudioSettings) {
    const hardwareChanged =
      newSettings.inputDeviceId !== this.settings.inputDeviceId ||
      newSettings.inputProfile !== this.settings.inputProfile ||
      newSettings.echoCancellation !== this.settings.echoCancellation ||
      newSettings.noiseSuppression !== this.settings.noiseSuppression ||
      newSettings.autoGainControl !== this.settings.autoGainControl;

    this.settings = newSettings;

    // Live DSP parameter updates (zero reconnect glitch!)
    if (this.micInputGain) {
      this.micInputGain.gain.value = Math.max(0, Math.min(2, newSettings.inputVolume ?? 1));
    }
    if (this.micHighPass) {
      this.micHighPass.frequency.value = newSettings.inputProfile === 'studio' ? 20 : 90;
    }

    if (hardwareChanged && this.activeChannelId) {
      this.acquireMicrophone().catch(() => {});
    }
  }

  setPttPressed(pressed: boolean) {
    if (this.pttPressed === pressed) return;
    this.pttPressed = pressed;
    if (this.settings.inputMode === 'ptt' && this.micGateGain && this.micDspCtx) {
      const target = pressed && !this.isEffectivelyMuted() ? 1 : 0;
      const tau = pressed ? 0.01 : 0.08; // smooth 80ms release tail so words don't clip
      this.micGateGain.gain.setTargetAtTime(target, this.micDspCtx.currentTime, tau);
      if (!pressed && this.localSpeaking) {
        this.localSpeaking = false;
        this.emitLocalState();
      }
    }
  }

  setServerModeration(serverMuted: boolean, serverDeafened: boolean) {
    this.serverMuted = serverMuted;
    this.serverDeafened = serverDeafened;
    this.applyMicEnabledState();
  }

  private isEffectivelyMuted(): boolean {
    return this.muted || this.deafened || this.serverMuted || this.serverDeafened;
  }

  private applyMicEnabledState() {
    const enabled = !this.isEffectivelyMuted();
    this.micStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
    if (!enabled) {
      this.localSpeaking = false;
      this.localMicLevel = 0;
    }
    this.emitLocalState();
  }

  attachSocket(socket: Socket) {
    this.detachSocket();
    this.socket = socket;

    socket.on('voice:peer-joined', this.handlePeerJoined);
    socket.on('voice:peer-left', this.handlePeerLeft);
    socket.on('rtc:description', this.handleRtcDescription);
    socket.on('rtc:ice-candidate', this.handleRtcIceCandidate);
    socket.on('rtc:streams-meta', this.handleStreamsMeta);
    socket.on('rc:input', this.handleSocketRcInput);
  }

  detachSocket() {
    if (!this.socket) return;
    this.socket.off('voice:peer-joined', this.handlePeerJoined);
    this.socket.off('voice:peer-left', this.handlePeerLeft);
    this.socket.off('rtc:description', this.handleRtcDescription);
    this.socket.off('rtc:ice-candidate', this.handleRtcIceCandidate);
    this.socket.off('rtc:streams-meta', this.handleStreamsMeta);
    this.socket.off('rc:input', this.handleSocketRcInput);
    this.socket = null;
  }

  private handleSocketRcInput = ({ fromSocketId, event }: { fromSocketId: string; event: RemoteInputEvent }) => {
    this.callbacks.onRemoteInputReceived?.(fromSocketId, event);
  };

  private rcFastSeq = 0;

  /**
   * Sends Parsec / AnyDesk remote mouse, keyboard, and gamepad input directly over P2P WebRTC DataChannels (~1ms on LAN!):
   * - Discrete button edges / rumble -> ordered channel id:42 (`rcChannel`)
   * - High-rate mouse move / relative aim / analog sticks -> unordered maxRetransmits:0 channel id:43 (`rcFastChannel`)
   */
  sendRemoteInput(targetSocketId: string, event: RemoteInputEvent) {
    const ctx = this.peers.get(targetSocketId);
    const isHighRate = event.type === 'mousemove' || event.type === 'mouserel' || event.type === 'gamepad';
    if (isHighRate) {
      const seq = this.fastSeqSafe();
      const packet: RemoteInputEvent = { ...event, seq };
      if (ctx?.rcFastChannel && ctx.rcFastChannel.readyState === 'open') {
        try {
          ctx.rcFastChannel.send(JSON.stringify(packet));
          return;
        } catch {
          // fallback below
        }
      }
      if (ctx?.rcChannel && ctx.rcChannel.readyState === 'open') {
        try {
          ctx.rcChannel.send(JSON.stringify(packet));
          return;
        } catch {}
      }
      this.socket?.emit('rc:input', { targetSocketId, event: packet });
      return;
    }

    if (ctx?.rcChannel && ctx.rcChannel.readyState === 'open') {
      try {
        ctx.rcChannel.send(JSON.stringify(event));
        return;
      } catch {
        // fall back to socket
      }
    }
    this.socket?.emit('rc:input', { targetSocketId, event });
  }

  private fastSeqSafe(): number {
    this.rcFastSeq = (this.rcFastSeq + 1) >>> 0;
    return this.rcFastSeq;
  }

  private getIceServers(): RTCIceServer[] {
    const servers = [...DEFAULT_ICE_SERVERS];
    if (this.settings.customTurnUrl?.trim()) {
      servers.push({
        urls: this.settings.customTurnUrl.trim(),
        username: this.settings.customTurnUser?.trim() || undefined,
        credential: this.settings.customTurnCred?.trim() || undefined,
      });
    }
    return servers;
  }

  private buildLocalMeta(): StreamsMeta {
    return {
      micStreamId: this.micStream?.id || null,
      micAudioTrackId: this.micStream?.getAudioTracks()[0]?.id || null,
      camStreamId: this.camStream?.id || null,
      camVideoTrackId: this.camStream?.getVideoTracks()[0]?.id || null,
      screenStreamId: this.screenStream?.id || null,
      screenVideoTrackId: this.screenStream?.getVideoTracks()[0]?.id || null,
      screenAudioTrackId: this.screenStream?.getAudioTracks()[0]?.id || null,
      screenLabel: this.screenLabel || undefined,
    };
  }

  private broadcastStreamsMeta(targetSocketId?: string) {
    if (!this.socket || !this.activeChannelId) return;
    this.socket.emit('rtc:streams-meta', {
      targetSocketId,
      meta: this.buildLocalMeta(),
    });
  }

  private emitLocalState() {
    setSpeaking(this.selfSocketId, this.localSpeaking && !this.isEffectivelyMuted());
    this.callbacks.onLocalStateUpdated({
      micStream: this.micStream,
      camStream: this.camStream,
      screenStream: this.screenStream,
      localSpeaking: this.localSpeaking && !this.isEffectivelyMuted(),
      localMicLevel: this.isEffectivelyMuted() ? 0 : this.localMicLevel,
      localScreenStats: this.localScreenStats,
      screenLabel: this.screenLabel,
    });
  }

  private emitPeersState() {
    const map: Record<string, RemotePeerMedia> = {};
    for (const [id, ctx] of this.peers.entries()) {
      map[id] = { ...ctx.media };
    }
    this.callbacks.onPeersUpdated(map);
  }

  // Um único timer analisa todos os participantes (antes: um setInterval por pessoa)
  private vadEntries = new Set<() => void>();
  private vadTimer: number | null = null;

  private ensureVadTimer() {
    if (this.vadTimer || this.vadEntries.size === 0) return;
    this.vadTimer = window.setInterval(() => {
      const ctx = this.sharedAudioCtx;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      this.vadEntries.forEach((tick) => tick());
    }, 100);
  }

  private stopVadTimerIfIdle() {
    if (this.vadEntries.size === 0 && this.vadTimer) {
      window.clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
  }

  private setupRemoteVad(stream: MediaStream, onSpeakingChange: (speaking: boolean) => void): () => void {
    try {
      if (!this.sharedAudioCtx || this.sharedAudioCtx.state === 'closed') {
        this.sharedAudioCtx = new AudioContext();
      }
      const ctx = this.sharedAudioCtx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      // Domínio do tempo (RMS) é mais barato que FFT e mais fiel para detectar voz
      const data = new Uint8Array(analyser.fftSize);
      let speaking = false;
      let silenceFrames = 0;

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 2) {
          const v = data[i] - 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / (data.length / 2));
        const active = rms > 3.2;
        if (active) {
          silenceFrames = 0;
          if (!speaking) {
            speaking = true;
            onSpeakingChange(true);
          }
        } else if (speaking) {
          silenceFrames++;
          if (silenceFrames > 3) {
            speaking = false;
            onSpeakingChange(false);
          }
        }
      };
      this.vadEntries.add(tick);
      this.ensureVadTimer();

      return () => {
        this.vadEntries.delete(tick);
        this.stopVadTimerIfIdle();
        if (speaking) onSpeakingChange(false);
        try {
          source.disconnect();
          analyser.disconnect();
        } catch {}
      };
    } catch {
      return () => {};
    }
  }

  private cleanupMicDsp() {
    if (this.micDspTimer) {
      window.clearInterval(this.micDspTimer);
      this.micDspTimer = null;
    }
    if (this.micDspCtx) {
      this.micDspCtx.close().catch(() => {});
      this.micDspCtx = null;
    }
    this.micInputGain = null;
    this.micGateGain = null;
    this.micHighPass = null;
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    this.rawMicStream = null;
  }

  /**
   * Captures microphone with Discord-like profiles (Voice Isolation / Studio / Custom),
   * live Input Gain (0-200%), Auto/Manual Voice Detection Gate, and Push-to-Talk!
   */
  async acquireMicrophone(): Promise<MediaStream | null> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onError(
        'Microfone bloqueado pelo navegador em HTTP. Use o app Desktop PulseCord (.exe) para falar por voz em LAN!'
      );
      return null;
    }

    const isStudio = this.settings.inputProfile === 'studio';
    const ec = isStudio ? false : this.settings.echoCancellation;
    const ns = isStudio ? false : this.settings.noiseSuppression;
    const agc = isStudio ? false : this.settings.autoGainControl;

    const attempts: MediaStreamConstraints[] = [];
    if (this.settings.inputDeviceId) {
      attempts.push({
        audio: {
          deviceId: { ideal: this.settings.inputDeviceId },
          echoCancellation: ec,
          noiseSuppression: ns,
          autoGainControl: agc,
        },
        video: false,
      });
    }
    attempts.push({
      audio: { echoCancellation: ec, noiseSuppression: ns, autoGainControl: agc },
      video: false,
    });
    attempts.push({ audio: true, video: false });

    let rawStream: MediaStream | null = null;
    let lastError: unknown = null;
    for (const constraints of attempts) {
      try {
        rawStream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!rawStream) {
      console.warn('[WebRTC] Microfone indisponível, entrando em modo ouvinte:', lastError);
      this.callbacks.onError(
        'Não foi possível acessar o microfone (verifique permissões do Windows). Você entrou apenas como ouvinte.'
      );
      return null;
    }

    this.cleanupMicDsp();
    this.rawMicStream = rawStream;

    // Build Web Audio DSP pipeline: RawMic -> HighPass -> InputGain -> GateGain -> Destination
    let outboundStream: MediaStream = rawStream;
    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(rawStream);
      const highPass = ctx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = isStudio ? 20 : 90;

      const inputGain = ctx.createGain();
      inputGain.gain.value = Math.max(0, Math.min(2, this.settings.inputVolume ?? 1));

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.45;

      const gateGain = ctx.createGain();
      gateGain.gain.value = this.settings.inputMode === 'ptt' ? (this.pttPressed ? 1 : 0) : 1;

      const dest = ctx.createMediaStreamDestination();

      src.connect(highPass);
      highPass.connect(inputGain);
      inputGain.connect(analyser);
      inputGain.connect(gateGain);
      gateGain.connect(dest);

      this.micDspCtx = ctx;
      this.micHighPass = highPass;
      this.micInputGain = inputGain;
      this.micGateGain = gateGain;
      outboundStream = dest.stream;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let silenceHold = 0;

      this.micDspTimer = window.setInterval(() => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const level = Math.min(100, Math.round((sum / data.length) * 2.1));

        const mutedNow = this.isEffectivelyMuted();
        let shouldTransmit = false;

        // Detect speaking continuously while user self-muted mic (Discord warning!)
        if (this.muted && !this.deafened && !this.serverMuted) {
          if (level >= 22) {
            this.mutedTalkFrames += 1;
            if (this.mutedTalkFrames >= 18 && Date.now() - this.lastMutedWarnTs > 12000) {
              this.lastMutedWarnTs = Date.now();
              this.mutedTalkFrames = 0;
              this.callbacks.onMutedMicSpeaking?.();
            }
          } else {
            this.mutedTalkFrames = Math.max(0, this.mutedTalkFrames - 2);
          }
        } else {
          this.mutedTalkFrames = 0;
        }

        if (mutedNow) {
          shouldTransmit = false;
        } else if (this.settings.inputMode === 'ptt') {
          shouldTransmit = this.pttPressed;
        } else if (this.settings.vadAuto) {
          // Auto VAD: always transmit smoothly, ring lights up when speaking > 10
          shouldTransmit = true;
        } else {
          // Manual VAD Gate threshold (0-100) with smooth 280ms hold tail
          const thresh = Math.max(4, this.settings.vadThreshold || 18);
          if (level >= thresh) {
            silenceHold = 4;
            shouldTransmit = true;
          } else if (silenceHold > 0) {
            silenceHold -= 1;
            shouldTransmit = true;
          } else {
            shouldTransmit = false;
          }
        }

        const gateTarget = shouldTransmit ? 1 : 0;
        gateGain.gain.setTargetAtTime(gateTarget, ctx.currentTime, gateTarget === 1 ? 0.01 : 0.06);

        const speakingNow = !mutedNow && shouldTransmit && level > (this.settings.vadAuto ? 10 : Math.max(8, (this.settings.vadThreshold || 18) * 0.7));
        const levelChanged = Math.abs(level - this.localMicLevel) >= 4;
        if (speakingNow !== this.localSpeaking || levelChanged) {
          this.localSpeaking = speakingNow;
          this.localMicLevel = level;
          // Antes: emitLocalState() ~13x/s -> re-render do app inteiro enquanto você fala.
          setSpeaking(this.selfSocketId, speakingNow);
        }
      }, 75);
    } catch (err) {
      console.warn('[WebRTC] DSP fallback to raw mic stream:', err);
      outboundStream = rawStream;
    }

    const newTrack = outboundStream.getAudioTracks()[0];
    if (newTrack) {
      newTrack.enabled = !this.isEffectivelyMuted();
    }

    this.micStream = outboundStream;

    for (const ctx of this.peers.values()) {
      if (ctx.micSender && newTrack) {
        await ctx.micSender.replaceTrack(newTrack).catch(() => {});
      } else if (newTrack) {
        ctx.micSender = ctx.pc.addTrack(newTrack, outboundStream);
        this.applyAudioSenderParams(ctx.micSender, isStudio ? 160_000 : 128_000);
      }
    }
    this.broadcastStreamsMeta();
    this.emitLocalState();
    return outboundStream;
  }

  async prepareJoin(channelId: string, selfSocketId: string, initialMuted: boolean, initialDeafened: boolean) {
    this.leaveChannel(false);
    this.activeChannelId = channelId;
    this.selfSocketId = selfSocketId;
    this.muted = initialMuted;
    this.deafened = initialDeafened;
    await this.acquireMicrophone();
  }

  async completeJoin(channelId: string, selfSocketId: string, existingPeers: VoiceParticipant[]) {
    this.activeChannelId = channelId;
    this.selfSocketId = selfSocketId;

    for (const peer of existingPeers) {
      if (peer.socketId === selfSocketId) continue;
      this.createPeerConnection(peer.socketId, peer.streamsMeta || null, false);
    }

    this.broadcastStreamsMeta();
    this.startStatsLoop();
    this.emitLocalState();
    this.emitPeersState();
  }

  reconnectAllPeers() {
    for (const ctx of this.peers.values()) {
      try {
        ctx.pc.restartIce();
      } catch {}
    }
  }

  leaveChannel(notify = true) {
    if (this.statsTimer) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.cleanupMicDsp();

    for (const ctx of this.peers.values()) {
      ctx.vadCleanup?.();
      try {
        ctx.rcChannel?.close();
        ctx.rcFastChannel?.close();
        ctx.pc.close();
      } catch {}
    }
    this.peers.clear();
    this.pendingIceCandidates.clear();
    this.pendingRemoteMeta.clear();

    this.micStream?.getTracks().forEach((t) => t.stop());
    this.camStream?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.loopbackBridge?.stop();
    this.loopbackBridge = null;

    this.micStream = null;
    this.camStream = null;
    this.screenStream = null;
    this.screenConfig = null;
    this.screenLabel = '';
    this.localSpeaking = false;
    this.localMicLevel = 0;
    this.localScreenStats = null;
    this.activeChannelId = null;

    if (notify) {
      this.emitLocalState();
      this.emitPeersState();
    }
  }

  setMuteDeafen(muted: boolean, deafened: boolean) {
    this.muted = muted;
    this.deafened = deafened;
    this.applyMicEnabledState();
  }

  async toggleCamera(): Promise<boolean> {
    if (!this.activeChannelId) return false;
    if (this.camStream) {
      this.stopCamera();
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: this.settings.videoDeviceId ? { ideal: this.settings.videoDeviceId } : undefined,
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 360 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });

      this.camStream = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.contentHint = 'motion';
        track.onended = () => this.stopCamera();
      }

      this.broadcastStreamsMeta();
      for (const ctx of this.peers.values()) {
        if (track) {
          ctx.camSender = ctx.pc.addTrack(track, stream);
          preferHighQualityVideoCodecs(ctx.pc, ctx.camSender);
          this.applyVideoSenderParams(ctx.camSender, 5, 30, 'motion');
        }
      }

      this.socket?.emit('voice:media-state', { cameraOn: true });
      this.emitLocalState();
      return true;
    } catch (err) {
      console.error('[WebRTC] Erro ao ligar câmera:', err);
      this.callbacks.onError('Não foi possível ligar a câmera. Verifique se outra aplicação está usando-a.');
      return false;
    }
  }

  stopCamera() {
    if (!this.camStream) return;
    this.camStream.getTracks().forEach((t) => t.stop());
    this.camStream = null;

    for (const ctx of this.peers.values()) {
      if (ctx.camSender) {
        try {
          ctx.pc.removeTrack(ctx.camSender);
        } catch {}
        ctx.camSender = null;
      }
    }

    this.broadcastStreamsMeta();
    this.socket?.emit('voice:media-state', { cameraOn: false });
    this.emitLocalState();
  }

  async startScreenShare(config: ScreenShareConfig): Promise<boolean> {
    if (!this.activeChannelId) return false;
    if (this.screenStream) this.stopScreenShare();

    try {
      const lowLatency = config.lowLatencyGaming !== false;
      const targetRes = config.qualityMode === 'auto' ? '1080p' : config.resolution;
      const targetFps = config.qualityMode === 'auto' ? 60 : config.fps;
      const startBitrate = config.qualityMode === 'auto' ? (lowLatency ? 22 : 14) : config.maxBitrateMbps;
      this.adaptiveBitrateMbps = startBitrate;

      const dims = getResolutionDimensions(targetRes);

      let loopback: LoopbackBridgeHandle | null = null;
      let useProcessLoopback = false;
      if (window.electronAPI?.isElectron && config.shareAudio) {
        loopback = await createProcessLoopbackAudioTrack().catch(() => null);
        useProcessLoopback = Boolean(loopback);
      }

      if (window.electronAPI?.isElectron && config.sourceId) {
        await window.electronAPI.prepareScreenCapture({
          sourceId: config.sourceId,
          shareAudio: config.shareAudio,
          useProcessLoopback,
        });
      }

      const displayConstraints: DisplayMediaStreamOptions = {
        video: {
          width: dims.width ? { ideal: dims.width } : undefined,
          height: dims.height ? { ideal: dims.height } : undefined,
          frameRate: { ideal: targetFps, max: targetFps },
        },
        audio:
          config.shareAudio && !useProcessLoopback
            ? ({
                restrictOwnAudio: true,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
                sampleRate: 48000,
              } as unknown as MediaTrackConstraints)
            : false,
      };

      const rawDisplayStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      const videoTrack = rawDisplayStream.getVideoTracks()[0];
      if (!videoTrack) {
        rawDisplayStream.getTracks().forEach((t) => t.stop());
        loopback?.stop();
        throw new Error('Nenhuma faixa de vídeo capturada.');
      }

      try {
        await videoTrack.applyConstraints({
          width: dims.width ? { ideal: dims.width } : undefined,
          height: dims.height ? { ideal: dims.height } : undefined,
          frameRate: { ideal: targetFps, max: targetFps },
        });
      } catch {}

      videoTrack.contentHint = config.contentMode;
      videoTrack.onended = () => this.stopScreenShare();

      let audioTrack: MediaStreamTrack | null = null;
      let stream: MediaStream = rawDisplayStream;
      if (loopback) {
        this.loopbackBridge = loopback;
        audioTrack = loopback.track;
        stream = new MediaStream([videoTrack, audioTrack]);
      } else {
        audioTrack = rawDisplayStream.getAudioTracks()[0] || null;
      }

      this.screenStream = stream;
      this.screenConfig = { ...config, resolution: targetRes, fps: targetFps, maxBitrateMbps: startBitrate };
      this.screenLabel = config.label || videoTrack.label || 'Tela Compartilhada';
      this.prevOutboundScreenBytes = 0;
      this.prevOutboundScreenTs = 0;
      this.prevPacketsLost = 0;
      this.prevPacketsSent = 0;

      this.broadcastStreamsMeta();

      for (const ctx of this.peers.values()) {
        ctx.screenVideoSender = ctx.pc.addTrack(videoTrack, stream);
        preferHighQualityVideoCodecs(ctx.pc, ctx.screenVideoSender);
        await this.applyVideoSenderParams(ctx.screenVideoSender, startBitrate, targetFps, config.contentMode);

        if (audioTrack) {
          ctx.screenAudioSender = ctx.pc.addTrack(audioTrack, stream);
          await this.applyAudioSenderParams(ctx.screenAudioSender, 192_000);
        }
      }

      this.socket?.emit('voice:media-state', {
        screenSharing: true,
        screenLabel: this.screenLabel,
      });
      this.emitLocalState();
      return true;
    } catch (err: unknown) {
      const e = err as Error;
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') {
        console.error('[WebRTC] Erro ao compartilhar tela:', err);
        this.callbacks.onError(`Não foi possível iniciar a transmissão de tela: ${e?.message || 'erro desconhecido'}`);
      }
      return false;
    }
  }

  stopScreenShare() {
    this.loopbackBridge?.stop();
    this.loopbackBridge = null;
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenConfig = null;
    this.screenLabel = '';
    this.localScreenStats = null;

    for (const ctx of this.peers.values()) {
      if (ctx.screenVideoSender) {
        try {
          ctx.pc.removeTrack(ctx.screenVideoSender);
        } catch {}
        ctx.screenVideoSender = null;
      }
      if (ctx.screenAudioSender) {
        try {
          ctx.pc.removeTrack(ctx.screenAudioSender);
        } catch {}
        ctx.screenAudioSender = null;
      }
    }

    this.broadcastStreamsMeta();
    this.socket?.emit('voice:media-state', {
      screenSharing: false,
      screenLabel: '',
    });
    this.emitLocalState();
  }

  private async applyVideoSenderParams(
    sender: RTCRtpSender,
    bitrateMbps: number,
    fps: number,
    contentMode: 'motion' | 'detail'
  ) {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = Math.round(bitrateMbps * 1_000_000);
      params.encodings[0].maxFramerate = fps;
      params.encodings[0].scaleResolutionDownBy = 1;
      params.degradationPreference =
        contentMode === 'detail'
          ? 'maintain-resolution'
          : this.screenConfig?.lowLatencyGaming !== false
          ? 'maintain-framerate'
          : 'balanced';
      await sender.setParameters(params);
    } catch (err) {
      console.warn('[WebRTC] setParameters video warning:', err);
    }
  }

  private async applyAudioSenderParams(sender: RTCRtpSender, maxBitrateBps: number) {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrateBps;
      await sender.setParameters(params);
    } catch {}
  }

  private createPeerConnection(
    remoteSocketId: string,
    initialMeta: StreamsMeta | null,
    awaitingInitialOffer = false
  ): PeerContext {
    const existing = this.peers.get(remoteSocketId);
    if (existing) {
      if (initialMeta && !existing.remoteMeta) existing.remoteMeta = initialMeta;
      return existing;
    }

    const pc = new RTCPeerConnection({
      iceServers: this.getIceServers(),
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    const polite = this.selfSocketId < remoteSocketId;
    const savedMeta = initialMeta || this.pendingRemoteMeta.get(remoteSocketId) || null;
    this.pendingRemoteMeta.delete(remoteSocketId);

    // Negotiated P2P DataChannels for Parsec-speed input (~1ms LAN!):
    // - id:42 ordered (`rcChannel`): discrete buttons / rumble
    // - id:43 unordered maxRetransmits:0 (`rcFastChannel`): 120Hz mouse move / relative aim / analog controller
    let rcChannel: RTCDataChannel | null = null;
    let rcFastChannel: RTCDataChannel | null = null;
    try {
      rcChannel = pc.createDataChannel('remote-control', {
        negotiated: true,
        id: 42,
        ordered: true,
      });
      rcFastChannel = pc.createDataChannel('remote-control-fast', {
        negotiated: true,
        id: 43,
        ordered: false,
        maxRetransmits: 0,
      });
    } catch {
      rcChannel = null;
      rcFastChannel = null;
    }

    const ctx: PeerContext = {
      socketId: remoteSocketId,
      pc,
      rcChannel,
      rcFastChannel,
      lastFastSeq: 0,
      polite,
      awaitingInitialOffer,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      remoteMeta: savedMeta,
      micSender: null,
      camSender: null,
      screenVideoSender: null,
      screenAudioSender: null,
      media: {
        socketId: remoteSocketId,
        micStream: null,
        camStream: null,
        screenStream: null,
        screenAudioStream: null,
        connectionState: pc.connectionState,
        speaking: false,
        screenStats: null,
        camStats: null,
        dataChannelOpen: false,
      },
      prevInboundScreenBytes: 0,
      prevInboundScreenTs: 0,
      prevInboundCamBytes: 0,
      prevInboundCamTs: 0,
    };

    if (rcChannel) {
      rcChannel.onopen = () => {
        ctx.media.dataChannelOpen = true;
        this.emitPeersState();
      };
      rcChannel.onclose = () => {
        ctx.media.dataChannelOpen = false;
        this.emitPeersState();
      };
      rcChannel.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(String(ev.data)) as RemoteInputEvent;
          this.callbacks.onRemoteInputReceived?.(remoteSocketId, parsed);
        } catch {}
      };
    }

    if (rcFastChannel) {
      rcFastChannel.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(String(ev.data)) as RemoteInputEvent;
          if (typeof parsed.seq === 'number') {
            // Drop stale out-of-order packets across unordered channel
            if (parsed.seq <= ctx.lastFastSeq && ctx.lastFastSeq - parsed.seq < 100000) return;
            ctx.lastFastSeq = parsed.seq;
          }
          this.callbacks.onRemoteInputReceived?.(remoteSocketId, parsed);
        } catch {}
      };
    }

    this.peers.set(remoteSocketId, ctx);

    if (this.micStream) {
      const micTrack = this.micStream.getAudioTracks()[0];
      if (micTrack) {
        ctx.micSender = pc.addTrack(micTrack, this.micStream);
        this.applyAudioSenderParams(ctx.micSender, this.settings.inputProfile === 'studio' ? 160_000 : 128_000);
      }
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    if (this.camStream) {
      const camTrack = this.camStream.getVideoTracks()[0];
      if (camTrack) {
        ctx.camSender = pc.addTrack(camTrack, this.camStream);
        preferHighQualityVideoCodecs(pc, ctx.camSender);
        this.applyVideoSenderParams(ctx.camSender, 5, 30, 'motion');
      }
    }
    if (this.screenStream && this.screenConfig) {
      const vTrack = this.screenStream.getVideoTracks()[0];
      if (vTrack) {
        ctx.screenVideoSender = pc.addTrack(vTrack, this.screenStream);
        preferHighQualityVideoCodecs(pc, ctx.screenVideoSender);
        this.applyVideoSenderParams(
          ctx.screenVideoSender,
          this.adaptiveBitrateMbps,
          this.screenConfig.fps,
          this.screenConfig.contentMode
        );
      }
      const aTrack = this.screenStream.getAudioTracks()[0];
      if (aTrack) {
        ctx.screenAudioSender = pc.addTrack(aTrack, this.screenStream);
        this.applyAudioSenderParams(ctx.screenAudioSender, 192_000);
      }
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.socket) {
        this.socket.emit('rtc:ice-candidate', {
          targetSocketId: remoteSocketId,
          candidate: candidate.toJSON(),
        });
      }
    };

    const syncConnectionState = () => {
      let state: RTCPeerConnectionState = pc.connectionState;
      if (
        (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') &&
        state !== 'failed' &&
        state !== 'closed'
      ) {
        state = 'connected';
      } else if (pc.iceConnectionState === 'failed') {
        state = 'failed';
      }
      ctx.media.connectionState = state;
      if (state === 'failed') pc.restartIce();
      this.emitPeersState();
    };

    pc.onconnectionstatechange = syncConnectionState;
    pc.oniceconnectionstatechange = syncConnectionState;

    pc.onnegotiationneeded = async () => {
      if (ctx.awaitingInitialOffer) return;
      try {
        ctx.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription && this.socket) {
          this.socket.emit('rtc:description', {
            targetSocketId: remoteSocketId,
            description: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            },
          });
        }
      } catch (err) {
        console.error('[WebRTC] negotiationneeded error:', err);
      } finally {
        ctx.makingOffer = false;
      }
    };

    pc.ontrack = (event) => {
      // Zero playout jitter buffer delay for instant Parsec-grade screen share & LAN voice!
      try {
        const rec = event.receiver as RTCRtpReceiver & { playoutDelayHint?: number; jitterBufferTarget?: number };
        if ('playoutDelayHint' in rec) rec.playoutDelayHint = 0;
        if ('jitterBufferTarget' in rec) rec.jitterBufferTarget = 0;
      } catch {}

      const track = event.track;
      const incomingStream = event.streams[0] || new MediaStream([track]);
      this.classifyRemoteTrack(ctx, track, incomingStream);

      track.onended = () => this.removeRemoteTrack(ctx, track);
    };

    this.broadcastStreamsMeta(remoteSocketId);

    return ctx;
  }

  private async flushPendingIceCandidates(ctx: PeerContext) {
    const queue = this.pendingIceCandidates.get(ctx.socketId);
    if (!queue || queue.length === 0) return;
    this.pendingIceCandidates.delete(ctx.socketId);
    for (const cand of queue) {
      try {
        await ctx.pc.addIceCandidate(cand);
      } catch (err) {
        if (!ctx.ignoreOffer) console.warn('[WebRTC] flush ICE warning:', err);
      }
    }
  }

  private classifyRemoteTrack(ctx: PeerContext, track: MediaStreamTrack, incomingStream: MediaStream) {
    const meta = ctx.remoteMeta;
    const streamId = incomingStream.id;

    if (track.kind === 'video') {
      const isScreen =
        (meta?.screenStreamId && streamId === meta.screenStreamId) ||
        (meta?.screenVideoTrackId && track.id === meta.screenVideoTrackId) ||
        (!meta && ctx.media.camStream !== null);

      if (isScreen) ctx.media.screenStream = new MediaStream([track]);
      else ctx.media.camStream = new MediaStream([track]);
    } else if (track.kind === 'audio') {
      const isScreenAudio =
        (meta?.screenStreamId && streamId === meta.screenStreamId) ||
        (meta?.screenAudioTrackId && track.id === meta.screenAudioTrackId) ||
        (ctx.media.micStream !== null && ctx.media.micStream.getAudioTracks()[0]?.id !== track.id);

      if (isScreenAudio) {
        ctx.media.screenAudioStream = new MediaStream([track]);
      } else {
        const prevTrackId = ctx.media.micStream?.getAudioTracks()[0]?.id;
        if (prevTrackId !== track.id) {
          const micMedia = new MediaStream([track]);
          ctx.media.micStream = micMedia;
          ctx.vadCleanup?.();
          ctx.vadCleanup = this.setupRemoteVad(micMedia, (speaking) => {
            // Não re-renderiza o app inteiro: só o anel do avatar (speakingStore)
            ctx.media.speaking = speaking;
            setSpeaking(ctx.socketId, speaking);
          });
        }
      }
    }

    this.emitPeersState();
  }

  private reclassifyAllPeerTracks(ctx: PeerContext) {
    const meta = ctx.remoteMeta;
    if (!meta || ctx.pc.signalingState !== 'stable') return;

    let micTrack: MediaStreamTrack | null = null;
    let camTrack: MediaStreamTrack | null = null;
    let screenVideoTrack: MediaStreamTrack | null = null;
    let screenAudioTrack: MediaStreamTrack | null = null;

    for (const trans of ctx.pc.getTransceivers()) {
      const track = trans.receiver.track;
      if (!track || track.readyState === 'ended') continue;
      if (trans.currentDirection === 'inactive' || trans.currentDirection === 'sendonly') continue;

      if (track.kind === 'video') {
        if (meta.screenVideoTrackId && track.id === meta.screenVideoTrackId) screenVideoTrack = track;
        else if (meta.camVideoTrackId && track.id === meta.camVideoTrackId) camTrack = track;
        else if (ctx.media.screenStream?.getVideoTracks()[0]?.id === track.id) screenVideoTrack = track;
        else if (meta.screenStreamId && !meta.camStreamId) screenVideoTrack = track;
        else camTrack = track;
      } else if (track.kind === 'audio') {
        if (meta.screenAudioTrackId && track.id === meta.screenAudioTrackId) screenAudioTrack = track;
        else if (meta.micAudioTrackId && track.id === meta.micAudioTrackId) micTrack = track;
        else if (!micTrack) micTrack = track;
        else screenAudioTrack = track;
      }
    }

    if (!meta.screenStreamId) {
      screenVideoTrack = null;
      screenAudioTrack = null;
    }
    if (!meta.camStreamId) camTrack = null;

    const prevMicId = ctx.media.micStream?.getAudioTracks()[0]?.id || null;
    const prevCamId = ctx.media.camStream?.getVideoTracks()[0]?.id || null;
    const prevScreenId = ctx.media.screenStream?.getVideoTracks()[0]?.id || null;
    const prevScreenAudioId = ctx.media.screenAudioStream?.getAudioTracks()[0]?.id || null;

    let changed = false;

    if (micTrack && micTrack.id !== prevMicId) {
      ctx.media.micStream = new MediaStream([micTrack]);
      ctx.vadCleanup?.();
      ctx.vadCleanup = this.setupRemoteVad(ctx.media.micStream, (speaking) => {
        ctx.media.speaking = speaking;
        setSpeaking(ctx.socketId, speaking);
      });
      changed = true;
    }
    if ((camTrack?.id || null) !== prevCamId) {
      ctx.media.camStream = camTrack ? new MediaStream([camTrack]) : null;
      if (!camTrack) ctx.media.camStats = null;
      changed = true;
    }
    if ((screenVideoTrack?.id || null) !== prevScreenId) {
      ctx.media.screenStream = screenVideoTrack ? new MediaStream([screenVideoTrack]) : null;
      if (!screenVideoTrack) ctx.media.screenStats = null;
      changed = true;
    }
    if ((screenAudioTrack?.id || null) !== prevScreenAudioId) {
      ctx.media.screenAudioStream = screenAudioTrack ? new MediaStream([screenAudioTrack]) : null;
      changed = true;
    }

    if (changed) this.emitPeersState();
  }

  private removeRemoteTrack(ctx: PeerContext, track: MediaStreamTrack) {
    let changed = false;
    if (ctx.media.camStream?.getTracks().some((t) => t.id === track.id)) {
      ctx.media.camStream = null;
      ctx.media.camStats = null;
      changed = true;
    }
    if (ctx.media.screenStream?.getTracks().some((t) => t.id === track.id)) {
      ctx.media.screenStream = null;
      ctx.media.screenStats = null;
      changed = true;
    }
    if (ctx.media.screenAudioStream?.getTracks().some((t) => t.id === track.id)) {
      ctx.media.screenAudioStream = null;
      changed = true;
    }
    if (ctx.media.micStream?.getTracks().some((t) => t.id === track.id)) {
      ctx.media.micStream = null;
      ctx.media.speaking = false;
      ctx.vadCleanup?.();
      changed = true;
    }
    if (changed) this.emitPeersState();
  }

  // ---- Socket Event Handlers ----
  private handlePeerJoined = ({ peer }: { channelId: string; peer: VoiceParticipant }) => {
    if (!this.activeChannelId || peer.socketId === this.selfSocketId) return;
    const ctx = this.createPeerConnection(peer.socketId, peer.streamsMeta || null, true);
    window.setTimeout(() => {
      if (ctx.awaitingInitialOffer && this.peers.get(peer.socketId) === ctx) {
        ctx.awaitingInitialOffer = false;
        if (ctx.pc.signalingState === 'stable' && !ctx.pc.remoteDescription) {
          ctx.pc.onnegotiationneeded?.(new Event('negotiationneeded'));
        }
      }
    }, 2500);
    this.emitPeersState();
  };

  private handlePeerLeft = ({ socketId }: { channelId: string; socketId: string }) => {
    const ctx = this.peers.get(socketId);
    this.pendingIceCandidates.delete(socketId);
    this.pendingRemoteMeta.delete(socketId);
    if (!ctx) return;
    ctx.vadCleanup?.();
    try {
      ctx.rcChannel?.close();
      ctx.pc.close();
    } catch {}
    this.peers.delete(socketId);
    this.emitPeersState();
  };

  private handleStreamsMeta = ({ fromSocketId, meta }: { fromSocketId: string; meta: StreamsMeta | null }) => {
    const ctx = this.peers.get(fromSocketId);
    if (!ctx) {
      this.pendingRemoteMeta.set(fromSocketId, meta);
      return;
    }
    ctx.remoteMeta = meta;
    this.reclassifyAllPeerTracks(ctx);
  };

  private handleRtcDescription = async ({
    fromSocketId,
    description,
  }: {
    fromSocketId: string;
    description: RTCSessionDescriptionInit;
  }) => {
    if (!this.activeChannelId) return;
    const ctx = this.createPeerConnection(fromSocketId, null, false);
    ctx.awaitingInitialOffer = false;
    const { pc } = ctx;

    try {
      const readyForOffer =
        !ctx.makingOffer && (pc.signalingState === 'stable' || ctx.isSettingRemoteAnswerPending);
      const offerCollision = description.type === 'offer' && !readyForOffer;

      ctx.ignoreOffer = !ctx.polite && offerCollision;
      if (ctx.ignoreOffer) return;

      ctx.isSettingRemoteAnswerPending = description.type === 'answer';
      await pc.setRemoteDescription(description);
      ctx.isSettingRemoteAnswerPending = false;

      if (description.type === 'offer') {
        await pc.setLocalDescription();
        if (pc.localDescription && this.socket) {
          this.socket.emit('rtc:description', {
            targetSocketId: fromSocketId,
            description: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            },
          });
        }
      }

      await this.flushPendingIceCandidates(ctx);
      this.reclassifyAllPeerTracks(ctx);

      if (description.type === 'offer' && pc.signalingState === 'stable') {
        const hasUnnegotiatedLocalVideo = pc
          .getTransceivers()
          .some((t) => t.sender.track && t.sender.track.kind === 'video' && t.mid === null);
        if (hasUnnegotiatedLocalVideo) {
          window.setTimeout(() => {
            if (pc.signalingState === 'stable' && !ctx.makingOffer) {
              pc.onnegotiationneeded?.(new Event('negotiationneeded'));
            }
          }, 150);
        }
      }
    } catch (err) {
      console.error('[WebRTC] handleRtcDescription error:', err);
    }
  };

  private handleRtcIceCandidate = async ({
    fromSocketId,
    candidate,
  }: {
    fromSocketId: string;
    candidate: RTCIceCandidateInit;
  }) => {
    if (!candidate) return;
    const ctx = this.peers.get(fromSocketId);
    if (!ctx || !ctx.pc.remoteDescription || !ctx.pc.localDescription) {
      const list = this.pendingIceCandidates.get(fromSocketId) || [];
      list.push(candidate);
      this.pendingIceCandidates.set(fromSocketId, list);
      return;
    }
    try {
      await ctx.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!ctx.ignoreOffer) console.warn('[WebRTC] addIceCandidate warning:', err);
    }
  };

  // ---- Adaptive Auto Bitrate & Live Quality Telemetry ----
  private startStatsLoop() {
    if (this.statsTimer) window.clearInterval(this.statsTimer);
    this.statsTimer = window.setInterval(() => {
      if (!this.screenStream && !Array.from(this.peers.values()).some((c) => c.media.screenStream || c.media.camStream)) {
        return; // Skip expensive WebRTC getStats() when pure voice/idle!
      }
      this.pollStats().catch(() => {});
    }, 2000);
  }

  private async pollStats() {
    let peersDirty = false;

    if (this.screenStream && this.screenConfig) {
      const vTrack = this.screenStream.getVideoTracks()[0];
      const trackSettings = vTrack?.getSettings();
      let updatedOutbound = false;

      for (const ctx of this.peers.values()) {
        if (!ctx.screenVideoSender) continue;
        const stats = await ctx.pc.getStats();
        let rttMs = 0;
        let packetsLost = 0;
        let isLocalLanCandidate = false;
        const codecs = new Map<string, string>();
        const localCandidates = new Map<string, string>();

        stats.forEach((r) => {
          if (r.type === 'codec' && r.mimeType) codecs.set(r.id, r.mimeType.replace('video/', '').toUpperCase());
          if (r.type === 'local-candidate' && r.candidateType) localCandidates.set(r.id, r.candidateType);
          if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
            packetsLost += Number(r.packetsLost || 0);
            if (typeof r.roundTripTime === 'number') rttMs = Math.round(r.roundTripTime * 1000);
          }
          if (r.type === 'candidate-pair' && r.state === 'succeeded') {
            if (typeof r.currentRoundTripTime === 'number') rttMs = Math.round(r.currentRoundTripTime * 1000);
            if (r.localCandidateId && localCandidates.get(r.localCandidateId) === 'host') {
              isLocalLanCandidate = true;
            }
          }
        });

        const senderStats = await ctx.screenVideoSender.getStats();
        let packetsSent = 0;
        senderStats.forEach((r) => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            packetsSent = Number(r.packetsSent || 0);
            const bytes = Number(r.bytesSent || 0);
            const ts = Number(r.timestamp || performance.now());
            let mbps = this.localScreenStats?.bitrateMbps || 0;
            if (this.prevOutboundScreenTs > 0 && ts > this.prevOutboundScreenTs) {
              const deltaBits = Math.max(0, bytes - this.prevOutboundScreenBytes) * 8;
              const deltaSec = (ts - this.prevOutboundScreenTs) / 1000;
              mbps = Number((deltaBits / deltaSec / 1_000_000).toFixed(2));
            }
            this.prevOutboundScreenBytes = bytes;
            this.prevOutboundScreenTs = ts;

            // Automatic Adaptive Bitrate Controller!
            if (this.screenConfig?.qualityMode === 'auto') {
              const dSent = Math.max(1, packetsSent - this.prevPacketsSent);
              const dLost = Math.max(0, packetsLost - this.prevPacketsLost);
              const lossRatio = dLost / (dSent + dLost);

              let nextTarget = this.adaptiveBitrateMbps;
              const lanCeiling = this.screenConfig.lowLatencyGaming !== false ? 28 : 20;
              if (lossRatio > 0.035 || rttMs > 110) {
                nextTarget = Math.max(3, Math.round((this.adaptiveBitrateMbps * 0.72) * 10) / 10);
              } else if (isLocalLanCandidate && rttMs < 20 && lossRatio < 0.005) {
                nextTarget = Math.min(lanCeiling, this.adaptiveBitrateMbps + 2);
              } else if (rttMs < 55 && lossRatio < 0.01) {
                nextTarget = Math.min(16, this.adaptiveBitrateMbps + 1);
              }

              if (Math.abs(nextTarget - this.adaptiveBitrateMbps) >= 1) {
                this.adaptiveBitrateMbps = nextTarget;
                for (const pCtx of this.peers.values()) {
                  if (pCtx.screenVideoSender && this.screenConfig) {
                    this.applyVideoSenderParams(
                      pCtx.screenVideoSender,
                      nextTarget,
                      this.screenConfig.fps,
                      this.screenConfig.contentMode
                    );
                  }
                }
              }
            }
            this.prevPacketsSent = packetsSent;
            this.prevPacketsLost = packetsLost;

            this.localScreenStats = {
              width: Number(r.frameWidth || trackSettings?.width || 0),
              height: Number(r.frameHeight || trackSettings?.height || 0),
              fps: Math.round(Number(r.framesPerSecond || trackSettings?.frameRate || 0)),
              bitrateMbps: mbps,
              codec: (r.codecId && codecs.get(r.codecId)) || 'H264/VP9',
              rttMs,
              adaptiveTargetMbps: this.screenConfig?.qualityMode === 'auto' ? this.adaptiveBitrateMbps : undefined,
            };
            updatedOutbound = true;
          }
        });
        if (updatedOutbound) break;
      }

      if (!updatedOutbound && trackSettings) {
        this.localScreenStats = {
          width: Number(trackSettings.width || 0),
          height: Number(trackSettings.height || 0),
          fps: Math.round(Number(trackSettings.frameRate || 0)),
          bitrateMbps: 0,
          codec: 'Aguardando viewer',
          rttMs: 0,
          adaptiveTargetMbps: this.screenConfig.qualityMode === 'auto' ? this.adaptiveBitrateMbps : undefined,
        };
      }
      this.emitLocalState();
    }

    for (const ctx of this.peers.values()) {
      if (!ctx.media.screenStream && !ctx.media.camStream) continue;
      const stats = await ctx.pc.getStats();
      const codecs = new Map<string, string>();
      let rttMs = 0;

      stats.forEach((r) => {
        if (r.type === 'codec' && r.mimeType) codecs.set(r.id, r.mimeType.replace('video/', '').toUpperCase());
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') {
          rttMs = Math.round(r.currentRoundTripTime * 1000);
        }
      });

      const screenTrackId = ctx.media.screenStream?.getVideoTracks()[0]?.id;
      const camTrackId = ctx.media.camStream?.getVideoTracks()[0]?.id;

      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          const trackId = r.trackIdentifier;
          const bytes = Number(r.bytesReceived || 0);
          const ts = Number(r.timestamp || performance.now());
          const codec = (r.codecId && codecs.get(r.codecId)) || 'VIDEO';

          if (screenTrackId && (trackId === screenTrackId || (!camTrackId && ctx.media.screenStream))) {
            let mbps = ctx.media.screenStats?.bitrateMbps || 0;
            if (ctx.prevInboundScreenTs > 0 && ts > ctx.prevInboundScreenTs) {
              const deltaBits = Math.max(0, bytes - ctx.prevInboundScreenBytes) * 8;
              const deltaSec = (ts - ctx.prevInboundScreenTs) / 1000;
              mbps = Number((deltaBits / deltaSec / 1_000_000).toFixed(2));
            }
            ctx.prevInboundScreenBytes = bytes;
            ctx.prevInboundScreenTs = ts;
            ctx.media.screenStats = {
              width: Number(r.frameWidth || 0),
              height: Number(r.frameHeight || 0),
              fps: Math.round(Number(r.framesPerSecond || 0)),
              bitrateMbps: mbps,
              codec,
              rttMs,
            };
            peersDirty = true;
          } else if (camTrackId && trackId === camTrackId) {
            let mbps = ctx.media.camStats?.bitrateMbps || 0;
            if (ctx.prevInboundCamTs > 0 && ts > ctx.prevInboundCamTs) {
              const deltaBits = Math.max(0, bytes - ctx.prevInboundCamBytes) * 8;
              const deltaSec = (ts - ctx.prevInboundCamTs) / 1000;
              mbps = Number((deltaBits / deltaSec / 1_000_000).toFixed(2));
            }
            ctx.prevInboundCamBytes = bytes;
            ctx.prevInboundCamTs = ts;
            ctx.media.camStats = {
              width: Number(r.frameWidth || 0),
              height: Number(r.frameHeight || 0),
              fps: Math.round(Number(r.framesPerSecond || 0)),
              bitrateMbps: mbps,
              codec,
              rttMs,
            };
            peersDirty = true;
          }
        }
      });
    }

    if (peersDirty) this.emitPeersState();
  }
}
