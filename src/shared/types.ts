export type Priority = "Low" | "Medium" | "High" | "Urgent" | "";

export type TemplateId =
  | "general"
  | "client_pipeline"
  | "software_build"
  | "content"
  | "admin";

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
  activeCardCount: number;
}

export interface Board {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  projectId: string;
  name: string;
  color: string;
  description: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  cardId: string;
  text: string;
  isComplete: boolean;
  position: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardComment {
  id: string;
  cardId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  cardId: string | null;
  eventType: string;
  summary: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface Card {
  id: string;
  projectId: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  position: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
  checklist: ChecklistItem[];
  comments: CardComment[];
  activity: ActivityEvent[];
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  position: string;
  color: string;
  isCompletionColumn: boolean;
  collapsed: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  cards: Card[];
}

export interface BoardState {
  project: Project;
  board: Board;
  columns: BoardColumn[];
  tags: Tag[];
  recentActivity: ActivityEvent[];
}

export interface AppSnapshot {
  workspace: Workspace;
  projects: Project[];
  activeProjectId: string | null;
  board: BoardState | null;
  dataLocation: string;
  backupLocation: string;
  templates: BoardTemplate[];
}

export interface BoardTemplate {
  id: TemplateId;
  name: string;
  columns: string[];
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  templateId?: TemplateId;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface CreateColumnInput {
  name: string;
  color?: string;
  isCompletionColumn?: boolean;
}

export interface UpdateColumnInput {
  name?: string;
  color?: string;
  collapsed?: boolean;
  isCompletionColumn?: boolean;
}

export interface CreateCardInput {
  title: string;
  description?: string;
  priority?: Priority;
  dueDate?: string;
}

export interface UpdateCardInput {
  title?: string;
  description?: string;
  priority?: Priority;
  dueDate?: string;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  description?: string;
}

export interface UpdateChecklistItemInput {
  text?: string;
  isComplete?: boolean;
}

export interface BackupResult {
  path: string;
  createdAt: string;
}

export interface ProjectBoardApi {
  getSnapshot(projectId?: string): Promise<AppSnapshot>;
  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(projectId: string, patch: UpdateProjectInput): Promise<Project>;
  archiveProject(projectId: string): Promise<void>;
  createColumn(boardId: string, input: CreateColumnInput): Promise<BoardColumn>;
  updateColumn(columnId: string, patch: UpdateColumnInput): Promise<BoardColumn>;
  archiveColumn(columnId: string): Promise<void>;
  createCard(columnId: string, input: CreateCardInput): Promise<Card>;
  updateCard(cardId: string, patch: UpdateCardInput): Promise<Card>;
  moveCard(cardId: string, targetColumnId: string, targetIndex: number): Promise<Card>;
  duplicateCard(cardId: string): Promise<Card>;
  archiveCard(cardId: string): Promise<void>;
  createTag(projectId: string, input: CreateTagInput): Promise<Tag>;
  applyTag(cardId: string, tagId: string): Promise<void>;
  removeTag(cardId: string, tagId: string): Promise<void>;
  addChecklistItem(cardId: string, text: string): Promise<ChecklistItem>;
  updateChecklistItem(itemId: string, patch: UpdateChecklistItemInput): Promise<ChecklistItem>;
  deleteChecklistItem(itemId: string): Promise<void>;
  addComment(cardId: string, body: string): Promise<CardComment>;
  createBackup(): Promise<BackupResult>;
  openDataFolder(): Promise<void>;
}

