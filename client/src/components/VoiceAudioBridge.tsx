import React, { useEffect, useRef } from 'react';
import { RemotePeerMedia, VoiceParticipant } from '../types';

type ExtendedAudioEl = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

const PeerStreamAudio: React.FC<{
  stream: MediaStream | null;
  volume: number; // 0 to 2
  deafened: boolean;
  outputDeviceId: string;
}> = ({ stream, volume, deafened, outputDeviceId }) => {
  const directAudioRef = useRef<ExtendedAudioEl | null>(null);
  const boostAudioRef = useRef<ExtendedAudioEl | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const clampedVol = Math.max(0, Math.min(2.5, volume));
  const needsBoost = !deafened && clampedVol > 1.01;

  useEffect(() => {
    const audioEl = directAudioRef.current;
    if (!audioEl) return;

    if (!stream) {
      audioEl.pause();
      audioEl.srcObject = null;
      return;
    }

    audioEl.srcObject = stream;
    audioEl.autoplay = true;
    audioEl.muted = deafened || needsBoost;
    audioEl.volume = deafened ? 0 : Math.max(0, Math.min(1, clampedVol));

    if (outputDeviceId && typeof audioEl.setSinkId === 'function') {
      audioEl.setSinkId(outputDeviceId).catch(() => {});
    }

    const tryPlay = () => {
      audioEl.play().catch(() => {});
    };
    tryPlay();

    window.addEventListener('pointerdown', tryPlay, { once: true });
    window.addEventListener('keydown', tryPlay, { once: true });

    return () => {
      window.removeEventListener('pointerdown', tryPlay);
      window.removeEventListener('keydown', tryPlay);
    };
  }, [stream, outputDeviceId]);

  useEffect(() => {
    const audioEl = directAudioRef.current;
    if (!audioEl) return;
    audioEl.muted = deafened || needsBoost;
    audioEl.volume = deafened ? 0 : Math.max(0, Math.min(1, clampedVol));
    if (stream && audioEl.paused) {
      audioEl.play().catch(() => {});
    }
  }, [clampedVol, deafened, needsBoost, stream]);

  useEffect(() => {
    if (!stream || !needsBoost) {
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
        gainRef.current = null;
      }
      if (boostAudioRef.current) {
        boostAudioRef.current.pause();
        boostAudioRef.current.srcObject = null;
      }
      return;
    }

    const boostEl = boostAudioRef.current;
    if (!boostEl) return;

    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      gain.gain.value = clampedVol;
      src.connect(gain);
      gain.connect(dest);

      ctxRef.current = ctx;
      gainRef.current = gain;

      boostEl.srcObject = dest.stream;
      boostEl.muted = false;
      boostEl.volume = 1;
      if (outputDeviceId && typeof boostEl.setSinkId === 'function') {
        boostEl.setSinkId(outputDeviceId).catch(() => {});
      }
      boostEl.play().catch(() => {});
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      return () => {
        try {
          src.disconnect();
          gain.disconnect();
          ctx.close();
        } catch {}
        ctxRef.current = null;
        gainRef.current = null;
      };
    } catch {
      if (directAudioRef.current) {
        directAudioRef.current.muted = deafened;
        directAudioRef.current.volume = deafened ? 0 : 1;
      }
    }
  }, [stream, needsBoost, outputDeviceId]);

  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = deafened ? 0 : clampedVol;
    }
  }, [clampedVol, deafened]);

  return (
    <>
      <audio ref={directAudioRef} autoPlay playsInline className="hidden" />
      <audio ref={boostAudioRef} autoPlay playsInline className="hidden" />
    </>
  );
};

interface VoiceAudioBridgeProps {
  remotePeers: Record<string, RemotePeerMedia>;
  participants: VoiceParticipant[];
  peerVolumes: Record<string, number>;
  masterOutputVolume: number;
  localMutedUserIds: Set<string>;
  blockedUserIds: Set<string>;
  streamAudioVolume: number;
  deafened: boolean;
  outputDeviceId: string;
}

export const VoiceAudioBridge: React.FC<VoiceAudioBridgeProps> = ({
  remotePeers,
  participants,
  peerVolumes,
  masterOutputVolume,
  localMutedUserIds,
  blockedUserIds,
  streamAudioVolume,
  deafened,
  outputDeviceId,
}) => {
  const userIdBySocket = new Map<string, string>();
  for (const p of participants) userIdBySocket.set(p.socketId, p.userId);

  return (
    <div className="hidden" aria-hidden="true">
      {Object.values(remotePeers).map((peer) => {
        const uid = userIdBySocket.get(peer.socketId) || '';
        const isSilenced = Boolean(uid && (localMutedUserIds.has(uid) || blockedUserIds.has(uid)));
        const userVol = (peerVolumes[peer.socketId] ?? peerVolumes[uid] ?? 1) * masterOutputVolume;
        return (
          <React.Fragment key={peer.socketId}>
            <PeerStreamAudio
              stream={peer.micStream}
              volume={isSilenced ? 0 : userVol}
              deafened={deafened || isSilenced}
              outputDeviceId={outputDeviceId}
            />
            <PeerStreamAudio
              stream={peer.screenAudioStream}
              volume={isSilenced ? 0 : streamAudioVolume * masterOutputVolume}
              deafened={deafened || isSilenced}
              outputDeviceId={outputDeviceId}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};
