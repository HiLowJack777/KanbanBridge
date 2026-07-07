import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
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
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Copy,
  DatabaseBackup,
  FileText,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  Link2,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AppSnapshot,
  BoardColumn,
  BoardTemplate,
  Card,
  CreateCardInput,
  CreateProjectInput,
  DesignAsset,
  Observation,
  ObservationStatus,
  Priority,
  Project,
  ProjectDocument,
  Tag,
  TemplateId
} from "../shared/types";

const PRIORITIES: Priority[] = ["", "Low", "Medium", "High", "Urgent"];
const TAG_COLORS = ["#0f766e", "#2563eb", "#b45309", "#be123c", "#64748b"];

type DueFilter = "all" | "overdue" | "today" | "week" | "none";
type ObservationFilter = ObservationStatus | "all";

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
  const [showObservations, setShowObservations] = useState(false);
  const [showPlanning, setShowPlanning] = useState(false);
  const [showDesignAssets, setShowDesignAssets] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newCardColumnId, setNewCardColumnId] = useState<string | null>(null);
  const [newCardObservation, setNewCardObservation] = useState<Observation | null>(null);
  const [archiveProjectTarget, setArchiveProjectTarget] = useState<Project | null>(null);

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

  useEffect(() => {
    return window.projectBoard.onExternalChange(() => {
      void reload(selectedProjectId);
    });
  }, [reload, selectedProjectId]);

  const board = snapshot?.board ?? null;
  const allCards = useMemo(() => {
    return board?.columns.flatMap((column) => column.cards) ?? [];
  }, [board]);

  const selectedCard = allCards.find((card) => card.id === selectedCardId) ?? null;
  const newCardColumn =
    board?.columns.find((column) => column.id === newCardColumnId) ?? null;
  const defaultNewCardColumnId =
    board?.columns.find((column) => column.name.toLowerCase() === "backlog")?.id ??
    board?.columns[0]?.id ??
    null;

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
    setNewCardColumnId(null);
    setNewCardObservation(null);
    setSelectedProjectId(projectId);
    await reload(projectId);
  }

  function openNewCard(columnId: string, observation: Observation | null = null) {
    setNewCardObservation(observation);
    setNewCardColumnId(columnId);
  }

  function closeNewCard() {
    setNewCardColumnId(null);
    setNewCardObservation(null);
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
        onRequestArchiveProject={setArchiveProjectTarget}
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
          onOpenPlanning={() => setShowPlanning(true)}
          onOpenDesignAssets={() => setShowDesignAssets(true)}
          onOpenObservations={() => setShowObservations(true)}
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
          onOpenCard={setSelectedCardId}
          onMoveCard={(cardId, targetColumnId, targetIndex) =>
            runMutation(() => window.projectBoard.moveCard(cardId, targetColumnId, targetIndex))
          }
          onRequestCreateCard={(columnId) => openNewCard(columnId)}
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

      {newCardColumn ? (
        <ModalDialog ariaLabel="Create card" onClose={closeNewCard}>
          <NewCardPanel
            column={newCardColumn}
            tags={board.tags}
            sourceObservation={newCardObservation}
            onClose={closeNewCard}
            onCreateCard={(input, tagIds, observationId) =>
              runMutation(async () => {
                const card = await window.projectBoard.createCard(newCardColumn.id, input);
                for (const tagId of tagIds) {
                  await window.projectBoard.applyTag(card.id, tagId);
                }
                if (observationId) {
                  await window.projectBoard.linkObservationToCard(card.id, observationId);
                }
                closeNewCard();
              }, "Card created")
            }
          />
        </ModalDialog>
      ) : null}

      {selectedCard ? (
        <ModalDialog ariaLabel="Card details" onClose={() => setSelectedCardId(null)}>
          <DetailPanel
            card={selectedCard}
            tags={board.tags}
            observations={snapshot.observations}
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
            onLinkObservation={(cardId, observationId) =>
              runMutation(() => window.projectBoard.linkObservationToCard(cardId, observationId))
            }
            onUnlinkObservation={(cardId, observationId) =>
              runMutation(() => window.projectBoard.unlinkObservationFromCard(cardId, observationId))
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
        </ModalDialog>
      ) : null}

      {showObservations ? (
        <ModalDialog ariaLabel="Observations" onClose={() => setShowObservations(false)}>
          <ObservationsPanel
            observations={snapshot.observations}
            onClose={() => setShowObservations(false)}
            onCreateObservation={(body) =>
              runMutation(
                () =>
                  window.projectBoard.createObservation({
                    body,
                    source: "Project Board",
                    workspaceId: snapshot.workspace.id,
                    projectId: board.project.id
                  }),
                "Observation added"
              )
            }
            onArchiveObservation={(observationId) =>
              runMutation(
                () => window.projectBoard.archiveObservation(observationId),
                "Observation archived"
              )
            }
            onCreateCardFromObservation={(observation) => {
              if (defaultNewCardColumnId) {
                openNewCard(defaultNewCardColumnId, observation);
              }
            }}
          />
        </ModalDialog>
      ) : null}

      {showPlanning ? (
        <ModalDialog ariaLabel="Planning documents" onClose={() => setShowPlanning(false)}>
          <PlanningPanel
            documents={board.documents}
            onClose={() => setShowPlanning(false)}
            onCreateDocument={(input) =>
              runMutation(
                () => window.projectBoard.createProjectDocument(board.project.id, input),
                "Planning document created"
              )
            }
            onUpdateDocument={(documentId, patch) =>
              runMutation(() => window.projectBoard.updateProjectDocument(documentId, patch))
            }
            onArchiveDocument={(documentId) =>
              runMutation(
                () => window.projectBoard.archiveProjectDocument(documentId),
                "Planning document archived"
              )
            }
          />
        </ModalDialog>
      ) : null}

      {showDesignAssets ? (
        <ModalDialog ariaLabel="Design assets" onClose={() => setShowDesignAssets(false)}>
          <DesignAssetsPanel
            assets={board.designAssets}
            cards={allCards}
            documents={board.documents}
            onClose={() => setShowDesignAssets(false)}
            onImportAsset={() =>
              runMutation(async () => {
                const asset = await window.projectBoard.importDesignAsset(board.project.id);
                if (asset) {
                  setNotice(`Design asset imported: ${asset.displayName}`);
                  window.setTimeout(() => setNotice(null), 3500);
                }
              })
            }
            onUpdateAsset={(assetId, patch) =>
              runMutation(() => window.projectBoard.updateDesignAsset(assetId, patch))
            }
            onArchiveAsset={(assetId) =>
              runMutation(
                () => window.projectBoard.archiveDesignAsset(assetId),
                "Design asset archived"
              )
            }
          />
        </ModalDialog>
      ) : null}

      {showSettings ? (
        <ModalDialog ariaLabel="Settings" onClose={() => setShowSettings(false)}>
          <SettingsPanel
            dataLocation={snapshot.dataLocation}
            backupLocation={snapshot.backupLocation}
            onClose={() => setShowSettings(false)}
            onOpenDataFolder={() => runMutation(() => window.projectBoard.openDataFolder())}
          />
        </ModalDialog>
      ) : null}

      {archiveProjectTarget ? (
        <ModalDialog ariaLabel="Archive project" onClose={() => setArchiveProjectTarget(null)}>
          <ArchiveProjectPanel
            project={archiveProjectTarget}
            onClose={() => setArchiveProjectTarget(null)}
            onConfirm={() =>
              runMutation(async () => {
                await window.projectBoard.archiveProject(archiveProjectTarget.id);
                setArchiveProjectTarget(null);
                setSelectedProjectId(undefined);
              }, "Project archived")
            }
          />
        </ModalDialog>
      ) : null}
    </main>
  );
}

