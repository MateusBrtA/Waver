import React, { useState } from 'react';
import { BarChart3, Plus, X } from 'lucide-react';
import { useEscapeToClose } from '../lib/useEscapeToClose';

export interface PollDraft {
  question: string;
  options: string[];
  multi: boolean;
  durationHours: number;
}

const DURATIONS: Array<{ label: string; hours: number }> = [
  { label: 'Sem prazo', hours: 0 },
  { label: '1 hora', hours: 1 },
  { label: '4 horas', hours: 4 },
  { label: '1 dia', hours: 24 },
  { label: '3 dias', hours: 72 },
  { label: '1 semana', hours: 168 },
];

export const PollComposerModal: React.FC<{ channelName: string; onSubmit: (p: PollDraft) => void; onClose: () => void }> = ({
  channelName,
  onSubmit,
  onClose,
}) => {
  useEscapeToClose(onClose);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);
  const [durationHours, setDurationHours] = useState(24);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && filled.length >= 2;

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-full max-w-[460px] rounded-lg bg-[#313338] shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-4 pt-4 pb-2 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#5865f2]" />
          <h2 className="text-white font-semibold flex-1">Criar enquete em #{channelName}</h2>
          <button type="button" onClick={onClose} className="text-[#b5bac1] hover:text-white cursor-pointer" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 pb-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <label className="block">
            <span className="text-[11px] font-bold uppercase text-[#b5bac1]">Pergunta</span>
            <input
              autoFocus
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="O que vamos jogar hoje?"
              className="mt-1 w-full h-10 rounded bg-[#1e1f22] px-3 text-sm text-white outline-none"
            />
          </label>
          <div>
            <span className="text-[11px] font-bold uppercase text-[#b5bac1]">Opções</span>
            <div className="mt-1 space-y-1.5">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={o}
                    maxLength={80}
                    onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={`Opção ${i + 1}`}
                    className="flex-1 h-9 rounded bg-[#1e1f22] px-3 text-sm text-white outline-none"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                      className="text-[#b5bac1] hover:text-[#f23f43] cursor-pointer"
                      aria-label="Remover opção"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 10 && (
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ''])}
                className="mt-2 flex items-center gap-1 text-[13px] text-[#00a8fc] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar opção
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[13px] text-[#dbdee1] cursor-pointer">
              <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="accent-[#5865f2]" />
              Permitir várias respostas
            </label>
            <select
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
              className="h-8 rounded bg-[#1e1f22] border border-[#3f4147] px-2 text-[13px] text-white outline-none cursor-pointer"
            >
              {DURATIONS.map((d) => (
                <option key={d.hours} value={d.hours}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="px-4 py-3 bg-[#2b2d31] flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded text-sm text-white hover:underline cursor-pointer">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onSubmit({ question: question.trim(), options: filled, multi, durationHours })}
            className="h-9 px-4 rounded bg-[#5865f2] hover:bg-[#4752c4] text-sm font-medium text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Publicar enquete
          </button>
        </div>
      </div>
    </div>
  );
};
