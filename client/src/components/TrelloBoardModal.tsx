import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  CheckSquare,
  FolderKanban,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { TrelloBoard, TrelloCard, TrelloChecklistItem, User } from '../types';

const BOARD_BACKGROUNDS = [
  'linear-gradient(135deg, #1e293b 0%, #312e81 55%, #0f172a 100%)',
  'linear-gradient(135deg, #064e3b 0%, #0f766e 50%, #111827 100%)',
  'linear-gradient(135deg, #7c2d12 0%, #be185d 55%, #1e1b4b 100%)',
  'linear-gradient(135deg, #0c4a6e 0%, #1d4ed8 55%, #0f172a 100%)',
  '#2b2d31',
];

const DEFAULT_LABELS = [
  { id: 'lbl-urgente', name: 'Urgente', color: '#ef4444' },
  { id: 'lbl-dev', name: 'Dev / Código', color: '#3b82f6' },
  { id: 'lbl-arte', name: 'Design / 3D', color: '#a855f7' },
  { id: 'lbl-ok', name: 'Pronto', color: '#22c55e' },
];

interface TrelloBoardModalProps {
  scopeKey: string;
  scopeTitle: string;
  boards: TrelloBoard[];
  members: User[];
  currentUser: User;
  canEdit: boolean;
  onSaveBoards: (nextBoards: TrelloBoard[]) => Promise<void> | void;
  onClose: () => void;
}

