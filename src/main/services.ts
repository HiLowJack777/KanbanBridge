import { dialog, shell } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ActivityEvent,
  AppSnapshot,
  BackupResult,
  Board,
  BoardColumn,
  BoardState,
  BoardTemplate,
  Card,
  CardComment,
  ChecklistItem,
  CreateCardInput,
  CreateColumnInput,
  CreateObservationInput,
  CreateProjectInput,
  CreateProjectDocumentInput,
  CreateTagInput,
  DesignAsset,
  Observation,
  Priority,
  Project,
  ProjectDocument,
  Tag,
  TemplateId,
  UpdateCardInput,
  UpdateChecklistItemInput,
  UpdateColumnInput,
  UpdateDesignAssetInput,
  UpdateProjectDocumentInput,
  UpdateProjectInput,
  Workspace
} from "../shared/types";
import { LocalDatabase } from "./database";

type Row = Record<string, unknown>;

const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "general",
    name: "General Project Board",
    columns: ["Backlog", "To Do", "In Progress", "Blocked", "Review", "Done"]
  },
  {
    id: "client_pipeline",
    name: "Client Lead Pipeline",
    columns: [
      "New Lead",
      "Info Needed",
      "Estimate Scheduled",
      "Estimate Sent",
      "Won",
      "Scheduled",
      "In Progress",
      "Complete",
      "Lost"
    ]
  },
  {
    id: "software_build",
    name: "Software Build Board",
    columns: ["Ideas", "Backlog", "Ready", "Building", "Testing", "Fixing", "Done"]
  },
  {
    id: "content",
    name: "Content Board",
    columns: ["Ideas", "Drafting", "Editing", "Ready to Publish", "Published", "Archived"]
  },
  {
    id: "admin",
    name: "Administrative Board",
    columns: ["Inbox", "Next", "Waiting", "Scheduled", "Done"]
  }
];

const DEFAULT_TAG_COLORS = ["#0f766e", "#2563eb", "#b45309", "#be123c", "#64748b"];

function now(): string {
  return new Date().toISOString();
}

