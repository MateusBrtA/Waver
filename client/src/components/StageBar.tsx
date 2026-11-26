import React from 'react';
import { Hand, Mic, Radio, UserMinus } from 'lucide-react';
import { VoiceParticipant } from '../types';

/** Faixa do modo palco: quem fala, plateia, mãos levantadas e ações do moderador. */
export const StageBar: React.FC<{
  participants: VoiceParticipant[];
  selfSocketId: string;
  isModerator: boolean;
  onRaiseHand: (raised: boolean) => void;
  onSetSpeaker: (socketId: string, speaker: boolean) => void;
}> = ({ participants, selfSocketId, isModerator, onRaiseHand, onSetSpeaker }) => {
  const me = participants.find((p) => p.socketId === selfSocketId);
  const speakers = participants.filter((p) => p.stageRole === 'speaker');
  const audience = participants.filter((p) => p.stageRole !== 'speaker');
  const hands = audience.filter((p) => p.handRaised);

  return (
    <div className="shrink-0 mb-3 rounded-lg bg-[#2b2d31] border border-[#3f4147] px-3.5 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Radio className="w-4 h-4 text-[#23a55a]" />
        <span className="text-sm font-bold text-white">Palco</span>
        <span className="text-[12px] text-[#b5bac1]">
          {speakers.length} no palco · {audience.length} na plateia
        </span>
        <span className="ml-auto flex items-center gap-2">
          {me?.stageRole === 'audience' && (
            <button
              type="button"
              onClick={() => onRaiseHand(!me.handRaised)}
              className={`h-8 px-3 rounded text-[13px] font-medium flex items-center gap-1.5 cursor-pointer ${
                me.handRaised ? 'bg-[#f0b232] text-[#111214]' : 'bg-[#5865f2] hover:bg-[#4752c4] text-white'
              }`}
            >
              <Hand className="w-4 h-4" />
              {me.handRaised ? 'Baixar a mão' : 'Levantar a mão'}
            </button>
          )}
          {me?.stageRole === 'speaker' && (
            <button
              type="button"
              onClick={() => onSetSpeaker(selfSocketId, false)}
              className="h-8 px-3 rounded bg-[#4e5058] hover:bg-[#6d6f78] text-white text-[13px] font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <UserMinus className="w-4 h-4" />
              Ir para a plateia
            </button>
          )}
        </span>
      </div>
      {me?.stageRole === 'audience' && (
        <p className="text-[12px] text-[#949ba4]">
          Você está na plateia: dá para ouvir tudo, mas o microfone fica desligado até um moderador te chamar para falar.
        </p>
      )}
      {isModerator && hands.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hands.map((p) => (
            <span key={p.socketId} className="flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded bg-[#1e1f22] text-[13px] text-white">
              ✋ {p.displayName}
              <button
                type="button"
                onClick={() => onSetSpeaker(p.socketId, true)}
                className="h-6 px-2 rounded bg-[#23a55a] hover:bg-[#1a8245] text-[12px] font-medium flex items-center gap-1 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" /> Chamar para falar
              </button>
            </span>
          ))}
        </div>
      )}
      {isModerator && speakers.some((p) => p.socketId !== selfSocketId) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#949ba4]">
          No palco:
          {speakers
            .filter((p) => p.socketId !== selfSocketId)
            .map((p) => (
              <button
                key={p.socketId}
                type="button"
                title="Mandar para a plateia"
                onClick={() => onSetSpeaker(p.socketId, false)}
                className="h-6 px-2 rounded bg-[#1e1f22] hover:bg-[#f23f43] text-white cursor-pointer"
              >
                {p.displayName} ✕
              </button>
            ))}
        </div>
      )}
    </div>
  );
};