export const TrelloBoardModal: React.FC<TrelloBoardModalProps> = ({
  scopeKey,
  scopeTitle,
  boards,
  members,
  currentUser,
  canEdit,
  onSaveBoards,
  onClose,
}) => {
  const safeBoards = useMemo<TrelloBoard[]>(() => {
    if (boards.length > 0) return boards;
    return [
      {
        id: `board-${Date.now()}`,
        scopeKey,
        name: `Projeto Principal (${scopeTitle})`,
        background: BOARD_BACKGROUNDS[0],
        labels: DEFAULT_LABELS,
        lists: [
          { id: 'list-1', title: 'A Fazer', cards: [] },
          { id: 'list-2', title: 'Em Progresso', cards: [] },
          { id: 'list-3', title: 'Concluído', cards: [] },
        ],
        updatedAt: Date.now(),
        createdBy: currentUser.displayName,
      },
    ];
  }, [boards, scopeKey, scopeTitle, currentUser.displayName]);

  const [activeBoardId, setActiveBoardId] = useState<string>(safeBoards[0].id);
  const activeBoard = safeBoards.find((b) => b.id === activeBoardId) || safeBoards[0];

  const [newBoardName, setNewBoardName] = useState('');
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [addingList, setAddingList] = useState(false);
  const [cardInputs, setCardInputs] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');

  const [editingCard, setEditingCard] = useState<{ listId: string; card: TrelloCard } | null>(null);
  const [newCheckText, setNewCheckText] = useState('');
  const [dragState, setDragState] = useState<{ fromListId: string; cardId: string } | null>(null);

  const commitActiveBoard = (updatedBoard: TrelloBoard) => {
    const exists = safeBoards.some((b) => b.id === updatedBoard.id);
    const next = exists
      ? safeBoards.map((b) => (b.id === updatedBoard.id ? { ...updatedBoard, updatedAt: Date.now() } : b))
      : [...safeBoards, updatedBoard];
    onSaveBoards(next);
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !newBoardName.trim()) return;
    const created: TrelloBoard = {
      id: `board-${Date.now().toString(36)}`,
      scopeKey,
      name: newBoardName.trim().slice(0, 48),
      background: BOARD_BACKGROUNDS[safeBoards.length % BOARD_BACKGROUNDS.length],
      labels: DEFAULT_LABELS,
      lists: [
        { id: `l-${Date.now()}-1`, title: 'A Fazer', cards: [] },
        { id: `l-${Date.now()}-2`, title: 'Em Progresso', cards: [] },
        { id: `l-${Date.now()}-3`, title: 'Concluído', cards: [] },
      ],
      updatedAt: Date.now(),
      createdBy: currentUser.displayName,
    };
    onSaveBoards([...safeBoards, created]);
    setActiveBoardId(created.id);
    setNewBoardName('');
    setCreatingBoard(false);
  };

  const handleAddList = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !newListTitle.trim()) return;
    commitActiveBoard({
      ...activeBoard,
      lists: [...activeBoard.lists, { id: `list-${Date.now().toString(36)}`, title: newListTitle.trim().slice(0, 40), cards: [] }],
    });
    setNewListTitle('');
    setAddingList(false);
  };

  const handleAddCard = (listId: string) => {
    const title = (cardInputs[listId] || '').trim();
    if (!canEdit || !title) return;
    const card: TrelloCard = {
      id: `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      title,
      description: '',
      labelIds: [],
      dueDate: null,
      completed: false,
      checklist: [],
      memberIds: [currentUser.id],
      createdBy: currentUser.displayName,
      createdAt: Date.now(),
    };
    commitActiveBoard({
      ...activeBoard,
      lists: activeBoard.lists.map((l) => (l.id === listId ? { ...l, cards: [...l.cards, card] } : l)),
    });
    setCardInputs((prev) => ({ ...prev, [listId]: '' }));
  };

  const moveCard = (fromListId: string, toListId: string, cardId: string) => {
    if (!canEdit || fromListId === toListId) return;
    const srcList = activeBoard.lists.find((l) => l.id === fromListId);
    const cardObj = srcList?.cards.find((c) => c.id === cardId);
    if (!cardObj) return;
    commitActiveBoard({
      ...activeBoard,
      lists: activeBoard.lists.map((l) => {
        if (l.id === fromListId) return { ...l, cards: l.cards.filter((c) => c.id !== cardId) };
        if (l.id === toListId) return { ...l, cards: [...l.cards, cardObj] };
        return l;
      }),
    });
  };

  const updateCard = (listId: string, updated: TrelloCard) => {
    setEditingCard({ listId, card: updated });
    commitActiveBoard({
      ...activeBoard,
      lists: activeBoard.lists.map((l) =>
        l.id === listId ? { ...l, cards: l.cards.map((c) => (c.id === updated.id ? updated : c)) } : l
      ),
    });
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[125] bg-black/80 flex items-center justify-center p-3 sm:p-5">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl h-[90vh] rounded-lg border border-white/15 shadow-2xl overflow-hidden flex flex-col"
        style={{ background: activeBoard.background || BOARD_BACKGROUNDS[0] }}
      >
        {/* Trello Header Bar */}
        <div className="px-4 py-3 bg-black/45 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5 text-white font-bold text-sm">
              <FolderKanban className="w-5 h-5 text-[#60a5fa]" />
              <span>Trello • {scopeTitle}</span>
            </div>

            <select
              value={activeBoard.id}
              onChange={(e) => setActiveBoardId(e.target.value)}
              className="bg-black/50 border border-white/20 rounded-lg px-2.5 py-1 text-xs font-bold text-white outline-none cursor-pointer"
            >
              {safeBoards.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#2b2d31]">
                  {b.name}
                </option>
              ))}
            </select>

            {canEdit && (
              creatingBoard ? (
                <form onSubmit={handleCreateProject} className="flex items-center gap-1">
                  <input
                    type="text"
                    autoFocus
                    value={newBoardName}
                    onChange={(e) => setNewBoardName(e.target.value)}
                    placeholder="Nome do projeto..."
                    className="bg-black/60 border border-white/20 rounded px-2 py-1 text-xs text-white outline-none w-36"
                  />
                  <button type="submit" className="px-2 py-1 rounded bg-[#23a55a] text-white text-xs font-bold cursor-pointer">
                    Criar
                  </button>
                  <button type="button" onClick={() => setCreatingBoard(false)} className="text-white/70 hover:text-white cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreatingBoard(true)}
                  className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Novo Projeto
                </button>
              )
            )}

            {/* Theme Swatches */}
            {canEdit && (
              <div className="flex items-center gap-1 ml-1">
                {BOARD_BACKGROUNDS.map((bg, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => commitActiveBoard({ ...activeBoard, background: bg })}
                    className={`w-4 h-4 rounded border ${activeBoard.background === bg ? 'border-white scale-110' : 'border-white/30'} cursor-pointer`}
                    style={{ background: bg }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-white/60 absolute left-2.5 top-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar tarefas..."
                className="bg-black/40 border border-white/15 rounded-lg pl-7 pr-2.5 py-1 text-xs text-white placeholder-white/50 outline-none w-40"
              />
            </div>

            {canEdit && safeBoards.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const next = safeBoards.filter((b) => b.id !== activeBoard.id);
                  onSaveBoards(next);
                  setActiveBoardId(next[0].id);
                }}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-[#da373c] text-white/80 hover:text-white cursor-pointer"
                title="Excluir projeto atual"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Horizontal Kanban Lists Area */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 flex items-start gap-3.5">
          {activeBoard.lists.map((list) => {
            const visibleCards = list.cards.filter(
              (c) => !searchQuery.trim() || c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.description.toLowerCase().includes(searchQuery.toLowerCase())
            );
            return (
              <div
                key={list.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragState) {
                    moveCard(dragState.fromListId, list.id, dragState.cardId);
                    setDragState(null);
                  }
                }}
                className="w-72 shrink-0 max-h-full bg-[#1e1f22]/92 border border-white/10 rounded-lg flex flex-col shadow-xl"
              >
                <div className="px-3 py-2.5 flex items-center justify-between border-b border-white/5">
                  <span className="text-xs font-bold text-white truncate">
                    {list.title} <span className="text-[#949ba4] font-normal">({visibleCards.length})</span>
                  </span>
                  {canEdit && activeBoard.lists.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        commitActiveBoard({ ...activeBoard, lists: activeBoard.lists.filter((l) => l.id !== list.id) })
                      }
                      className="text-[#949ba4] hover:text-[#f23f42] p-1 cursor-pointer"
                      title="Excluir coluna"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {visibleCards.map((card) => {
                    const doneCount = card.checklist.filter((i) => i.done).length;
                    return (
                      <div
                        key={card.id}
                        draggable={canEdit}
                        onDragStart={() => setDragState({ fromListId: list.id, cardId: card.id })}
                        onClick={() => setEditingCard({ listId: list.id, card })}
                        className="bg-[#2b2d31] hover:bg-[#232837] border border-white/5 hover:border-[#5865f2]/60 rounded-lg p-2.5 space-y-1.5 cursor-pointer transition shadow-sm"
                      >
                        {card.labelIds.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {card.labelIds.map((lid) => {
                              const lbl = activeBoard.labels.find((x) => x.id === lid);
                              if (!lbl) return null;
                              return (
                                <span
                                  key={lid}
                                  className="px-1.5 py-0.5 rounded text-[9px] font-bold text-white"
                                  style={{ backgroundColor: lbl.color }}
                                >
                                  {lbl.name}
                                </span>
                              );
                            })}
                          </div>
                        )}

                        <div className="text-xs font-semibold text-white leading-snug">{card.title}</div>

                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <div className="flex items-center gap-2 text-[10px] text-[#949ba4]">
                            {card.dueDate && (
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-bold ${
                                  card.completed ? 'bg-[#23a55a] text-white' : 'bg-white/10 text-[#dbdee1]'
                                }`}
                              >
                                <Calendar className="w-2.5 h-2.5" />
                                {card.dueDate}
                              </span>
                            )}
                            {card.checklist.length > 0 && (
                              <span
                                className={`inline-flex items-center gap-0.5 font-bold ${
                                  doneCount === card.checklist.length ? 'text-[#4ade80]' : ''
                                }`}
                              >
                                <CheckSquare className="w-3 h-3" />
                                {doneCount}/{card.checklist.length}
                              </span>
                            )}
                          </div>

                          <div className="flex -space-x-1">
                            {card.memberIds.slice(0, 3).map((mid) => {
                              const u = members.find((m) => m.id === mid);
                              return (
                                <span
                                  key={mid}
                                  title={u?.displayName || mid}
                                  className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center border border-[#1e1f22]"
                                  style={{ backgroundColor: u?.avatarColor || '#5865F2' }}
                                >
                                  {(u?.displayName || 'U').slice(0, 1).toUpperCase()}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {canEdit && (
                  <div className="p-2 border-t border-white/5 flex gap-1">
                    <input
                      type="text"
                      value={cardInputs[list.id] || ''}
                      onChange={(e) => setCardInputs((p) => ({ ...p, [list.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddCard(list.id);
                      }}
                      placeholder="+ Adicionar cartão..."
                      className="flex-1 bg-[#181b24] border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-[#6d6f78] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddCard(list.id)}
                      className="px-2 py-1.5 rounded-md bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {canEdit && (
            addingList ? (
              <form
                onSubmit={handleAddList}
                className="w-64 shrink-0 bg-[#1e1f22]/92 border border-white/10 rounded-lg p-3 space-y-2"
              >
                <input
                  type="text"
                  autoFocus
                  value={newListTitle}
                  onChange={(e) => setNewListTitle(e.target.value)}
                  placeholder="Nome da coluna..."
                  className="w-full bg-[#181b24] border border-[#5865f2] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                />
                <div className="flex items-center gap-1.5">
                  <button type="submit" className="px-3 py-1 rounded bg-[#23a55a] text-white text-xs font-bold cursor-pointer">
                    Adicionar Lista
                  </button>
                  <button type="button" onClick={() => setAddingList(false)} className="text-[#949ba4] hover:text-white cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAddingList(true)}
                className="w-60 shrink-0 py-3 px-4 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition"
              >
                <Plus className="w-4 h-4" />
                Adicionar outra lista
              </button>
            )
          )}
        </div>
      </div>

      {/* Card Detail Modal */}
      {editingCard && (
        <div
          onClick={() => setEditingCard(null)}
          className="fixed inset-0 z-[135] bg-black/75 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-[#161923] border border-white/15 rounded-lg p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                disabled={!canEdit}
                value={editingCard.card.title}
                onChange={(e) => updateCard(editingCard.listId, { ...editingCard.card, title: e.target.value })}
                className="flex-1 bg-transparent text-base font-bold text-white border-b border-transparent focus:border-[#5865f2] outline-none pb-1"
              />
              <button type="button" onClick={() => setEditingCard(null)} className="text-[#949ba4] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Move Column & Due Date */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-[#949ba4]">Coluna</span>
                <select
                  disabled={!canEdit}
                  value={editingCard.listId}
                  onChange={(e) => {
                    const dest = e.target.value;
                    moveCard(editingCard.listId, dest, editingCard.card.id);
                    setEditingCard({ listId: dest, card: editingCard.card });
                  }}
                  className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-2.5 py-1.5 text-white outline-none"
                >
                  {activeBoard.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-[#949ba4]">Prazo / Entrega</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    disabled={!canEdit}
                    value={editingCard.card.dueDate || ''}
                    onChange={(e) => updateCard(editingCard.listId, { ...editingCard.card, dueDate: e.target.value || null })}
                    className="flex-1 bg-[#1e1f22] border border-white/10 rounded-lg px-2 py-1 text-white outline-none"
                  />
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => updateCard(editingCard.listId, { ...editingCard.card, completed: !editingCard.card.completed })}
                    className={`p-1.5 rounded-lg border cursor-pointer ${
                      editingCard.card.completed ? 'bg-[#23a55a] border-[#23a55a] text-white' : 'border-white/15 text-[#949ba4]'
                    }`}
                    title="Marcar concluído"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Labels */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-[#949ba4]">Etiquetas</span>
              <div className="flex flex-wrap gap-1.5">
                {activeBoard.labels.map((lbl) => {
                  const active = editingCard.card.labelIds.includes(lbl.id);
                  return (
                    <button
                      key={lbl.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => {
                        const nextLabels = active
                          ? editingCard.card.labelIds.filter((x) => x !== lbl.id)
                          : [...editingCard.card.labelIds, lbl.id];
                        updateCard(editingCard.listId, { ...editingCard.card, labelIds: nextLabels });
                      }}
                      className={`px-2.5 py-1 rounded-md font-bold text-white cursor-pointer transition ${
                        active ? 'ring-2 ring-white scale-105' : 'opacity-50 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: lbl.color }}
                    >
                      {lbl.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-[#949ba4]">Descrição</span>
              <textarea
                disabled={!canEdit}
                rows={3}
                value={editingCard.card.description}
                onChange={(e) => updateCard(editingCard.listId, { ...editingCard.card, description: e.target.value })}
                placeholder="Detalhes da tarefa..."
                className="w-full bg-[#1e1f22] border border-white/10 rounded-lg p-2.5 text-white outline-none resize-none"
              />
            </div>

            {/* Checklist */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-[#949ba4]">Checklist</span>
              {editingCard.card.checklist.map((item: TrelloChecklistItem) => (
                <div key={item.id} className="flex items-center justify-between gap-2 bg-[#1e1f22] px-2.5 py-1.5 rounded-lg">
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={item.done}
                      onChange={() =>
                        updateCard(editingCard.listId, {
                          ...editingCard.card,
                          checklist: editingCard.card.checklist.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)),
                        })
                      }
                      className="accent-[#23a55a]"
                    />
                    <span className={`truncate ${item.done ? 'line-through text-[#949ba4]' : 'text-white'}`}>{item.text}</span>
                  </label>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        updateCard(editingCard.listId, {
                          ...editingCard.card,
                          checklist: editingCard.card.checklist.filter((x) => x.id !== item.id),
                        })
                      }
                      className="text-[#949ba4] hover:text-[#f23f42] cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newCheckText}
                    onChange={(e) => setNewCheckText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newCheckText.trim()) {
                        updateCard(editingCard.listId, {
                          ...editingCard.card,
                          checklist: [
                            ...editingCard.card.checklist,
                            { id: `chk-${Date.now()}`, text: newCheckText.trim(), done: false },
                          ],
                        });
                        setNewCheckText('');
                      }
                    }}
                    placeholder="+ Adicionar item no checklist..."
                    className="flex-1 bg-[#1e1f22] border border-white/10 rounded-lg px-2.5 py-1.5 text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newCheckText.trim()) return;
                      updateCard(editingCard.listId, {
                        ...editingCard.card,
                        checklist: [
                          ...editingCard.card.checklist,
                          { id: `chk-${Date.now()}`, text: newCheckText.trim(), done: false },
                        ],
                      });
                      setNewCheckText('');
                    }}
                    className="px-3 py-1 rounded-lg bg-[#5865f2] text-white font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {canEdit && (
              <div className="pt-2 border-t border-white/10 flex justify-between">
                <button
                  type="button"
                  onClick={() => {
                    commitActiveBoard({
                      ...activeBoard,
                      lists: activeBoard.lists.map((l) =>
                        l.id === editingCard.listId
                          ? { ...l, cards: l.cards.filter((c) => c.id !== editingCard.card.id) }
                          : l
                      ),
                    });
                    setEditingCard(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#da373c]/20 hover:bg-[#da373c] text-[#f23f42] hover:text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir Cartão
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCard(null)}
                  className="px-4 py-1.5 rounded-lg bg-[#23a55a] text-white font-bold cursor-pointer"
                >
                  Concluir
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