function ModalDialog({
  ariaLabel,
  children,
  onClose
}: {
  ariaLabel: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

function ArchiveProjectPanel({
  project,
  onClose,
  onConfirm
}: {
  project: Project;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <aside className="detail-panel archive-project-panel">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Archive project</p>
          <h2>{project.name}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close archive project">
          <X size={18} />
        </button>
      </header>

      <section className="detail-section">
        <p className="archive-warning">
          This removes the project from the sidebar and hides its boards, cards, tags, and activity from the active
          workspace. Manual backups are not deleted.
        </p>
        <p className="archive-warning muted">
          If this is the last active project, Project Board will create a fresh starter project so the workspace stays
          usable.
        </p>
      </section>

      <footer className="modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="danger-button" onClick={onConfirm}>
          Archive project
        </button>
      </footer>
    </aside>
  );
}

function Sidebar({
  snapshot,
  selectedProjectId,
  onSelectProject,
  onRequestArchiveProject,
  onCreateProject
}: {
  snapshot: AppSnapshot;
  selectedProjectId?: string;
  onSelectProject: (projectId: string) => void;
  onRequestArchiveProject: (project: Project) => void;
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
          <div
            key={project.id}
            className={project.id === selectedProjectId ? "project-row active" : "project-row"}
          >
            <button type="button" className="project-select" onClick={() => onSelectProject(project.id)}>
              <span className="project-color" style={{ background: project.color }} />
              <span>
                <strong>{project.name}</strong>
                <small>
                  {project.activeCardCount} active card{project.activeCardCount === 1 ? "" : "s"}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="icon-button quiet"
              onClick={() => onRequestArchiveProject(project)}
              aria-label={`Archive ${project.name}`}
              title="Archive project"
            >
              <Archive size={15} />
            </button>
          </div>
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
  onOpenPlanning,
  onOpenDesignAssets,
  onOpenObservations,
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
  onOpenPlanning: () => void;
  onOpenDesignAssets: () => void;
  onOpenObservations: () => void;
  onOpenSettings: () => void;
}) {
  const visibleTags = tags.filter((tag) => !isCodeObservationTag(tag.name));

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
          {visibleTags.map((tag) => (
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

        <button type="button" className="secondary-button" onClick={onOpenObservations}>
          <MessageSquare size={16} />
          Observations
        </button>
        <button type="button" className="secondary-button" onClick={onOpenPlanning}>
          <FileText size={16} />
          Planning
        </button>
        <button type="button" className="secondary-button" onClick={onOpenDesignAssets}>
          <ImageIcon size={16} />
          Design
        </button>
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
  onOpenCard,
  onMoveCard,
  onRequestCreateCard,
  onCreateColumn,
  onUpdateColumn,
  onArchiveColumn,
  onDuplicateCard,
  onArchiveCard
}: {
  columns: BoardColumn[];
  selectedCardId: string | null;
  onOpenCard: (cardId: string) => void;
  onMoveCard: (cardId: string, targetColumnId: string, targetIndex: number) => void;
  onRequestCreateCard: (columnId: string) => void;
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
  const [dragColumns, setDragColumns] = useState(columns);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const activeCard =
    activeCardId ?
      findCardLocation(dragColumns, activeCardId)?.card ??
      findCardLocation(columns, activeCardId)?.card ??
      null
    : null;

  useEffect(() => {
    setDragColumns(columns);
  }, [columns]);

  function handleDragStart(event: DragStartEvent) {
    setActiveCardId(String(event.active.id));
    setDragColumns(columns);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    setDragColumns((current) =>
      moveCardPreview(current, String(active.id), String(over.id))
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      setDragColumns(columns);
      return;
    }

    const cardId = String(active.id);
    const finalColumns = moveCardPreview(dragColumns, cardId, String(over.id));
    const originalLocation = findCardLocation(columns, cardId);
    const finalLocation = findCardLocation(finalColumns, cardId);
    setDragColumns(finalColumns);

    if (!originalLocation || !finalLocation) {
      return;
    }

    if (
      originalLocation.column.id === finalLocation.column.id &&
      originalLocation.index === finalLocation.index
    ) {
      return;
    }

    onMoveCard(cardId, finalLocation.column.id, finalLocation.index);
  }

  function handleDragCancel() {
    setActiveCardId(null);
    setDragColumns(columns);
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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="board-canvas">
        {dragColumns.map((column) => (
          <ColumnView
            key={column.id}
            column={column}
            selectedCardId={selectedCardId}
            onOpenCard={onOpenCard}
            onRequestCreateCard={onRequestCreateCard}
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
      <DragOverlay>
        {activeCard ? <CardDragOverlay card={activeCard} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function ColumnView({
  column,
  selectedCardId,
  onOpenCard,
  onRequestCreateCard,
  onUpdateColumn,
  onArchiveColumn,
  onDuplicateCard,
  onArchiveCard
}: {
  column: BoardColumn;
  selectedCardId: string | null;
  onOpenCard: (cardId: string) => void;
  onRequestCreateCard: (columnId: string) => void;
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
          onClick={() => onRequestCreateCard(column.id)}
          aria-label={`Add card to ${column.name}`}
          title="Add card"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="icon-button quiet"
          onClick={() => onUpdateColumn(column.id, { collapsed: !column.collapsed })}
          aria-label={column.collapsed ? "Expand column" : "Collapse column"}
          title={column.collapsed ? "Expand column" : "Collapse column"}
        >
          {column.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
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
                  onOpen={onOpenCard}
                  onDuplicate={onDuplicateCard}
                  onArchive={onArchiveCard}
                />
              ))}
            </div>
          </SortableContext>
        </>
      )}
    </section>
  );
}

function CardTile({
  card,
  selected,
  onOpen,
  onDuplicate,
  onArchive
}: {
  card: Card;
  selected: boolean;
  onOpen: (cardId: string) => void;
  onDuplicate: (cardId: string) => void;
  onArchive: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 180ms cubic-bezier(0.2, 0, 0, 1)"
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={classNames("card-tile", selected && "selected", isDragging && "dragging")}
      role="button"
      tabIndex={0}
      title="Double-click to open"
      aria-label={`Open ${card.title}`}
      onClick={(event) => {
        if (event.detail === 2) {
          onOpen(card.id);
        }
      }}
      onDoubleClick={() => onOpen(card.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onOpen(card.id);
        }
      }}
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
      <CardTileBody card={card} />
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

function CardDragOverlay({ card }: { card: Card }) {
  return (
    <article className="card-tile drag-overlay-card">
      <div className="drag-handle" aria-hidden="true">
        <GripVertical size={16} />
      </div>
      <CardTileBody card={card} />
    </article>
  );
}

function CardTileBody({ card }: { card: Card }) {
  const checklistDone = card.checklist.filter((item) => item.isComplete).length;
  const visibleTags = card.tags.filter((tag) => !isCodeObservationTag(tag.name));

  return (
    <div className="card-body">
      <h3>{card.title}</h3>
      {visibleTags.length || card.observations.length ? (
        <div className="tag-row">
          {card.observations.map((observation) => (
            <span key={observation.id} className="observation-chip">
              <Link2 size={12} />
              {observation.label}
            </span>
          ))}
          {visibleTags.map((tag) => (
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
        {card.observations.length ? (
          <span>
            <Link2 size={13} />
            Obs {card.observations.length}
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
  );
}

function NewCardPanel({
  column,
  tags,
  sourceObservation,
  onClose,
  onCreateCard
}: {
  column: BoardColumn;
  tags: Tag[];
  sourceObservation: Observation | null;
  onClose: () => void;
  onCreateCard: (input: CreateCardInput, tagIds: string[], observationId?: string) => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("");
  const [dueDate, setDueDate] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);

  useEffect(() => {
    if (sourceObservation) {
      setTitle(observationTitle(sourceObservation.body));
      setDescription(`Source observation:\n"${sourceObservation.body}"`);
    }
    titleRef.current?.focus();
  }, [column.id, sourceObservation]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    onCreateCard(
      {
        title,
        description,
        priority,
        dueDate
      },
      tagIds,
      sourceObservation?.id
    );
  }

  function toggleTag(tagId: string) {
    setTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId]
    );
  }

  return (
    <aside className="detail-panel new-card-panel">
      <header className="detail-header">
        <div>
          <p className="eyebrow">
            New card in {column.name}
            {sourceObservation ? " from observation" : ""}
          </p>
          <h2>Create card</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close create card">
          <X size={18} />
        </button>
      </header>

      <form onSubmit={submit}>
        <label className="detail-section">
          Title
          <input
            ref={titleRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Card title"
          />
        </label>

        {sourceObservation ? (
          <section className="detail-section linked-source">
            <div className="section-heading">
              <h3>Source observation</h3>
              <span>{sourceObservation.label}</span>
            </div>
            <p>{sourceObservation.body}</p>
          </section>
        ) : null}

        <div className="detail-section grid-two">
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              {PRIORITIES.map((item) => (
                <option key={item || "none"} value={item}>
                  {item || "None"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
        </div>

        <label className="detail-section">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            placeholder="Add details, acceptance criteria, or context"
          />
        </label>

        {tags.length ? (
          <section className="detail-section">
            <div className="section-heading">
              <h3>Tags</h3>
              <span>{tagIds.length} selected</span>
            </div>
            <div className="tag-picker">
              {tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={tagIds.includes(tag.id) ? "tag-toggle active" : "tag-toggle"}
                  onClick={() => toggleTag(tag.id)}
                >
                  <span style={{ background: tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={!title.trim()}>
            Create card
          </button>
        </footer>
      </form>
    </aside>
  );
}

function DetailPanel({
  card,
  tags,
  observations,
  onClose,
  onUpdateCard,
  onCreateTag,
  onApplyTag,
  onRemoveTag,
  onLinkObservation,
  onUnlinkObservation,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onDeleteChecklistItem,
  onAddComment
}: {
  card: Card;
  tags: Tag[];
  observations: Observation[];
  onClose: () => void;
  onUpdateCard: (cardId: string, patch: { title?: string; description?: string; priority?: Priority; dueDate?: string }) => void;
  onCreateTag: (name: string, color: string) => void;
  onApplyTag: (cardId: string, tagId: string) => void;
  onRemoveTag: (cardId: string, tagId: string) => void;
  onLinkObservation: (cardId: string, observationId: string) => void;
  onUnlinkObservation: (cardId: string, observationId: string) => void;
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
  const [selectedObservationId, setSelectedObservationId] = useState("");
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    setTitle(card?.title ?? "");
    setDescription(card?.description ?? "");
    setPriority(card?.priority ?? "");
    setDueDate(card?.dueDate ?? "");
    setSelectedObservationId("");
    setNewChecklistItem("");
    setComment("");
  }, [card?.id, card?.updatedAt]);

  const activeCard = card;
  const appliedTagIds = new Set(activeCard.tags.map((tag) => tag.id));
  const linkedObservationIds = new Set(activeCard.observations.map((observation) => observation.id));
  const availableObservations = observations.filter((observation) => !linkedObservationIds.has(observation.id));

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

  function submitObservationLink(event: FormEvent) {
    event.preventDefault();
    if (!selectedObservationId) {
      return;
    }
    onLinkObservation(activeCard.id, selectedObservationId);
    setSelectedObservationId("");
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
          <h3>Linked observations</h3>
          <span>{activeCard.observations.length}</span>
        </div>
        {activeCard.observations.length ? (
          <div className="linked-observations">
            {activeCard.observations.map((observation) => (
              <article key={observation.id} className="linked-observation">
                <p>{observation.body}</p>
                <footer>
                  <span>{observation.label}</span>
                  <button
                    type="button"
                    className="icon-button quiet"
                    onClick={() => onUnlinkObservation(activeCard.id, observation.id)}
                    aria-label="Unlink observation"
                    title="Unlink observation"
                  >
                    <X size={15} />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-note">No observations linked yet.</p>
        )}
        {availableObservations.length ? (
          <form className="inline-form" onSubmit={submitObservationLink}>
            <select
              value={selectedObservationId}
              onChange={(event) => setSelectedObservationId(event.target.value)}
            >
              <option value="">Link observation...</option>
              {availableObservations.map((observation) => (
                <option key={observation.id} value={observation.id}>
                  {observation.label}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!selectedObservationId}>
              Link
            </button>
          </form>
        ) : null}
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

function PlanningPanel({
  documents,
  onClose,
  onCreateDocument,
  onUpdateDocument,
  onArchiveDocument
}: {
  documents: ProjectDocument[];
  onClose: () => void;
  onCreateDocument: (input: { title: string; body?: string }) => void;
  onUpdateDocument: (documentId: string, patch: { title?: string; body?: string }) => void;
  onArchiveDocument: (documentId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  const [newTitle, setNewTitle] = useState("");
  const selected = documents.find((document) => document.id === selectedId) ?? documents[0] ?? null;
  const [title, setTitle] = useState(selected?.title ?? "");
  const [body, setBody] = useState(selected?.body ?? "");

  useEffect(() => {
    if (selectedId && !documents.some((document) => document.id === selectedId)) {
      setSelectedId(documents[0]?.id ?? null);
    }
  }, [documents, selectedId]);

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setBody(selected?.body ?? "");
  }, [selected?.id, selected?.updatedAt]);

  function createDocument(event: FormEvent) {
    event.preventDefault();
    if (!newTitle.trim()) {
      return;
    }
    onCreateDocument({ title: newTitle, body: "" });
    setNewTitle("");
  }

  function saveTitle() {
    if (selected && title.trim() && title.trim() !== selected.title) {
      onUpdateDocument(selected.id, { title });
    } else if (selected) {
      setTitle(selected.title);
    }
  }

  function saveBody() {
    if (selected && body !== selected.body) {
      onUpdateDocument(selected.id, { body });
    }
  }

  return (
    <aside className="detail-panel planning-panel">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Project planning</p>
          <h2>Documents</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close planning">
          <X size={18} />
        </button>
      </header>

      <div className="planning-layout">
        <section className="planning-list">
          <form className="planning-create" onSubmit={createDocument}>
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="New document title"
            />
            <button type="submit" aria-label="Create planning document">
              <Plus size={16} />
            </button>
          </form>

          {documents.length ? (
            <div className="planning-doc-list">
              {documents.map((document) => (
                <button
                  type="button"
                  key={document.id}
                  className={document.id === selected?.id ? "planning-doc active" : "planning-doc"}
                  onClick={() => setSelectedId(document.id)}
                >
                  <strong>{document.title}</strong>
                  <time>{formatDateTime(document.updatedAt)}</time>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-note">No planning documents yet.</p>
          )}
        </section>

        <section className="planning-editor">
          {selected ? (
            <>
              <div className="planning-editor-header">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={saveTitle}
                  aria-label="Document title"
                />
                <button
                  type="button"
                  className="icon-button quiet"
                  onClick={() => onArchiveDocument(selected.id)}
                  aria-label="Archive planning document"
                  title="Archive document"
                >
                  <Archive size={15} />
                </button>
              </div>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onBlur={saveBody}
                rows={18}
                placeholder="Write project brief, specs, implementation notes, decisions, or references..."
              />
            </>
          ) : (
            <div className="planning-empty">
              <FileText size={28} />
              <p>Create a planning document to start capturing project context.</p>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function DesignAssetsPanel({
  assets,
  cards,
  documents,
  onClose,
  onImportAsset,
  onUpdateAsset,
  onArchiveAsset
}: {
  assets: DesignAsset[];
  cards: Card[];
  documents: ProjectDocument[];
  onClose: () => void;
  onImportAsset: () => void;
  onUpdateAsset: (
    assetId: string,
    patch: { displayName?: string; cardId?: string | null; documentId?: string | null }
  ) => void;
  onArchiveAsset: (assetId: string) => void;
}) {
  function saveName(asset: DesignAsset, value: string) {
    const nextName = value.trim();
    if (!nextName || nextName === asset.displayName) {
      return;
    }
    onUpdateAsset(asset.id, { displayName: nextName });
  }

  return (
    <aside className="detail-panel design-assets-panel">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Project design</p>
          <h2>Assets</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close design assets">
          <X size={18} />
        </button>
      </header>

      <section className="design-assets-toolbar">
        <button type="button" className="secondary-button" onClick={onImportAsset}>
          <Plus size={16} />
          Add image
        </button>
      </section>

      {assets.length ? (
        <div className="asset-grid">
          {assets.map((asset) => (
            <article key={asset.id} className="asset-item">
              <div className="asset-preview">
                <img src={asset.fileUrl} alt={asset.displayName} />
              </div>
              <div className="asset-fields">
                <input
                  defaultValue={asset.displayName}
                  onBlur={(event) => {
                    if (!event.currentTarget.value.trim()) {
                      event.currentTarget.value = asset.displayName;
                      return;
                    }
                    saveName(asset, event.currentTarget.value);
                  }}
                  aria-label="Asset name"
                />
                <select
                  value={asset.cardId ?? ""}
                  onChange={(event) => onUpdateAsset(asset.id, { cardId: event.target.value || null })}
                  aria-label="Linked card"
                >
                  <option value="">No card link</option>
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.title}
                    </option>
                  ))}
                </select>
                <select
                  value={asset.documentId ?? ""}
                  onChange={(event) => onUpdateAsset(asset.id, { documentId: event.target.value || null })}
                  aria-label="Linked planning document"
                >
                  <option value="">No document link</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </select>
              </div>
              <footer className="asset-footer">
                <span>{formatDateTime(asset.createdAt)}</span>
                <button
                  type="button"
                  className="icon-button quiet"
                  onClick={() => onArchiveAsset(asset.id)}
                  aria-label={`Archive ${asset.displayName}`}
                  title="Archive asset"
                >
                  <Archive size={15} />
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="planning-empty design-assets-empty">
          <ImageIcon size={30} />
          <p>Add screenshots, mockups, or UI references for this project.</p>
        </div>
      )}
    </aside>
  );
}

function ObservationsPanel({
  observations,
  onClose,
  onCreateObservation,
  onArchiveObservation,
  onCreateCardFromObservation
}: {
  observations: Observation[];
  onClose: () => void;
  onCreateObservation: (body: string) => void;
  onArchiveObservation: (observationId: string) => void;
  onCreateCardFromObservation: (observation: Observation) => void;
}) {
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<ObservationFilter>("active");
  const filteredObservations = observations.filter((observation) =>
    filter === "all" ? true : observation.status === filter
  );
  const counts = {
    all: observations.length,
    active: observations.filter((observation) => observation.status === "active").length,
    converted: observations.filter((observation) => observation.status === "converted").length,
    resolved: observations.filter((observation) => observation.status === "resolved").length
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      return;
    }
    onCreateObservation(body);
    setBody("");
  }

  return (
    <aside className="detail-panel observations-panel">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Product notes</p>
          <h2>Observations</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close observations">
          <X size={18} />
        </button>
      </header>

      <section className="detail-section observation-intro">
        <p>
          Capture raw observations one at a time. They can become bugs, feature requests, or user
          stories later.
        </p>
        <form className="observation-form" onSubmit={submit}>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            placeholder="Example: Dragging feels too abrupt when moving cards between columns."
            autoFocus
          />
          <button type="submit">Add observation</button>
        </form>
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <h3>Captured</h3>
          <span>{filteredObservations.length}/{observations.length}</span>
        </div>
        <div className="observation-filter">
          {(["active", "converted", "resolved", "all"] as ObservationFilter[]).map((item) => (
            <button
              type="button"
              key={item}
              className={filter === item ? "filter-chip active" : "filter-chip"}
              onClick={() => setFilter(item)}
            >
              {observationFilterLabel(item)} {counts[item]}
            </button>
          ))}
        </div>
        {filteredObservations.length ? (
          <div className="observation-list">
            {filteredObservations.map((observation) => (
              <article key={observation.id} className="observation-item">
                <p>{observation.body}</p>
                <div className="observation-meta">
                  <span className={`status-pill ${observation.status}`}>{observation.status}</span>
                  <span>{observation.source || "Project Board"}</span>
                  {observation.projectPath ? <span>{observation.projectPath}</span> : null}
                  <span>{observation.kind || "observation"}</span>
                </div>
                <footer>
                  <time>{formatDateTime(observation.createdAt)}</time>
                  <div className="observation-actions">
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => onCreateCardFromObservation(observation)}
                    >
                      Create card
                    </button>
                    <button
                      type="button"
                      className="icon-button quiet"
                      onClick={() => onArchiveObservation(observation.id)}
                      aria-label="Archive observation"
                      title="Archive observation"
                    >
                      <Archive size={15} />
                    </button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-note">No {filter === "all" ? "" : `${filter} `}observations.</p>
        )}
      </section>
    </aside>
  );
}

function findCardLocation(columns: BoardColumn[], cardId: string) {
  for (const column of columns) {
    const index = column.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return { column, index, card: column.cards[index] };
    }
  }
  return null;
}

function moveCardPreview(columns: BoardColumn[], cardId: string, overId: string): BoardColumn[] {
  if (cardId === overId) {
    return columns;
  }

  const sourceLocation = findCardLocation(columns, cardId);
  if (!sourceLocation) {
    return columns;
  }

  let targetColumnId: string | null = null;
  let targetIndex = 0;

  if (overId.startsWith("column:")) {
    targetColumnId = overId.slice("column:".length);
    targetIndex = columns.find((column) => column.id === targetColumnId)?.cards.length ?? 0;
  } else {
    const targetLocation = findCardLocation(columns, overId);
    if (!targetLocation) {
      return columns;
    }
    targetColumnId = targetLocation.column.id;
    targetIndex = targetLocation.index;
  }

  if (
    !targetColumnId ||
    (sourceLocation.column.id === targetColumnId && sourceLocation.index === targetIndex)
  ) {
    return columns;
  }

  const nextColumns = columns.map((column) => ({
    ...column,
    cards: [...column.cards]
  }));
  const sourceColumn = nextColumns.find((column) => column.id === sourceLocation.column.id);
  const targetColumn = nextColumns.find((column) => column.id === targetColumnId);

  if (!sourceColumn || !targetColumn) {
    return columns;
  }

  const [movingCard] = sourceColumn.cards.splice(sourceLocation.index, 1);
  if (!movingCard) {
    return columns;
  }

  const safeTargetIndex = Math.max(0, Math.min(targetIndex, targetColumn.cards.length));
  targetColumn.cards.splice(safeTargetIndex, 0, {
    ...movingCard,
    columnId: targetColumn.id
  });

  return nextColumns;
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
    ...card.observations.map((observation) => observation.body),
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

function observationTitle(body: string): string {
  const cleaned = body.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 72) {
    return cleaned || "Observation";
  }
  return `${cleaned.slice(0, 69)}...`;
}

function observationFilterLabel(filter: ObservationFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "active":
      return "Active";
    case "converted":
      return "Converted";
    case "resolved":
      return "Resolved";
  }
}

function isCodeObservationTag(name: string): boolean {
  return /^Obs: [0-9a-f]{8}$/i.test(name.trim());
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
