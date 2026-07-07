import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  Calendar,
  CheckCircle2,
  Circle,
  Copy,
  DatabaseBackup,
  FolderOpen,
  GripVertical,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Tags,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppSnapshot,
  BoardColumn,
  BoardTemplate,
  Card,
  CreateProjectInput,
  Priority,
  Tag,
  TemplateId
} from "../shared/types";

const PRIORITIES: Priority[] = ["", "Low", "Medium", "High", "Urgent"];
const TAG_COLORS = ["#0f766e", "#2563eb", "#b45309", "#be123c", "#64748b"];

type DueFilter = "all" | "overdue" | "today" | "week" | "none";

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority>("");
  const [tagFilter, setTagFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const reload = useCallback(async (projectId?: string) => {
    try {
      const next = await window.projectBoard.getSnapshot(projectId);
      setSnapshot(next);
      setSelectedProjectId(next.activeProjectId ?? undefined);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const board = snapshot?.board ?? null;
  const allCards = useMemo(() => {
    return board?.columns.flatMap((column) => column.cards) ?? [];
  }, [board]);

  const selectedCard = allCards.find((card) => card.id === selectedCardId) ?? null;

  useEffect(() => {
    if (selectedCardId && !allCards.some((card) => card.id === selectedCardId)) {
      setSelectedCardId(null);
    }
  }, [allCards, selectedCardId]);

  const filteredColumns = useMemo(() => {
    if (!board) {
      return [];
    }

    return board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) =>
        matchesFilters(card, query, priorityFilter, tagFilter, dueFilter)
      )
    }));
  }, [board, dueFilter, priorityFilter, query, tagFilter]);

  async function runMutation(action: () => Promise<unknown>, message?: string) {
    try {
      await action();
      await reload(selectedProjectId);
      if (message) {
        setNotice(message);
        window.setTimeout(() => setNotice(null), 3500);
      }
      setError(null);
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  }

  async function selectProject(projectId: string) {
    setSelectedCardId(null);
    setSelectedProjectId(projectId);
    await reload(projectId);
  }

  if (!snapshot || !board) {
    return (
      <main className="loading-screen">
        <div className="loading-box">
          <DatabaseBackup size={28} />
          <p>Opening local workspace...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Sidebar
        snapshot={snapshot}
        selectedProjectId={selectedProjectId}
        onSelectProject={(projectId) => void selectProject(projectId)}
        onCreateProject={(input) =>
          runMutation(async () => {
            const project = await window.projectBoard.createProject(input);
            setSelectedProjectId(project.id);
            await reload(project.id);
          }, "Project created")
        }
      />

      <section className="workspace">
        <TopBar
          projectName={board.project.name}
          boardName={board.board.name}
          query={query}
          priorityFilter={priorityFilter}
          tagFilter={tagFilter}
          dueFilter={dueFilter}
          tags={board.tags}
          onQueryChange={setQuery}
          onPriorityChange={setPriorityFilter}
          onTagChange={setTagFilter}
          onDueChange={setDueFilter}
          onBackup={() =>
            runMutation(async () => {
              const result = await window.projectBoard.createBackup();
              setNotice(`Backup created: ${result.path}`);
            })
          }
          onOpenSettings={() => setShowSettings(true)}
        />

        {error ? (
          <div className="status-banner error">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        ) : null}

        {notice ? (
          <div className="status-banner success">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
              <X size={16} />
            </button>
          </div>
        ) : null}

        <BoardCanvas
          columns={filteredColumns}
          selectedCardId={selectedCardId}
          onSelectCard={setSelectedCardId}
          onMoveCard={(cardId, targetColumnId, targetIndex) =>
            runMutation(() => window.projectBoard.moveCard(cardId, targetColumnId, targetIndex))
          }
          onCreateCard={(columnId, title) =>
            runMutation(
              () => window.projectBoard.createCard(columnId, { title }),
              "Card created"
            )
          }
          onCreateColumn={(name) =>
            runMutation(
              () => window.projectBoard.createColumn(board.board.id, { name }),
              "Column created"
            )
          }
          onUpdateColumn={(columnId, patch) =>
            runMutation(() => window.projectBoard.updateColumn(columnId, patch))
          }
          onArchiveColumn={(columnId) =>
            runMutation(() => window.projectBoard.archiveColumn(columnId), "Column archived")
          }
          onDuplicateCard={(cardId) =>
            runMutation(() => window.projectBoard.duplicateCard(cardId), "Card duplicated")
          }
          onArchiveCard={(cardId) =>
            runMutation(async () => {
              await window.projectBoard.archiveCard(cardId);
              setSelectedCardId(null);
            }, "Card archived")
          }
        />
      </section>

      {showSettings ? (
        <SettingsPanel
          dataLocation={snapshot.dataLocation}
          backupLocation={snapshot.backupLocation}
          onClose={() => setShowSettings(false)}
          onOpenDataFolder={() => runMutation(() => window.projectBoard.openDataFolder())}
        />
      ) : (
        <DetailPanel
          card={selectedCard}
          tags={board.tags}
          onClose={() => setSelectedCardId(null)}
          onUpdateCard={(cardId, patch) =>
            runMutation(() => window.projectBoard.updateCard(cardId, patch))
          }
          onCreateTag={(name, color) =>
            runMutation(
              () => window.projectBoard.createTag(board.project.id, { name, color }),
              "Tag created"
            )
          }
          onApplyTag={(cardId, tagId) =>
            runMutation(() => window.projectBoard.applyTag(cardId, tagId))
          }
          onRemoveTag={(cardId, tagId) =>
            runMutation(() => window.projectBoard.removeTag(cardId, tagId))
          }
          onAddChecklistItem={(cardId, text) =>
            runMutation(() => window.projectBoard.addChecklistItem(cardId, text))
          }
          onUpdateChecklistItem={(itemId, patch) =>
            runMutation(() => window.projectBoard.updateChecklistItem(itemId, patch))
          }
          onDeleteChecklistItem={(itemId) =>
            runMutation(() => window.projectBoard.deleteChecklistItem(itemId))
          }
          onAddComment={(cardId, body) =>
            runMutation(() => window.projectBoard.addComment(cardId, body))
          }
        />
      )}
    </main>
  );
}

function Sidebar({
  snapshot,
  selectedProjectId,
  onSelectProject,
  onCreateProject
}: {
  snapshot: AppSnapshot;
  selectedProjectId?: string;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (input: CreateProjectInput) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("general");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    onCreateProject({ name, templateId });
    setName("");
    setTemplateId("general");
    setIsCreating(false);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{snapshot.workspace.name}</h1>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setIsCreating((value) => !value)}
          aria-label="Create project"
          title="Create project"
        >
          <Plus size={18} />
        </button>
      </div>

      {isCreating ? (
        <form className="create-project" onSubmit={submit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            autoFocus
          />
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value as TemplateId)}
          >
            {snapshot.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button type="submit">Create</button>
        </form>
      ) : null}

      <nav className="project-list" aria-label="Projects">
        {snapshot.projects.map((project) => (
          <button
            type="button"
            key={project.id}
            className={project.id === selectedProjectId ? "project-row active" : "project-row"}
            onClick={() => onSelectProject(project.id)}
          >
            <span className="project-color" style={{ background: project.color }} />
            <span>
              <strong>{project.name}</strong>
              <small>
                {project.activeCardCount} active card{project.activeCardCount === 1 ? "" : "s"}
              </small>
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <p>Local-first SQLite workspace</p>
      </div>
    </aside>
  );
}

function TopBar({
  projectName,
  boardName,
  query,
  priorityFilter,
  tagFilter,
  dueFilter,
  tags,
  onQueryChange,
  onPriorityChange,
  onTagChange,
  onDueChange,
  onBackup,
  onOpenSettings
}: {
  projectName: string;
  boardName: string;
  query: string;
  priorityFilter: Priority;
  tagFilter: string;
  dueFilter: DueFilter;
  tags: Tag[];
  onQueryChange: (query: string) => void;
  onPriorityChange: (priority: Priority) => void;
  onTagChange: (tagId: string) => void;
  onDueChange: (filter: DueFilter) => void;
  onBackup: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <header className="topbar">
      <div className="title-stack">
        <p>{boardName}</p>
        <h2>{projectName}</h2>
      </div>

      <div className="toolbar">
        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search cards"
          />
        </label>

        <select value={priorityFilter} onChange={(event) => onPriorityChange(event.target.value as Priority)}>
          <option value="">Any priority</option>
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
          <option value="Urgent">Urgent</option>
        </select>

        <select value={tagFilter} onChange={(event) => onTagChange(event.target.value)}>
          <option value="all">All tags</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>

        <select value={dueFilter} onChange={(event) => onDueChange(event.target.value as DueFilter)}>
          <option value="all">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due this week</option>
          <option value="none">No due date</option>
        </select>

        <button type="button" className="secondary-button" onClick={onBackup}>
          <DatabaseBackup size={16} />
          Backup
        </button>
        <button type="button" className="icon-button" onClick={onOpenSettings} aria-label="Settings" title="Settings">
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}

function BoardCanvas({
  columns,
  selectedCardId,
  onSelectCard,
  onMoveCard,
  onCreateCard,
  onCreateColumn,
  onUpdateColumn,
  onArchiveColumn,
  onDuplicateCard,
  onArchiveCard
}: {
  columns: BoardColumn[];
  selectedCardId: string | null;
  onSelectCard: (cardId: string) => void;
  onMoveCard: (cardId: string, targetColumnId: string, targetIndex: number) => void;
  onCreateCard: (columnId: string, title: string) => void;
  onCreateColumn: (name: string) => void;
  onUpdateColumn: (columnId: string, patch: { name?: string; collapsed?: boolean }) => void;
  onArchiveColumn: (columnId: string) => void;
  onDuplicateCard: (cardId: string) => void;
  onArchiveCard: (cardId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );
  const [newColumnName, setNewColumnName] = useState("");

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const cardId = String(active.id);
    const activeLocation = findCardLocation(columns, cardId);
    if (!activeLocation) {
      return;
    }

    const overId = String(over.id);
    let targetColumnId: string | null = null;
    let targetIndex = 0;

    if (overId.startsWith("column:")) {
      targetColumnId = overId.slice("column:".length);
      targetIndex = columns.find((column) => column.id === targetColumnId)?.cards.length ?? 0;
    } else {
      const overLocation = findCardLocation(columns, overId);
      if (!overLocation) {
        return;
      }
      targetColumnId = overLocation.column.id;
      targetIndex = overLocation.index;
    }

    if (!targetColumnId) {
      return;
    }

    onMoveCard(cardId, targetColumnId, targetIndex);
  }

  function submitColumn(event: FormEvent) {
    event.preventDefault();
    if (!newColumnName.trim()) {
      return;
    }
    onCreateColumn(newColumnName);
    setNewColumnName("");
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="board-canvas">
        {columns.map((column) => (
          <ColumnView
            key={column.id}
            column={column}
            selectedCardId={selectedCardId}
            onSelectCard={onSelectCard}
            onCreateCard={onCreateCard}
            onUpdateColumn={onUpdateColumn}
            onArchiveColumn={onArchiveColumn}
            onDuplicateCard={onDuplicateCard}
            onArchiveCard={onArchiveCard}
          />
        ))}

        <form className="new-column" onSubmit={submitColumn}>
          <input
            value={newColumnName}
            onChange={(event) => setNewColumnName(event.target.value)}
            placeholder="Add column"
          />
          <button type="submit">
            <Plus size={16} />
          </button>
        </form>
      </div>
    </DndContext>
  );
}

function ColumnView({
  column,
  selectedCardId,
  onSelectCard,
  onCreateCard,
  onUpdateColumn,
  onArchiveColumn,
  onDuplicateCard,
  onArchiveCard
}: {
  column: BoardColumn;
  selectedCardId: string | null;
  onSelectCard: (cardId: string) => void;
  onCreateCard: (columnId: string, title: string) => void;
  onUpdateColumn: (columnId: string, patch: { name?: string; collapsed?: boolean }) => void;
  onArchiveColumn: (columnId: string) => void;
  onDuplicateCard: (cardId: string) => void;
  onArchiveCard: (cardId: string) => void;
}) {
  const [name, setName] = useState(column.name);
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.id}` });

  useEffect(() => {
    setName(column.name);
  }, [column.name]);

  function saveName() {
    if (name.trim() && name.trim() !== column.name) {
      onUpdateColumn(column.id, { name });
    } else {
      setName(column.name);
    }
  }

  return (
    <section ref={setNodeRef} className={isOver ? "column is-over" : "column"}>
      <header className="column-header">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          aria-label={`Column name ${column.name}`}
        />
        <span>{column.cards.length}</span>
        <button
          type="button"
          className="icon-button quiet"
          onClick={() => onUpdateColumn(column.id, { collapsed: !column.collapsed })}
          aria-label={column.collapsed ? "Expand column" : "Collapse column"}
          title={column.collapsed ? "Expand column" : "Collapse column"}
        >
          {column.collapsed ? <Plus size={16} /> : <X size={16} />}
        </button>
        <button
          type="button"
          className="icon-button quiet"
          onClick={() => onArchiveColumn(column.id)}
          aria-label="Archive column"
          title="Archive column"
        >
          <Archive size={16} />
        </button>
      </header>

      {column.collapsed ? null : (
        <>
          <SortableContext items={column.cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
            <div className="card-list">
              {column.cards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  selected={card.id === selectedCardId}
                  onSelect={onSelectCard}
                  onDuplicate={onDuplicateCard}
                  onArchive={onArchiveCard}
                />
              ))}
            </div>
          </SortableContext>
          <QuickCardForm columnId={column.id} onCreateCard={onCreateCard} />
        </>
      )}
    </section>
  );
}

function CardTile({
  card,
  selected,
  onSelect,
  onDuplicate,
  onArchive
}: {
  card: Card;
  selected: boolean;
  onSelect: (cardId: string) => void;
  onDuplicate: (cardId: string) => void;
  onArchive: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id
  });
  const checklistDone = card.checklist.filter((item) => item.isComplete).length;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={classNames("card-tile", selected && "selected", isDragging && "dragging")}
      onClick={() => onSelect(card.id)}
    >
      <button
        type="button"
        className="drag-handle"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${card.title}`}
        title="Drag card"
      >
        <GripVertical size={16} />
      </button>
      <div className="card-body">
        <h3>{card.title}</h3>
        {card.tags.length ? (
          <div className="tag-row">
            {card.tags.map((tag) => (
              <span key={tag.id} className="tag-chip" style={{ borderColor: tag.color }}>
                <span style={{ background: tag.color }} />
                {tag.name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="card-meta">
          {card.priority ? <span className={`priority ${card.priority.toLowerCase()}`}>{card.priority}</span> : null}
          {card.dueDate ? (
            <span>
              <Calendar size={13} />
              {formatDate(card.dueDate)}
            </span>
          ) : null}
          {card.checklist.length ? (
            <span>
              <CheckCircle2 size={13} />
              {checklistDone}/{card.checklist.length}
            </span>
          ) : null}
          {card.comments.length ? (
            <span>
              <MessageSquare size={13} />
              {card.comments.length}
            </span>
          ) : null}
        </div>
      </div>
      <div className="card-actions">
        <button
          type="button"
          className="icon-button quiet"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate(card.id);
          }}
          aria-label="Duplicate card"
          title="Duplicate card"
        >
          <Copy size={15} />
        </button>
        <button
          type="button"
          className="icon-button quiet"
          onClick={(event) => {
            event.stopPropagation();
            onArchive(card.id);
          }}
          aria-label="Archive card"
          title="Archive card"
        >
          <Archive size={15} />
        </button>
      </div>
    </article>
  );
}

function QuickCardForm({
  columnId,
  onCreateCard
}: {
  columnId: string;
  onCreateCard: (columnId: string, title: string) => void;
}) {
  const [title, setTitle] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    onCreateCard(columnId, title);
    setTitle("");
  }

  return (
    <form className="quick-card" onSubmit={submit}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add card"
      />
      <button type="submit" aria-label="Add card">
        <Plus size={16} />
      </button>
    </form>
  );
}

function DetailPanel({
  card,
  tags,
  onClose,
  onUpdateCard,
  onCreateTag,
  onApplyTag,
  onRemoveTag,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onDeleteChecklistItem,
  onAddComment
}: {
  card: Card | null;
  tags: Tag[];
  onClose: () => void;
  onUpdateCard: (cardId: string, patch: { title?: string; description?: string; priority?: Priority; dueDate?: string }) => void;
  onCreateTag: (name: string, color: string) => void;
  onApplyTag: (cardId: string, tagId: string) => void;
  onRemoveTag: (cardId: string, tagId: string) => void;
  onAddChecklistItem: (cardId: string, text: string) => void;
  onUpdateChecklistItem: (itemId: string, patch: { text?: string; isComplete?: boolean }) => void;
  onDeleteChecklistItem: (itemId: string) => void;
  onAddComment: (cardId: string, body: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("");
  const [dueDate, setDueDate] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    setTitle(card?.title ?? "");
    setDescription(card?.description ?? "");
    setPriority(card?.priority ?? "");
    setDueDate(card?.dueDate ?? "");
    setNewChecklistItem("");
    setComment("");
  }, [card?.id, card?.updatedAt]);

  if (!card) {
    return (
      <aside className="detail-panel empty-detail">
        <div>
          <Tags size={28} />
          <h2>No card selected</h2>
          <p>Select a card to edit details, checklist items, tags, comments, and history.</p>
        </div>
      </aside>
    );
  }

  const activeCard = card;
  const appliedTagIds = new Set(activeCard.tags.map((tag) => tag.id));

  function saveTitle() {
    if (title.trim() && title.trim() !== activeCard.title) {
      onUpdateCard(activeCard.id, { title });
    } else {
      setTitle(activeCard.title);
    }
  }

  function saveDescription() {
    if (description !== activeCard.description) {
      onUpdateCard(activeCard.id, { description });
    }
  }

  function submitTag(event: FormEvent) {
    event.preventDefault();
    if (!newTag.trim()) {
      return;
    }
    onCreateTag(newTag, newTagColor);
    setNewTag("");
  }

  function submitChecklist(event: FormEvent) {
    event.preventDefault();
    if (!newChecklistItem.trim()) {
      return;
    }
    onAddChecklistItem(activeCard.id, newChecklistItem);
    setNewChecklistItem("");
  }

  function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) {
      return;
    }
    onAddComment(activeCard.id, comment);
    setComment("");
  }

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Card details</p>
          <input
            className="detail-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close details">
          <X size={18} />
        </button>
      </header>

      <div className="detail-section grid-two">
        <label>
          Priority
          <select
            value={priority}
            onChange={(event) => {
              const next = event.target.value as Priority;
              setPriority(next);
              onUpdateCard(card.id, { priority: next });
            }}
          >
            {PRIORITIES.map((item) => (
              <option key={item || "none"} value={item}>
                {item || "None"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date
          <input
            type="date"
            value={dueDate}
            onChange={(event) => {
              setDueDate(event.target.value);
              onUpdateCard(card.id, { dueDate: event.target.value });
            }}
          />
        </label>
      </div>

      <label className="detail-section">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={saveDescription}
          rows={7}
          placeholder="Add notes, acceptance criteria, links, or context"
        />
      </label>

      <section className="detail-section">
        <div className="section-heading">
          <h3>Tags</h3>
        </div>
        <div className="tag-picker">
          {tags.map((tag) => (
            <button
              type="button"
              key={tag.id}
              className={appliedTagIds.has(tag.id) ? "tag-toggle active" : "tag-toggle"}
              onClick={() =>
                appliedTagIds.has(tag.id)
                  ? onRemoveTag(card.id, tag.id)
                  : onApplyTag(card.id, tag.id)
              }
            >
              <span style={{ background: tag.color }} />
              {tag.name}
            </button>
          ))}
        </div>
        <form className="inline-form" onSubmit={submitTag}>
          <input
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            placeholder="New tag"
          />
          <select value={newTagColor} onChange={(event) => setNewTagColor(event.target.value)}>
            {TAG_COLORS.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
          <button type="submit">Add</button>
        </form>
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <h3>Checklist</h3>
          <span>{card.checklist.filter((item) => item.isComplete).length}/{card.checklist.length}</span>
        </div>
        <div className="checklist">
          {card.checklist.map((item) => (
            <label key={item.id} className="checklist-row">
              <input
                type="checkbox"
                checked={item.isComplete}
                onChange={(event) => onUpdateChecklistItem(item.id, { isComplete: event.target.checked })}
              />
              <span>{item.text}</span>
              <button
                type="button"
                className="icon-button quiet"
                onClick={(event) => {
                  event.preventDefault();
                  onDeleteChecklistItem(item.id);
                }}
                aria-label="Delete checklist item"
              >
                <Trash2 size={15} />
              </button>
            </label>
          ))}
        </div>
        <form className="inline-form" onSubmit={submitChecklist}>
          <input
            value={newChecklistItem}
            onChange={(event) => setNewChecklistItem(event.target.value)}
            placeholder="Add checklist item"
          />
          <button type="submit">Add</button>
        </form>
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <h3>Comments</h3>
          <span>{card.comments.length}</span>
        </div>
        <div className="comments">
          {card.comments.map((item) => (
            <article key={item.id} className="comment">
              <p>{item.body}</p>
              <time>{formatDateTime(item.createdAt)}</time>
            </article>
          ))}
        </div>
        <form onSubmit={submitComment} className="comment-form">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            placeholder="Add comment"
          />
          <button type="submit">Comment</button>
        </form>
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <h3>History</h3>
        </div>
        <div className="activity-list">
          {card.activity.map((event) => (
            <article key={event.id} className="activity-item">
              <Circle size={8} />
              <span>{event.summary}</span>
              <time>{formatDateTime(event.createdAt)}</time>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

function SettingsPanel({
  dataLocation,
  backupLocation,
  onClose,
  onOpenDataFolder
}: {
  dataLocation: string;
  backupLocation: string;
  onClose: () => void;
  onOpenDataFolder: () => void;
}) {
  return (
    <aside className="detail-panel settings-panel">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Local data</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
          <X size={18} />
        </button>
      </header>
      <section className="detail-section">
        <h3>Database</h3>
        <p className="path-text">{dataLocation}</p>
      </section>
      <section className="detail-section">
        <h3>Manual backups</h3>
        <p className="path-text">{backupLocation}</p>
      </section>
      <button type="button" className="secondary-button wide" onClick={onOpenDataFolder}>
        <FolderOpen size={16} />
        Open data folder
      </button>
    </aside>
  );
}

function findCardLocation(columns: BoardColumn[], cardId: string) {
  for (const column of columns) {
    const index = column.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return { column, index };
    }
  }
  return null;
}

function matchesFilters(
  card: Card,
  query: string,
  priorityFilter: Priority,
  tagFilter: string,
  dueFilter: DueFilter
): boolean {
  const normalized = query.trim().toLowerCase();
  const text = [
    card.title,
    card.description,
    ...card.tags.map((tag) => tag.name),
    ...card.checklist.map((item) => item.text),
    ...card.comments.map((comment) => comment.body)
  ]
    .join(" ")
    .toLowerCase();

  if (normalized && !text.includes(normalized)) {
    return false;
  }

  if (priorityFilter && card.priority !== priorityFilter) {
    return false;
  }

  if (tagFilter !== "all" && !card.tags.some((tag) => tag.id === tagFilter)) {
    return false;
  }

  return matchesDueDate(card.dueDate, dueFilter);
}

function matchesDueDate(dueDate: string, dueFilter: DueFilter): boolean {
  if (dueFilter === "all") {
    return true;
  }

  if (dueFilter === "none") {
    return !dueDate;
  }

  if (!dueDate) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);

  if (dueFilter === "overdue") {
    return diffDays < 0;
  }

  if (dueFilter === "today") {
    return diffDays === 0;
  }

  return diffDays >= 0 && diffDays <= 7;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(`${value}T00:00:00`)
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