function positionForIndex(index: number): string {
  return String((index + 1) * 1000).padStart(8, "0");
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBool(value: unknown): boolean {
  return Number(value) === 1;
}

function cleanTitle(title: string, label: string): string {
  const cleaned = title.trim();
  if (!cleaned) {
    throw new Error(`${label} is required.`);
  }
  return cleaned;
}

function getTemplate(templateId?: TemplateId): BoardTemplate {
  return BOARD_TEMPLATES.find((template) => template.id === templateId) ?? BOARD_TEMPLATES[0];
}

export class ProjectBoardService {
  constructor(private readonly database: LocalDatabase) {}

  async getSnapshot(projectId?: string): Promise<AppSnapshot> {
    await this.ingestAgentInbox();
    await this.ensureStarterProject();

    const workspace = this.getWorkspace();
    const projects = this.listProjects();
    const activeProjectId =
      projectId && projects.some((project) => project.id === projectId)
        ? projectId
        : projects[0]?.id ?? null;

    return {
      workspace,
      projects,
      activeProjectId,
      board: activeProjectId ? this.getBoard(activeProjectId) : null,
      dataLocation: this.database.dataPath,
      backupLocation: this.database.backupDir,
      templates: BOARD_TEMPLATES,
      observations: this.listObservations({
        projectId: activeProjectId,
        workspaceId: workspace.id
      })
    };
  }

  async createObservation(input: CreateObservationInput): Promise<Observation> {
    return this.database.write(() => {
      const cleaned = input.body.trim();
      if (!cleaned) {
        throw new Error("Observation is required.");
      }

      const id = randomUUID();
      const timestamp = now();
      const scope = this.resolveObservationScope(input);
      this.database.run(
        `
          INSERT INTO observations (
            id, workspace_id, project_id, body, source, project_path, kind,
            archived_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `,
        [
          id,
          scope.workspaceId,
          scope.projectId,
          cleaned,
          input.source?.trim() || "Project Board",
          input.projectPath?.trim() || "",
          input.kind?.trim() || "observation",
          timestamp,
          timestamp
        ]
      );
      return this.requireObservation(id);
    });
  }

  async archiveObservation(observationId: string): Promise<void> {
    await this.database.write(() => {
      const timestamp = now();
      this.database.run(
        "UPDATE observations SET archived_at = ?, updated_at = ? WHERE id = ?",
        [timestamp, timestamp, observationId]
      );
    });
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.database.write(() => this.createProjectSync(input));
  }

  async updateProject(projectId: string, patch: UpdateProjectInput): Promise<Project> {
    return this.database.write(() => {
      const existing = this.requireProject(projectId);
      const updates: string[] = [];
      const values: (string | null)[] = [];

      if (patch.name !== undefined) {
        updates.push("name = ?");
        values.push(cleanTitle(patch.name, "Project name"));
      }

      if (patch.description !== undefined) {
        updates.push("description = ?");
        values.push(patch.description.trim());
      }

      if (patch.color !== undefined) {
        updates.push("color = ?");
        values.push(patch.color);
      }

      if (patch.icon !== undefined) {
        updates.push("icon = ?");
        values.push(patch.icon);
      }

      if (!updates.length) {
        return existing;
      }

      updates.push("updated_at = ?");
      values.push(now());
      values.push(projectId);

      this.database.run(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, values);
      this.recordActivity(existing.id, null, "project.updated", "Project updated");
      return this.requireProject(projectId);
    });
  }

  async archiveProject(projectId: string): Promise<void> {
    await this.database.write(() => {
      const timestamp = now();
      this.database.run("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?", [
        timestamp,
        timestamp,
        projectId
      ]);
      this.recordActivity(projectId, null, "project.archived", "Project archived");
    });
  }

  async createColumn(boardId: string, input: CreateColumnInput): Promise<BoardColumn> {
    return this.database.write(() => {
      const board = this.requireBoard(boardId);
      const timestamp = now();
      const id = randomUUID();
      const count = this.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM columns WHERE board_id = ? AND archived_at IS NULL",
        [boardId]
      )?.count ?? 0;

      this.database.run(
        `
          INSERT INTO columns (
            id, board_id, name, position, color, is_completion_column,
            collapsed, archived_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
        `,
        [
          id,
          boardId,
          cleanTitle(input.name, "Column name"),
          positionForIndex(Number(count)),
          input.color ?? "#e5e7eb",
          input.isCompletionColumn ? 1 : 0,
          timestamp,
          timestamp
        ]
      );

      this.recordActivity(board.projectId, null, "column.created", `Column "${input.name}" created`);
      return this.requireColumn(id);
    });
  }

  async updateColumn(columnId: string, patch: UpdateColumnInput): Promise<BoardColumn> {
    return this.database.write(() => {
      const existing = this.requireColumn(columnId);
      const updates: string[] = [];
      const values: (string | number)[] = [];

      if (patch.name !== undefined) {
        updates.push("name = ?");
        values.push(cleanTitle(patch.name, "Column name"));
      }

      if (patch.color !== undefined) {
        updates.push("color = ?");
        values.push(patch.color);
      }

      if (patch.collapsed !== undefined) {
        updates.push("collapsed = ?");
        values.push(patch.collapsed ? 1 : 0);
      }

      if (patch.isCompletionColumn !== undefined) {
        updates.push("is_completion_column = ?");
        values.push(patch.isCompletionColumn ? 1 : 0);
      }

      if (!updates.length) {
        return existing;
      }

      updates.push("updated_at = ?");
      values.push(now());
      values.push(columnId);
      this.database.run(`UPDATE columns SET ${updates.join(", ")} WHERE id = ?`, values);

      const board = this.requireBoard(existing.boardId);
      this.recordActivity(board.projectId, null, "column.updated", `Column "${existing.name}" updated`);
      return this.requireColumn(columnId);
    });
  }

  async archiveColumn(columnId: string): Promise<void> {
    await this.database.write(() => {
      const column = this.requireColumn(columnId);
      const activeCards = this.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM cards WHERE column_id = ? AND archived_at IS NULL",
        [columnId]
      )?.count ?? 0;

      if (Number(activeCards) > 0) {
        throw new Error("Move or archive the cards in this column before archiving it.");
      }

      const timestamp = now();
      this.database.run("UPDATE columns SET archived_at = ?, updated_at = ? WHERE id = ?", [
        timestamp,
        timestamp,
        columnId
      ]);

      const board = this.requireBoard(column.boardId);
      this.recordActivity(board.projectId, null, "column.archived", `Column "${column.name}" archived`);
    });
  }

  async createCard(columnId: string, input: CreateCardInput): Promise<Card> {
    return this.database.write(() => this.createCardSync(columnId, input));
  }

  async updateCard(cardId: string, patch: UpdateCardInput): Promise<Card> {
    return this.database.write(() => {
      const existing = this.requireCard(cardId);
      const updates: string[] = [];
      const values: (string | null)[] = [];
      const summaries: string[] = [];

      if (patch.title !== undefined && patch.title.trim() !== existing.title) {
        updates.push("title = ?");
        values.push(cleanTitle(patch.title, "Card title"));
        summaries.push("title changed");
      }

      if (patch.description !== undefined && patch.description !== existing.description) {
        updates.push("description = ?");
        values.push(patch.description);
        summaries.push("description changed");
      }

      if (patch.priority !== undefined && patch.priority !== existing.priority) {
        updates.push("priority = ?");
        values.push(patch.priority || null);
        summaries.push("priority changed");
      }

      if (patch.dueDate !== undefined && patch.dueDate !== existing.dueDate) {
        updates.push("due_date = ?");
        values.push(patch.dueDate || null);
        summaries.push("due date changed");
      }

      if (!updates.length) {
        return existing;
      }

      updates.push("updated_at = ?");
      values.push(now());
      values.push(cardId);
      this.database.run(`UPDATE cards SET ${updates.join(", ")} WHERE id = ?`, values);
      this.recordActivity(existing.projectId, existing.id, "card.updated", `Card ${summaries.join(", ")}`);
      return this.requireCard(cardId);
    });
  }

  async moveCard(cardId: string, targetColumnId: string, targetIndex: number): Promise<Card> {
    return this.database.write(() => {
      const card = this.requireCard(cardId);
      const targetColumn = this.requireColumn(targetColumnId);

      if (card.boardId !== targetColumn.boardId) {
        throw new Error("Cards can only move within the same board.");
      }

      const sourceCards = this.listCardsForColumn(card.columnId)
        .filter((item) => item.id !== cardId)
        .map((item) => item.id);
      const targetCards =
        card.columnId === targetColumnId
          ? sourceCards
          : this.listCardsForColumn(targetColumnId).map((item) => item.id);

      const safeIndex = Math.max(0, Math.min(targetIndex, targetCards.length));
      targetCards.splice(safeIndex, 0, cardId);

      if (card.columnId !== targetColumnId) {
        this.rewriteCardOrder(card.columnId, sourceCards, card.columnId);
      }

      this.rewriteCardOrder(targetColumnId, targetCards, targetColumnId);

      this.recordActivity(
        card.projectId,
        card.id,
        "card.moved",
        card.columnId === targetColumnId
          ? `Card "${card.title}" reordered`
          : `Card "${card.title}" moved to ${targetColumn.name}`
      );

      return this.requireCard(cardId);
    });
  }

  async duplicateCard(cardId: string): Promise<Card> {
    return this.database.write(() => {
      const card = this.requireCard(cardId);
      const duplicate = this.createCardSync(card.columnId, {
        title: `${card.title} copy`,
        description: card.description,
        priority: card.priority,
        dueDate: card.dueDate
      });

      for (const tag of card.tags) {
        this.applyTagSync(duplicate.id, tag.id);
      }

      for (const item of card.checklist) {
        const copied = this.addChecklistItemSync(duplicate.id, item.text);
        if (item.isComplete) {
          this.updateChecklistItemSync(copied.id, { isComplete: true });
        }
      }

      this.recordActivity(card.projectId, duplicate.id, "card.duplicated", `Card duplicated from "${card.title}"`);
      return this.requireCard(duplicate.id);
    });
  }

  async archiveCard(cardId: string): Promise<void> {
    await this.database.write(() => {
      const card = this.requireCard(cardId);
      const timestamp = now();
      this.database.run("UPDATE cards SET archived_at = ?, updated_at = ? WHERE id = ?", [
        timestamp,
        timestamp,
        cardId
      ]);
      this.recordActivity(card.projectId, card.id, "card.archived", `Card "${card.title}" archived`);
    });
  }

  async createTag(projectId: string, input: CreateTagInput): Promise<Tag> {
    return this.database.write(() => this.createTagSync(projectId, input));
  }

  async applyTag(cardId: string, tagId: string): Promise<void> {
    await this.database.write(() => this.applyTagSync(cardId, tagId));
  }

  async removeTag(cardId: string, tagId: string): Promise<void> {
    await this.database.write(() => {
      const card = this.requireCard(cardId);
      const tag = this.requireTag(tagId);
      this.database.run("DELETE FROM card_tags WHERE card_id = ? AND tag_id = ?", [cardId, tagId]);
      this.recordActivity(card.projectId, card.id, "tag.removed", `Tag "${tag.name}" removed`);
    });
  }

  async createProjectDocument(
    projectId: string,
    input: CreateProjectDocumentInput
  ): Promise<ProjectDocument> {
    return this.database.write(() => {
      this.requireProject(projectId);
      const id = randomUUID();
      const timestamp = now();
      this.database.run(
        `
          INSERT INTO project_documents (
            id, project_id, title, body, archived_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, NULL, ?, ?)
        `,
        [
          id,
          projectId,
          cleanTitle(input.title, "Document title"),
          input.body ?? "",
          timestamp,
          timestamp
        ]
      );
      this.recordActivity(projectId, null, "document.created", `Planning document "${input.title}" created`);
      return this.requireProjectDocument(id);
    });
  }

  async updateProjectDocument(
    documentId: string,
    patch: UpdateProjectDocumentInput
  ): Promise<ProjectDocument> {
    return this.database.write(() => {
      const existing = this.requireProjectDocument(documentId);
      const updates: string[] = [];
      const values: string[] = [];

      if (patch.title !== undefined && patch.title.trim() !== existing.title) {
        updates.push("title = ?");
        values.push(cleanTitle(patch.title, "Document title"));
      }

      if (patch.body !== undefined && patch.body !== existing.body) {
        updates.push("body = ?");
        values.push(patch.body);
      }

      if (!updates.length) {
        return existing;
      }

      updates.push("updated_at = ?");
      values.push(now());
      values.push(documentId);
      this.database.run(`UPDATE project_documents SET ${updates.join(", ")} WHERE id = ?`, values);
      this.recordActivity(existing.projectId, null, "document.updated", `Planning document "${existing.title}" updated`);
      return this.requireProjectDocument(documentId);
    });
  }

  async archiveProjectDocument(documentId: string): Promise<void> {
    await this.database.write(() => {
      const document = this.requireProjectDocument(documentId);
      const timestamp = now();
      this.database.run("UPDATE project_documents SET archived_at = ?, updated_at = ? WHERE id = ?", [
        timestamp,
        timestamp,
        documentId
      ]);
      this.recordActivity(document.projectId, null, "document.archived", `Planning document "${document.title}" archived`);
    });
  }

  async importDesignAsset(projectId: string): Promise<DesignAsset | null> {
    this.requireProject(projectId);

    const result = await dialog.showOpenDialog({
      title: "Import design image",
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]
        }
      ]
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const sourcePath = result.filePaths[0];
    const id = randomUUID();
    const assetDir = path.join(this.database.dataDir, "design-assets", projectId);
    const extension = path.extname(sourcePath).toLowerCase() || ".asset";
    const destinationPath = path.join(assetDir, `${id}${extension}`);

    await fs.mkdir(assetDir, { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);

    return this.database.write(() => {
      this.requireProject(projectId);
      const timestamp = now();
      const displayName = path.basename(sourcePath);
      this.database.run(
        `
          INSERT INTO design_assets (
            id, project_id, card_id, document_id, display_name, file_path,
            original_path, mime_type, archived_at, created_at, updated_at
          ) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?)
        `,
        [
          id,
          projectId,
          displayName,
          destinationPath,
          sourcePath,
          mimeTypeForFile(sourcePath),
          timestamp,
          timestamp
        ]
      );
      this.recordActivity(projectId, null, "design_asset.imported", `Design asset "${displayName}" imported`);
      return this.requireDesignAsset(id);
    });
  }

  async updateDesignAsset(
    assetId: string,
    patch: UpdateDesignAssetInput
  ): Promise<DesignAsset> {
    return this.database.write(() => {
      const existing = this.requireDesignAsset(assetId);
      const updates: string[] = [];
      const values: (string | null)[] = [];

      if (patch.displayName !== undefined && patch.displayName.trim() !== existing.displayName) {
        updates.push("display_name = ?");
        values.push(cleanTitle(patch.displayName, "Asset name"));
      }

      if (patch.cardId !== undefined && patch.cardId !== existing.cardId) {
        if (patch.cardId) {
          const card = this.requireCard(patch.cardId);
          if (card.projectId !== existing.projectId) {
            throw new Error("Design assets can only be linked to cards in the same project.");
          }
        }
        updates.push("card_id = ?");
        values.push(patch.cardId || null);
      }

      if (patch.documentId !== undefined && patch.documentId !== existing.documentId) {
        if (patch.documentId) {
          const document = this.requireProjectDocument(patch.documentId);
          if (document.projectId !== existing.projectId) {
            throw new Error("Design assets can only be linked to documents in the same project.");
          }
        }
        updates.push("document_id = ?");
        values.push(patch.documentId || null);
      }

      if (!updates.length) {
        return existing;
      }

      updates.push("updated_at = ?");
      values.push(now());
      values.push(assetId);
      this.database.run(`UPDATE design_assets SET ${updates.join(", ")} WHERE id = ?`, values);
      this.recordActivity(existing.projectId, null, "design_asset.updated", `Design asset "${existing.displayName}" updated`);
      return this.requireDesignAsset(assetId);
    });
  }

  async archiveDesignAsset(assetId: string): Promise<void> {
    await this.database.write(() => {
      const asset = this.requireDesignAsset(assetId);
      const timestamp = now();
      this.database.run("UPDATE design_assets SET archived_at = ?, updated_at = ? WHERE id = ?", [
        timestamp,
        timestamp,
        assetId
      ]);
      this.recordActivity(asset.projectId, null, "design_asset.archived", `Design asset "${asset.displayName}" archived`);
    });
  }

  async linkObservationToCard(cardId: string, observationId: string): Promise<void> {
    await this.database.write(() => {
      const card = this.requireCard(cardId);
      const observation = this.requireObservation(observationId);
      this.database.run(
        "INSERT OR IGNORE INTO card_observations (card_id, observation_id, created_at) VALUES (?, ?, ?)",
        [cardId, observationId, now()]
      );
      this.database.run(
        `
          UPDATE observations
          SET project_id = COALESCE(project_id, ?),
              workspace_id = COALESCE(workspace_id, ?),
              updated_at = ?
          WHERE id = ?
        `,
        [card.projectId, this.requireProject(card.projectId).workspaceId, now(), observationId]
      );
      this.recordActivity(card.projectId, card.id, "observation.linked", `Observation linked: ${observation.body}`);
    });
  }

  async unlinkObservationFromCard(cardId: string, observationId: string): Promise<void> {
    await this.database.write(() => {
      const card = this.requireCard(cardId);
      const observation = this.requireObservation(observationId);
      this.database.run("DELETE FROM card_observations WHERE card_id = ? AND observation_id = ?", [
        cardId,
        observationId
      ]);
      this.recordActivity(card.projectId, card.id, "observation.unlinked", `Observation unlinked: ${observation.body}`);
    });
  }

  async addChecklistItem(cardId: string, text: string): Promise<ChecklistItem> {
    return this.database.write(() => this.addChecklistItemSync(cardId, text));
  }

  async updateChecklistItem(
    itemId: string,
    patch: UpdateChecklistItemInput
  ): Promise<ChecklistItem> {
    return this.database.write(() => this.updateChecklistItemSync(itemId, patch));
  }

  async deleteChecklistItem(itemId: string): Promise<void> {
    await this.database.write(() => {
      const item = this.requireChecklistItem(itemId);
      const card = this.requireCard(item.cardId);
      this.database.run("DELETE FROM checklist_items WHERE id = ?", [itemId]);
      this.recordActivity(card.projectId, card.id, "checklist.deleted", `Checklist item "${item.text}" deleted`);
    });
  }

  async addComment(cardId: string, body: string): Promise<CardComment> {
    return this.database.write(() => {
      const cleaned = body.trim();
      if (!cleaned) {
        throw new Error("Comment body is required.");
      }

      const card = this.requireCard(cardId);
      const id = randomUUID();
      const timestamp = now();
      this.database.run(
        "INSERT INTO comments (id, card_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [id, cardId, cleaned, timestamp, timestamp]
      );
      this.database.run("UPDATE cards SET updated_at = ? WHERE id = ?", [timestamp, cardId]);
      this.recordActivity(card.projectId, card.id, "comment.added", "Comment added");
      return this.requireComment(id);
    });
  }

  async createBackup(): Promise<BackupResult> {
    const createdAt = now();
    const backupPath = await this.database.createManualBackup();
    return { path: backupPath, createdAt };
  }

  async openDataFolder(): Promise<void> {
    await shell.openPath(this.database.dataDir);
  }

  private resolveObservationScope(input: CreateObservationInput): {
    workspaceId: string | null;
    projectId: string | null;
  } {
    const projectId = input.projectId?.trim();
    if (projectId) {
      const project = this.requireProject(projectId);
      return { workspaceId: project.workspaceId, projectId: project.id };
    }

    const workspaceId = input.workspaceId?.trim() || this.getWorkspace().id;
    return { workspaceId, projectId: null };
  }

  private async ingestAgentInbox(): Promise<void> {
    let raw = "";

    try {
      raw = await fs.readFile(this.database.agentInboxPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    const inputs = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CreateObservationInput)
      .filter((input) => input.body?.trim());

    if (!inputs.length) {
      await fs.writeFile(this.database.agentInboxPath, "", "utf-8");
      return;
    }

    await this.database.write(() => {
      for (const input of inputs) {
        const timestamp = now();
        const scope = this.resolveObservationScope(input);
        this.database.run(
          `
            INSERT INTO observations (
              id, workspace_id, project_id, body, source, project_path, kind,
              archived_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `,
          [
            randomUUID(),
            scope.workspaceId,
            scope.projectId,
            input.body.trim(),
            input.source?.trim() || "Agent",
            input.projectPath?.trim() || "",
            input.kind?.trim() || "observation",
            timestamp,
            timestamp
          ]
        );
      }
    });
    await fs.writeFile(this.database.agentInboxPath, "", "utf-8");
  }

  private async ensureStarterProject(): Promise<void> {
    const count =
      this.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM projects WHERE archived_at IS NULL"
      )?.count ?? 0;

    if (Number(count) > 0) {
      return;
    }

    await this.database.write(() => {
      const project = this.createProjectSync({
        name: "Welcome Project",
        description: "A small starter board for learning the app.",
        color: "#0f766e",
        icon: "Board",
        templateId: "general"
      });
      const board = this.requireDefaultBoard(project.id);
      const columns = this.listColumnsForBoard(board.id);
      const backlog = columns.find((column) => column.name === "Backlog") ?? columns[0];
      const inProgress = columns.find((column) => column.name === "In Progress") ?? columns[0];
      const review = columns.find((column) => column.name === "Review") ?? columns[0];
      const tag = this.createTagSync(project.id, {
        name: "Starter",
        color: "#0f766e",
        description: "Sample cards created with the first workspace."
      });

      const first = this.createCardSync(backlog.id, {
        title: "Create your first real project",
        description: "Use the project button in the sidebar, pick a starter template, and this board becomes your home base.",
        priority: "High"
      });
      this.applyTagSync(first.id, tag.id);
      this.addChecklistItemSync(first.id, "Choose a template");
      this.addChecklistItemSync(first.id, "Add a few cards");
      this.addChecklistItemSync(first.id, "Drag work through the columns");

      this.createCardSync(inProgress.id, {
        title: "Open a card to edit details",
        description: "The detail panel supports title, description, priority, due date, tags, checklist items, and comments.",
        priority: "Medium"
      });

      this.createCardSync(review.id, {
        title: "Run a manual backup from the top bar",
        description: "Backups copy the local SQLite database into the manual backup folder.",
        priority: "Low"
      });
    });
  }

  private createProjectSync(input: CreateProjectInput): Project {
    const workspace = this.getWorkspace();
    const template = getTemplate(input.templateId);
    const timestamp = now();
    const projectId = randomUUID();
    const boardId = randomUUID();
    const projectName = cleanTitle(input.name, "Project name");

    this.database.run(
      `
        INSERT INTO projects (
          id, workspace_id, name, description, color, icon, archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `,
      [
        projectId,
        workspace.id,
        projectName,
        input.description?.trim() ?? "",
        input.color ?? "#0f766e",
        input.icon ?? "Board",
        timestamp,
        timestamp
      ]
    );

    this.database.run(
      "INSERT INTO boards (id, project_id, name, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      [boardId, projectId, `${projectName} Board`, timestamp, timestamp]
    );

    template.columns.forEach((columnName, index) => {
      const lower = columnName.toLowerCase();
      const complete = ["done", "complete", "published", "archived"].some((word) => lower.includes(word));
      this.database.run(
        `
          INSERT INTO columns (
            id, board_id, name, position, color, is_completion_column,
            collapsed, archived_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
        `,
        [
          randomUUID(),
          boardId,
          columnName,
          positionForIndex(index),
          "#e5e7eb",
          complete ? 1 : 0,
          timestamp,
          timestamp
        ]
      );
    });

    this.recordActivity(projectId, null, "project.created", `Project "${projectName}" created`);
    return this.requireProject(projectId);
  }

  private createCardSync(columnId: string, input: CreateCardInput): Card {
    const column = this.requireColumn(columnId);
    const board = this.requireBoard(column.boardId);
    const timestamp = now();
    const id = randomUUID();
    const count =
      this.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM cards WHERE column_id = ? AND archived_at IS NULL",
        [columnId]
      )?.count ?? 0;

    this.database.run(
      `
        INSERT INTO cards (
          id, project_id, board_id, column_id, title, description, priority,
          due_date, position, archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `,
      [
        id,
        board.projectId,
        board.id,
        columnId,
        cleanTitle(input.title, "Card title"),
        input.description ?? "",
        input.priority || null,
        input.dueDate || null,
        positionForIndex(Number(count)),
        timestamp,
        timestamp
      ]
    );

    this.recordActivity(board.projectId, id, "card.created", `Card "${input.title}" created`);
    return this.requireCard(id);
  }

  private createTagSync(projectId: string, input: CreateTagInput): Tag {
    this.requireProject(projectId);
    const existing = this.database.get<Row>(
      "SELECT * FROM tags WHERE project_id = ? AND lower(name) = lower(?) AND archived_at IS NULL",
      [projectId, input.name.trim()]
    );

    if (existing) {
      return this.mapTag(existing);
    }

    const timestamp = now();
    const id = randomUUID();
    const tagCount =
      this.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM tags WHERE project_id = ?",
        [projectId]
      )?.count ?? 0;

    this.database.run(
      `
        INSERT INTO tags (
          id, project_id, name, color, description, archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `,
      [
        id,
        projectId,
        cleanTitle(input.name, "Tag name"),
        input.color ?? DEFAULT_TAG_COLORS[Number(tagCount) % DEFAULT_TAG_COLORS.length],
        input.description ?? "",
        timestamp,
        timestamp
      ]
    );

    this.recordActivity(projectId, null, "tag.created", `Tag "${input.name}" created`);
    return this.requireTag(id);
  }

  private applyTagSync(cardId: string, tagId: string): void {
    const card = this.requireCard(cardId);
    const tag = this.requireTag(tagId);

    if (tag.projectId !== card.projectId) {
      throw new Error("Tags can only be applied within their project.");
    }

    this.database.run(
      "INSERT OR IGNORE INTO card_tags (card_id, tag_id, created_at) VALUES (?, ?, ?)",
      [cardId, tagId, now()]
    );
    this.database.run("UPDATE cards SET updated_at = ? WHERE id = ?", [now(), cardId]);
    this.recordActivity(card.projectId, card.id, "tag.applied", `Tag "${tag.name}" applied`);
  }

  private addChecklistItemSync(cardId: string, text: string): ChecklistItem {
    const card = this.requireCard(cardId);
    const cleaned = cleanTitle(text, "Checklist item");
    const timestamp = now();
    const id = randomUUID();
    const count =
      this.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM checklist_items WHERE card_id = ?",
        [cardId]
      )?.count ?? 0;

    this.database.run(
      `
        INSERT INTO checklist_items (
          id, card_id, text, is_complete, position, created_at, updated_at
        ) VALUES (?, ?, ?, 0, ?, ?, ?)
      `,
      [id, cardId, cleaned, positionForIndex(Number(count)), timestamp, timestamp]
    );
    this.database.run("UPDATE cards SET updated_at = ? WHERE id = ?", [timestamp, cardId]);
    this.recordActivity(card.projectId, card.id, "checklist.added", `Checklist item "${cleaned}" added`);
    return this.requireChecklistItem(id);
  }

  private updateChecklistItemSync(
    itemId: string,
    patch: UpdateChecklistItemInput
  ): ChecklistItem {
    const item = this.requireChecklistItem(itemId);
    const card = this.requireCard(item.cardId);
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (patch.text !== undefined && patch.text.trim() !== item.text) {
      updates.push("text = ?");
      values.push(cleanTitle(patch.text, "Checklist item"));
    }

    if (patch.isComplete !== undefined && patch.isComplete !== item.isComplete) {
      updates.push("is_complete = ?");
      values.push(patch.isComplete ? 1 : 0);
    }

    if (!updates.length) {
      return item;
    }

    const timestamp = now();
    updates.push("updated_at = ?");
    values.push(timestamp);
    values.push(itemId);
    this.database.run(`UPDATE checklist_items SET ${updates.join(", ")} WHERE id = ?`, values);
    this.database.run("UPDATE cards SET updated_at = ? WHERE id = ?", [timestamp, item.cardId]);
    this.recordActivity(card.projectId, card.id, "checklist.updated", `Checklist item "${item.text}" updated`);
    return this.requireChecklistItem(itemId);
  }

  private getWorkspace(): Workspace {
    const row = this.database.get<Row>("SELECT * FROM workspaces LIMIT 1");
    if (!row) {
      throw new Error("Workspace is missing.");
    }
    return {
      id: asString(row.id),
      name: asString(row.name),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private listProjects(): Project[] {
    return this.database
      .all<Row>(
        `
          SELECT
            p.*,
            (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id) AS card_count,
            (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id AND c.archived_at IS NULL) AS active_card_count
          FROM projects p
          WHERE p.archived_at IS NULL
          ORDER BY p.updated_at DESC, p.name ASC
        `
      )
      .map((row) => this.mapProject(row));
  }

  private listObservations(context: {
    projectId: string | null;
    workspaceId: string | null;
  }): Observation[] {
    const { projectId, workspaceId } = context;
    const params = projectId
      ? [projectId, workspaceId ?? "", projectId]
      : [workspaceId ?? ""];
    const scopeFilter = projectId
      ? `
          AND (
            project_id = ?
            OR (project_id IS NULL AND workspace_id = ?)
            OR (project_id IS NULL AND workspace_id IS NULL)
            OR EXISTS (
              SELECT 1
              FROM card_observations co
              INNER JOIN cards c ON c.id = co.card_id
              WHERE co.observation_id = observations.id
                AND c.project_id = ?
            )
          )
        `
      : `
          AND (
            workspace_id = ?
            OR (project_id IS NULL AND workspace_id IS NULL)
          )
        `;

    return this.database
      .all<Row>(
        `
          SELECT *
          FROM observations
          WHERE archived_at IS NULL
          ${scopeFilter}
          ORDER BY created_at DESC
        `,
        params
      )
      .map((row) => this.mapObservation(row));
  }

  private getBoard(projectId: string): BoardState {
    const project = this.requireProject(projectId);
    const board = this.requireDefaultBoard(projectId);
    const columns = this.listColumnsForBoard(board.id).map((column) => ({
      ...column,
      cards: this.listCardsForColumn(column.id)
    }));
    const tags = this.database
      .all<Row>(
        "SELECT * FROM tags WHERE project_id = ? AND archived_at IS NULL ORDER BY name ASC",
        [projectId]
      )
      .map((row) => this.mapTag(row));
    const documents = this.listDocumentsForProject(projectId);
    const designAssets = this.listDesignAssetsForProject(projectId);
    const recentActivity = this.database
      .all<Row>(
        "SELECT * FROM activity_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 30",
        [projectId]
      )
      .map((row) => this.mapActivity(row));

    return { project, board, columns, tags, documents, designAssets, recentActivity };
  }

  private listDocumentsForProject(projectId: string): ProjectDocument[] {
    return this.database
      .all<Row>(
        "SELECT * FROM project_documents WHERE project_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, title ASC",
        [projectId]
      )
      .map((row) => this.mapProjectDocument(row));
  }

  private listDesignAssetsForProject(projectId: string): DesignAsset[] {
    return this.database
      .all<Row>(
        "SELECT * FROM design_assets WHERE project_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, display_name ASC",
        [projectId]
      )
      .map((row) => this.mapDesignAsset(row));
  }

  private listColumnsForBoard(boardId: string): BoardColumn[] {
    return this.database
      .all<Row>(
        "SELECT * FROM columns WHERE board_id = ? AND archived_at IS NULL ORDER BY position ASC",
        [boardId]
      )
      .map((row) => ({ ...this.mapColumn(row), cards: [] }));
  }

  private listCardsForColumn(columnId: string): Card[] {
    return this.database
      .all<Row>(
        "SELECT * FROM cards WHERE column_id = ? AND archived_at IS NULL ORDER BY position ASC",
        [columnId]
      )
      .map((row) => this.mapCardWithRelations(row));
  }

  private rewriteCardOrder(columnId: string, orderedIds: string[], columnValue: string): void {
    orderedIds.forEach((id, index) => {
      this.database.run(
        "UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?",
        [columnValue, positionForIndex(index), now(), id]
      );
    });
  }

  private recordActivity(
    projectId: string,
    cardId: string | null,
    eventType: string,
    summary: string,
    oldValue: string | null = null,
    newValue: string | null = null
  ): void {
    this.database.run(
      `
        INSERT INTO activity_events (
          id, project_id, card_id, event_type, summary, old_value, new_value, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [randomUUID(), projectId, cardId, eventType, summary, oldValue, newValue, now()]
    );
  }

  private requireProject(projectId: string): Project {
    const row = this.database.get<Row>(
      `
        SELECT
          p.*,
          (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id) AS card_count,
          (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id AND c.archived_at IS NULL) AS active_card_count
        FROM projects p
        WHERE p.id = ?
      `,
      [projectId]
    );

    if (!row) {
      throw new Error("Project was not found.");
    }

    return this.mapProject(row);
  }

  private requireDefaultBoard(projectId: string): Board {
    const row = this.database.get<Row>(
      "SELECT * FROM boards WHERE project_id = ? AND is_default = 1 LIMIT 1",
      [projectId]
    );

    if (!row) {
      throw new Error("Default board was not found.");
    }

    return this.mapBoard(row);
  }

  private requireBoard(boardId: string): Board {
    const row = this.database.get<Row>("SELECT * FROM boards WHERE id = ?", [boardId]);
    if (!row) {
      throw new Error("Board was not found.");
    }
    return this.mapBoard(row);
  }

  private requireColumn(columnId: string): BoardColumn {
    const row = this.database.get<Row>("SELECT * FROM columns WHERE id = ?", [columnId]);
    if (!row) {
      throw new Error("Column was not found.");
    }
    return { ...this.mapColumn(row), cards: [] };
  }

  private requireCard(cardId: string): Card {
    const row = this.database.get<Row>("SELECT * FROM cards WHERE id = ?", [cardId]);
    if (!row) {
      throw new Error("Card was not found.");
    }
    return this.mapCardWithRelations(row);
  }

  private requireTag(tagId: string): Tag {
    const row = this.database.get<Row>("SELECT * FROM tags WHERE id = ?", [tagId]);
    if (!row) {
      throw new Error("Tag was not found.");
    }
    return this.mapTag(row);
  }

  private requireChecklistItem(itemId: string): ChecklistItem {
    const row = this.database.get<Row>("SELECT * FROM checklist_items WHERE id = ?", [itemId]);
    if (!row) {
      throw new Error("Checklist item was not found.");
    }
    return this.mapChecklistItem(row);
  }

  private requireComment(commentId: string): CardComment {
    const row = this.database.get<Row>("SELECT * FROM comments WHERE id = ?", [commentId]);
    if (!row) {
      throw new Error("Comment was not found.");
    }
    return this.mapComment(row);
  }

  private requireObservation(observationId: string): Observation {
    const row = this.database.get<Row>("SELECT * FROM observations WHERE id = ?", [observationId]);
    if (!row) {
      throw new Error("Observation was not found.");
    }
    return this.mapObservation(row);
  }

  private requireProjectDocument(documentId: string): ProjectDocument {
    const row = this.database.get<Row>("SELECT * FROM project_documents WHERE id = ?", [documentId]);
    if (!row) {
      throw new Error("Planning document was not found.");
    }
    return this.mapProjectDocument(row);
  }

  private requireDesignAsset(assetId: string): DesignAsset {
    const row = this.database.get<Row>("SELECT * FROM design_assets WHERE id = ?", [assetId]);
    if (!row) {
      throw new Error("Design asset was not found.");
    }
    return this.mapDesignAsset(row);
  }

  private mapProject(row: Row): Project {
    return {
      id: asString(row.id),
      workspaceId: asString(row.workspace_id),
      name: asString(row.name),
      description: asString(row.description),
      color: asString(row.color, "#0f766e"),
      icon: asString(row.icon, "Board"),
      archivedAt: asNullableString(row.archived_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      cardCount: Number(row.card_count ?? 0),
      activeCardCount: Number(row.active_card_count ?? 0)
    };
  }

  private mapBoard(row: Row): Board {
    return {
      id: asString(row.id),
      projectId: asString(row.project_id),
      name: asString(row.name),
      isDefault: asBool(row.is_default),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private mapColumn(row: Row): Omit<BoardColumn, "cards"> {
    return {
      id: asString(row.id),
      boardId: asString(row.board_id),
      name: asString(row.name),
      position: asString(row.position),
      color: asString(row.color, "#e5e7eb"),
      isCompletionColumn: asBool(row.is_completion_column),
      collapsed: asBool(row.collapsed),
      archivedAt: asNullableString(row.archived_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private mapCardWithRelations(row: Row): Card {
    const id = asString(row.id);
    const tags = this.database
      .all<Row>(
        `
          SELECT t.*
          FROM tags t
          INNER JOIN card_tags ct ON ct.tag_id = t.id
          WHERE ct.card_id = ? AND t.archived_at IS NULL
          ORDER BY t.name ASC
        `,
        [id]
      )
      .map((tagRow) => this.mapTag(tagRow));
    const observations = this.database
      .all<Row>(
        `
          SELECT o.*
          FROM observations o
          INNER JOIN card_observations co ON co.observation_id = o.id
          WHERE co.card_id = ? AND o.archived_at IS NULL
          ORDER BY co.created_at ASC
        `,
        [id]
      )
      .map((observationRow) => this.mapObservation(observationRow));
    const checklist = this.database
      .all<Row>(
        "SELECT * FROM checklist_items WHERE card_id = ? ORDER BY position ASC",
        [id]
      )
      .map((itemRow) => this.mapChecklistItem(itemRow));
    const comments = this.database
      .all<Row>(
        "SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC",
        [id]
      )
      .map((commentRow) => this.mapComment(commentRow));
    const activity = this.database
      .all<Row>(
        "SELECT * FROM activity_events WHERE card_id = ? ORDER BY created_at DESC LIMIT 30",
        [id]
      )
      .map((activityRow) => this.mapActivity(activityRow));

    return {
      id,
      projectId: asString(row.project_id),
      boardId: asString(row.board_id),
      columnId: asString(row.column_id),
      title: asString(row.title),
      description: asString(row.description),
      priority: (asString(row.priority) as Priority) || "",
      dueDate: asString(row.due_date),
      position: asString(row.position),
      archivedAt: asNullableString(row.archived_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      tags,
      observations,
      checklist,
      comments,
      activity
    };
  }

  private mapTag(row: Row): Tag {
    return {
      id: asString(row.id),
      projectId: asString(row.project_id),
      name: asString(row.name),
      color: asString(row.color, "#0f766e"),
      description: asString(row.description),
      archivedAt: asNullableString(row.archived_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private mapProjectDocument(row: Row): ProjectDocument {
    return {
      id: asString(row.id),
      projectId: asString(row.project_id),
      title: asString(row.title),
      body: asString(row.body),
      archivedAt: asNullableString(row.archived_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private mapDesignAsset(row: Row): DesignAsset {
    const filePath = asString(row.file_path);
    return {
      id: asString(row.id),
      projectId: asString(row.project_id),
      cardId: asNullableString(row.card_id),
      documentId: asNullableString(row.document_id),
      displayName: asString(row.display_name),
      filePath,
      fileUrl: filePath ? pathToFileURL(filePath).toString() : "",
      mimeType: asString(row.mime_type),
      archivedAt: asNullableString(row.archived_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private mapChecklistItem(row: Row): ChecklistItem {
    return {
      id: asString(row.id),
      cardId: asString(row.card_id),
      text: asString(row.text),
      isComplete: asBool(row.is_complete),
      position: asString(row.position),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private mapComment(row: Row): CardComment {
    return {
      id: asString(row.id),
      cardId: asString(row.card_id),
      body: asString(row.body),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private mapActivity(row: Row): ActivityEvent {
    return {
      id: asString(row.id),
      projectId: asString(row.project_id),
      cardId: asNullableString(row.card_id),
      eventType: asString(row.event_type),
      summary: asString(row.summary),
      oldValue: asNullableString(row.old_value),
      newValue: asNullableString(row.new_value),
      createdAt: asString(row.created_at)
    };
  }

  private mapObservation(row: Row): Observation {
    const id = asString(row.id);

    return {
      id,
      workspaceId: asNullableString(row.workspace_id),
      projectId: asNullableString(row.project_id),
      body: asString(row.body),
      label: observationLabel(asString(row.body)),
      source: asString(row.source, "Project Board"),
      projectPath: asString(row.project_path),
      kind: asString(row.kind, "observation"),
      status: this.getObservationStatus(id),
      archivedAt: asNullableString(row.archived_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at)
    };
  }

  private getObservationStatus(observationId: string): Observation["status"] {
    const linkedCards = this.database.all<{ archived_at: unknown; is_completion_column: unknown }>(
      `
        SELECT c.archived_at, col.is_completion_column
        FROM card_observations co
        INNER JOIN cards c ON c.id = co.card_id
        INNER JOIN columns col ON col.id = c.column_id
        WHERE co.observation_id = ?
      `,
      [observationId]
    );

    if (!linkedCards.length) {
      return "active";
    }

    const allResolved = linkedCards.every((card) =>
      asNullableString(card.archived_at) !== null || asBool(card.is_completion_column)
    );

    return allResolved ? "resolved" : "converted";
  }
}

function mimeTypeForFile(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function observationLabel(body: string): string {
  const normalized = body.trim().toLowerCase();
  if (normalized.includes("add card") || normalized.includes("plus button")) {
    return "Card creation UX";
  }
  if (normalized.includes("meaningless code") || normalized.includes("actual observation semantics")) {
    return "Semantic labels";
  }
  if (normalized.includes("tied to certain observations") || normalized.includes("observation tag")) {
    return "Observation links";
  }
  if (normalized.includes("delete project workspaces")) {
    return "Workspace cleanup";
  }
  if (normalized.includes("converted into backlog") || normalized.includes("capture list")) {
    return "Capture lifecycle";
  }
  if (normalized.includes("planning documents")) {
    return "Planning docs";
  }
  if (normalized.includes("images") && normalized.includes("ui design")) {
    return "Design assets";
  }
  if (normalized.includes("project-specific") || normalized.includes("workspace-specific")) {
    return "Project/workspace scope";
  }

  return titleCase(
    body
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !COMMON_LABEL_WORDS.has(word.toLowerCase()))
      .slice(0, 4)
      .join(" ")
  ) || "Observation";
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

const COMMON_LABEL_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "where",
  "should",
  "there",
  "could",
  "would",
  "into",
  "from",
  "have",
  "been",
  "items",
  "actual"
]);
