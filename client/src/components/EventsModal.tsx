import React, { useMemo, useState } from 'react';
import { CalendarDays, Check, Clock, HelpCircle, MapPin, Plus, Trash2, Volume2, X } from 'lucide-react';
import { Channel, RsvpStatus, ServerEvent, User } from '../types';
import { useEscapeToClose } from '../lib/useEscapeToClose';

function toLocalInput(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatEventWhen(ev: ServerEvent, now = Date.now()) {
  const d = new Date(ev.startsAt);
  const date = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const end = ev.endsAt || ev.startsAt + 3 * 3600 * 1000;
  if (now >= ev.startsAt && now < end) return `Acontecendo agora · começou às ${time}`;
  const min = Math.round((ev.startsAt - now) / 60000);
  if (min > 0 && min < 60) return `Em ${min} min · ${time}`;
  return `${date} · ${time}`;
}

const RSVP_LABEL: Record<RsvpStatus, string> = { going: 'Vou', maybe: 'Talvez', no: 'Não vou' };

/** Eventos agendados do servidor: criar, confirmar presença, entrar na chamada. */
export const EventsModal: React.FC<{
  events: ServerEvent[];
  channels: Channel[];
  members: User[];
  selfId: string;
  canManageAll: boolean;
  onCreate: (p: { title: string; description: string; startsAt: number; endsAt: number | null; channelId: string | null; location: string }) => Promise<void>;
  onRsvp: (eventId: string, status: RsvpStatus | null) => void;
  onDelete: (eventId: string) => void;
  onJoinVoice: (channelId: string) => void;
  onClose: () => void;
}> = ({ events, channels, members, selfId, canManageAll, onCreate, onRsvp, onDelete, onJoinVoice, onClose }) => {
  useEscapeToClose(onClose);
  const [creating, setCreating] = useState(events.length === 0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(() => toLocalInput(Math.ceil((Date.now() + 3600 * 1000) / (15 * 60000)) * 15 * 60000));
  const [durationMin, setDurationMin] = useState(120);
  const [where, setWhere] = useState<string>(''); // channelId ou '' (local livre)
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const voiceChannels = useMemo(() => channels.filter((c) => c.type === 'voice'), [channels]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName || 'Alguém';

  const submit = async () => {
    setError('');
    const start = new Date(startsAt).getTime();
    if (!title.trim()) return setError('Dê um nome ao evento.');
    if (!Number.isFinite(start) || start < Date.now() - 5 * 60000) return setError('Escolha uma data no futuro.');
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        startsAt: start,
        endsAt: durationMin ? start + durationMin * 60000 : null,
        channelId: where || null,
        location: where ? '' : location.trim(),
      });
      setCreating(false);
      setTitle('');
      setDescription('');
    } catch (err: unknown) {
      setError((err as Error).message || 'Não foi possível criar o evento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-[560px] max-h-[85vh] flex flex-col rounded-lg bg-[#313338] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 flex items-center gap-2 border-b border-[#1f2023]">
          <CalendarDays className="w-5 h-5 text-[#5865f2]" />
          <h2 className="text-white font-semibold flex-1">Eventos</h2>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="h-8 px-3 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-[13px] font-medium flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Criar evento
            </button>
          )}
          <button type="button" onClick={onClose} className="text-[#b5bac1] hover:text-white cursor-pointer" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {creating && (
            <div className="rounded-lg bg-[#2b2d31] p-3.5 space-y-2.5">
              <input
                autoFocus
                value={title}
                maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nome do evento (ex.: Noite de jogos)"
                className="w-full h-10 rounded bg-[#1e1f22] px-3 text-sm text-white outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase text-[#b5bac1]">Começa</span>
                  <input
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="mt-1 w-full h-9 rounded bg-[#1e1f22] px-2 text-sm text-white outline-none [color-scheme:dark]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold uppercase text-[#b5bac1]">Duração</span>
                  <select
                    value={durationMin}
                    onChange={(e) => setDurationMin(Number(e.target.value))}
                    className="mt-1 w-full h-9 rounded bg-[#1e1f22] px-2 text-sm text-white outline-none cursor-pointer"
                  >
                    <option value={30}>30 min</option>
                    <option value={60}>1 hora</option>
                    <option value={120}>2 horas</option>
                    <option value={240}>4 horas</option>
                    <option value={480}>8 horas</option>
                    <option value={0}>Sem horário de fim</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-[11px] font-bold uppercase text-[#b5bac1]">Onde</span>
                <select
                  value={where}
                  onChange={(e) => setWhere(e.target.value)}
                  className="mt-1 w-full h-9 rounded bg-[#1e1f22] px-2 text-sm text-white outline-none cursor-pointer"
                >
                  <option value="">Outro lugar (escrever)</option>
                  {voiceChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      🔊 {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {!where && (
                <input
                  value={location}
                  maxLength={100}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Ex.: servidor do Minecraft, casa do João..."
                  className="w-full h-9 rounded bg-[#1e1f22] px-3 text-sm text-white outline-none"
                />
              )}
              <textarea
                value={description}
                maxLength={1000}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição (opcional)"
                className="w-full rounded bg-[#1e1f22] px-3 py-2 text-sm text-white outline-none resize-none"
              />
              {error && <p className="text-[12px] text-[#f23f43]">{error}</p>}
              <div className="flex justify-end gap-2">
                {events.length > 0 && (
                  <button type="button" onClick={() => setCreating(false)} className="h-8 px-3 text-[13px] text-white hover:underline cursor-pointer">
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={submit}
                  className="h-8 px-4 rounded bg-[#23a55a] hover:bg-[#1a8245] text-white text-[13px] font-medium cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Criando…' : 'Criar evento'}
                </button>
              </div>
            </div>
          )}

          {events.length === 0 && !creating && <p className="text-center text-sm text-[#949ba4] py-8">Nenhum evento agendado.</p>}

          {events.map((ev) => {
            const mine = ev.rsvps?.[selfId];
            const going = Object.entries(ev.rsvps || {}).filter(([, s]) => s === 'going').map(([id]) => id);
            const maybe = Object.entries(ev.rsvps || {}).filter(([, s]) => s === 'maybe').map(([id]) => id);
            const ch = ev.channelId ? channels.find((c) => c.id === ev.channelId) : null;
            const live = Date.now() >= ev.startsAt && Date.now() < (ev.endsAt || ev.startsAt + 3 * 3600 * 1000);
            return (
              <div key={ev.id} className={`rounded-lg bg-[#2b2d31] p-3.5 border ${live ? 'border-[#23a55a]' : 'border-transparent'}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className={`text-[12px] font-bold flex items-center gap-1 ${live ? 'text-[#23a55a]' : 'text-[#f0b232]'}`}>
                      <Clock className="w-3.5 h-3.5" /> {formatEventWhen(ev)}
                    </div>
                    <div className="text-[15px] font-bold text-white mt-0.5 break-words">{ev.title}</div>
                    {(ch || ev.location) && (
                      <div className="text-[12px] text-[#b5bac1] mt-0.5 flex items-center gap-1">
                        {ch ? <Volume2 className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                        {ch ? ch.name : ev.location}
                      </div>
                    )}
                    {ev.description && <p className="text-[13px] text-[#dbdee1] mt-1.5 whitespace-pre-wrap break-words">{ev.description}</p>}
                    <div className="text-[11px] text-[#949ba4] mt-1.5">
                      {going.length} {going.length === 1 ? 'confirmado' : 'confirmados'}
                      {going.length > 0 && `: ${going.slice(0, 6).map(nameOf).join(', ')}${going.length > 6 ? '…' : ''}`}
                      {maybe.length > 0 && ` · ${maybe.length} talvez`} · criado por {ev.createdByName}
                    </div>
                  </div>
                  {(ev.createdBy === selfId || canManageAll) && (
                    <button
                      type="button"
                      title="Cancelar evento"
                      onClick={() => window.confirm(`Cancelar o evento "${ev.title}"?`) && onDelete(ev.id)}
                      className="p-1.5 text-[#b5bac1] hover:text-[#f23f43] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {(['going', 'maybe', 'no'] as RsvpStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onRsvp(ev.id, mine === s ? null : s)}
                      className={`h-7 px-2.5 rounded text-[12px] font-medium flex items-center gap-1 cursor-pointer ${
                        mine === s ? 'bg-[#5865f2] text-white' : 'bg-[#383a40] text-[#dbdee1] hover:bg-[#404249]'
                      }`}
                    >
                      {s === 'going' ? <Check className="w-3.5 h-3.5" /> : s === 'maybe' ? <HelpCircle className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      {RSVP_LABEL[s]}
                    </button>
                  ))}
                  {ch && live && (
                    <button
                      type="button"
                      onClick={() => onJoinVoice(ch.id)}
                      className="ml-auto h-7 px-3 rounded bg-[#23a55a] hover:bg-[#1a8245] text-white text-[12px] font-medium cursor-pointer"
                    >
                      Entrar na chamada
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-4 py-2 text-[11px] text-[#949ba4] border-t border-[#1f2023]">
          Quem marcar "Vou" ou "Talvez" recebe um lembrete 10 minutos antes e na hora do evento.
        </div>
      </div>
    </div>
  );
};
