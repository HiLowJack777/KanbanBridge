import http from "node:http";
import type {
  AppSnapshot,
  Card,
  CreateCardInput,
  CreateObservationInput,
  Priority,
  Tag,
  UpdateCardInput,
  UpdateObservationInput
} from "../shared/types";
import type { ProjectBoardService } from "./services";

const CONNECTOR_PORT = 38731;

type ServiceGetter = () => Promise<ProjectBoardService>;
type ChangeNotifier = () => void;

type ConnectorCardInput = CreateCardInput & {
  projectId?: string;
  projectName?: string;
  columnId?: string;
  columnName?: string;
  tags?: string[];
  observationId?: string;
  checklist?: string[];
};

type ChecklistInput = {
  text: string;
};

type MoveCardInput = {
  projectId?: string;
  projectName?: string;
  columnId?: string;
  columnName?: string;
  targetIndex?: number;
};

type ObservationLinkInput = {
  observationId: string;
};

type TagInput = {
  name?: string;
  tagId?: string;
  color?: string;
  description?: string;
  projectId?: string;
  projectName?: string;
};

type ProjectTargetInput = {
  projectId?: string | null;
  projectName?: string | null;
};

export function startAgentConnector(getService: ServiceGetter, notifyChange: ChangeNotifier): void {
  const server = http.createServer(async (request, response) => {
    try {
      response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
      response.setHeader("Access-Control-Allow-Headers", "content-type");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${CONNECTOR_PORT}`);

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, app: "KanbanBridge" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/projects") {
        const snapshot = await (await getService()).getSnapshot();
        sendJson(response, 200, {
          projects: snapshot.projects,
          defaultProjectId: snapshot.activeProjectId
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/snapshot") {
        const service = await getService();
        const projectId = await resolveOptionalProjectTarget(service, {
          projectId: url.searchParams.get("projectId"),
          projectName: url.searchParams.get("projectName")
        });
        const snapshot = await service.getSnapshot(projectId);
        sendJson(response, 200, snapshot);
        return;
      }

      if (request.method === "GET" && url.pathname === "/observations") {
        const service = await getService();
        const projectId = await resolveOptionalProjectTarget(service, {
          projectId: url.searchParams.get("projectId"),
          projectName: url.searchParams.get("projectName")
        });
        const snapshot = await service.getSnapshot(projectId);
        sendJson(response, 200, { observations: snapshot.observations });
        return;
      }

      if (request.method === "POST" && url.pathname === "/observations") {
        const input = await readJson<CreateObservationInput & { projectName?: string }>(request);
        const service = await getService();
        const projectId = await resolveOptionalProjectTarget(service, {
          projectId: input.projectId ?? url.searchParams.get("projectId"),
          projectName: input.projectName ?? url.searchParams.get("projectName")
        });
        const observation = await service.createObservation({
          ...input,
          projectId,
          workspaceId: input.workspaceId ?? url.searchParams.get("workspaceId") ?? undefined
        });
        notifyChange();
        sendJson(response, 201, { observation });
        return;
      }

      const observationMatch = url.pathname.match(/^\/observations\/([^/]+)$/);
      if (request.method === "PATCH" && observationMatch) {
        const patch = await readJson<UpdateObservationInput>(request);
        const observation = await (await getService()).updateObservation(
          decodeURIComponent(observationMatch[1]),
          patch
        );
        notifyChange();
        sendJson(response, 200, { observation });
        return;
      }

      if (request.method === "POST" && url.pathname === "/cards") {
        const input = await readJson<ConnectorCardInput>(request);
        const service = await getService();
        const created = await createConnectorCard(service, input);
        notifyChange();
        sendJson(response, 201, { card: created });
        return;
      }

      const cardMatch = url.pathname.match(/^\/cards\/([^/]+)$/);
      if (request.method === "PATCH" && cardMatch) {
        const patch = await readJson<UpdateCardInput>(request);
        const card = await (await getService()).updateCard(decodeURIComponent(cardMatch[1]), patch);
        notifyChange();
        sendJson(response, 200, { card });
        return;
      }

      const cardArchiveMatch = url.pathname.match(/^\/cards\/([^/]+)\/archive$/);
      if (request.method === "POST" && cardArchiveMatch) {
        await (await getService()).archiveCard(decodeURIComponent(cardArchiveMatch[1]));
        notifyChange();
        sendJson(response, 200, { ok: true });
        return;
      }

      const cardMoveMatch = url.pathname.match(/^\/cards\/([^/]+)\/move$/);
      if (request.method === "POST" && cardMoveMatch) {
        const input = await readJson<MoveCardInput>(request);
        const card = await moveConnectorCard(await getService(), decodeURIComponent(cardMoveMatch[1]), input);
        notifyChange();
        sendJson(response, 200, { card });
        return;
      }

      const checklistMatch = url.pathname.match(/^\/cards\/([^/]+)\/checklist$/);
      if (request.method === "POST" && checklistMatch) {
        const input = await readJson<ChecklistInput>(request);
        const item = await (await getService()).addChecklistItem(decodeURIComponent(checklistMatch[1]), input.text);
        notifyChange();
        sendJson(response, 201, { item });
        return;
      }

      const observationLinkMatch = url.pathname.match(/^\/cards\/([^/]+)\/observations$/);
      if (request.method === "POST" && observationLinkMatch) {
        const input = await readJson<ObservationLinkInput>(request);
        await (await getService()).linkObservationToCard(
          decodeURIComponent(observationLinkMatch[1]),
          input.observationId
        );
        notifyChange();
        sendJson(response, 200, { ok: true });
        return;
      }

      const observationUnlinkMatch = url.pathname.match(/^\/cards\/([^/]+)\/observations\/remove$/);
      if (request.method === "POST" && observationUnlinkMatch) {
        const input = await readJson<ObservationLinkInput>(request);
        await (await getService()).unlinkObservationFromCard(
          decodeURIComponent(observationUnlinkMatch[1]),
          input.observationId
        );
        notifyChange();
        sendJson(response, 200, { ok: true });
        return;
      }

      const tagMatch = url.pathname.match(/^\/cards\/([^/]+)\/tags$/);
      if (request.method === "POST" && tagMatch) {
        const input = await readJson<TagInput>(request);
        const tag = await applyConnectorTag(await getService(), decodeURIComponent(tagMatch[1]), input);
        notifyChange();
        sendJson(response, 201, { tag });
        return;
      }

      const removeTagMatch = url.pathname.match(/^\/cards\/([^/]+)\/tags\/remove$/);
      if (request.method === "POST" && removeTagMatch) {
        await removeConnectorTag(await getService(), decodeURIComponent(removeTagMatch[1]), await readJson<TagInput>(request));
        notifyChange();
        sendJson(response, 200, { ok: true });
        return;
      }

      const archiveMatch = url.pathname.match(/^\/observations\/([^/]+)\/archive$/);
      if (request.method === "POST" && archiveMatch) {
        await (await getService()).archiveObservation(decodeURIComponent(archiveMatch[1]));
        notifyChange();
        sendJson(response, 200, { ok: true });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") {
      console.error("Agent connector failed:", error);
    }
  });

  server.listen(CONNECTOR_PORT, "127.0.0.1", () => {
    console.info(`Agent connector listening on http://127.0.0.1:${CONNECTOR_PORT}`);
  });
}

async function resolveOptionalProjectTarget(
  service: ProjectBoardService,
  input: ProjectTargetInput
): Promise<string | undefined> {
  if (!input.projectId?.trim() && !input.projectName?.trim()) {
    return undefined;
  }
  return resolveProjectTarget(service, input);
}

async function resolveRequiredProjectTarget(
  service: ProjectBoardService,
  input: ProjectTargetInput,
  action: string
): Promise<string> {
  if (!input.projectId?.trim() && !input.projectName?.trim()) {
    throw new Error(`Refusing to ${action} without an explicit project target. ${projectTargetHelp()}`);
  }
  return resolveProjectTarget(service, input);
}

async function resolveProjectTarget(
  service: ProjectBoardService,
  input: ProjectTargetInput
): Promise<string> {
  const snapshot = await service.getSnapshot();
  const projectId = input.projectId?.trim();
  const projectName = input.projectName?.trim();

  if (projectId) {
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`Project "${projectId}" was not found. ${projectTargetHelp()}`);
    }
    if (projectName && project.name.toLowerCase() !== projectName.toLowerCase()) {
      throw new Error(`Project id "${projectId}" is "${project.name}", not "${projectName}".`);
    }
    return project.id;
  }

  if (projectName) {
    const matches = snapshot.projects.filter((item) => item.name.toLowerCase() === projectName.toLowerCase());
    if (matches.length === 1) {
      return matches[0].id;
    }
    if (matches.length > 1) {
      throw new Error(`Project name "${projectName}" is ambiguous. Use --project-id instead.`);
    }
    throw new Error(`Project "${projectName}" was not found. ${projectTargetHelp()}`);
  }

  throw new Error(projectTargetHelp());
}

function projectTargetHelp(): string {
  return 'Provide projectId or projectName. List projects with GET /projects or "node scripts/agent-bridge.mjs projects".';
}

async function createConnectorCard(
  service: ProjectBoardService,
  input: ConnectorCardInput
): Promise<Card> {
  const title = input.title?.trim();
  if (!title) {
    throw new Error("Card title is required.");
  }

  const projectId = await resolveRequiredProjectTarget(service, input, "create a card");
  const snapshot = await service.getSnapshot(projectId);
  const board = snapshot.board;
  if (!board) {
    throw new Error("No active board is available.");
  }

  const column =
    (input.columnId
      ? board.columns.find((item) => item.id === input.columnId)
      : undefined) ??
    board.columns.find((item) => item.name.toLowerCase() === (input.columnName ?? "Backlog").toLowerCase()) ??
    board.columns[0];

  if (!column) {
    throw new Error("No active column is available.");
  }

  const card = await service.createCard(column.id, {
    title,
    description: input.description,
    priority: normalizePriority(input.priority),
    dueDate: input.dueDate
  });

  const tagNames = [...(input.tags ?? [])];
  if (input.observationId?.trim()) {
    tagNames.push(observationTagName(input.observationId));
  }

  for (const tagName of tagNames) {
    const cleaned = tagName.trim();
    if (cleaned) {
      const tag = await service.createTag(board.project.id, { name: cleaned });
      await service.applyTag(card.id, tag.id);
    }
  }

  if (input.observationId?.trim()) {
    await service.linkObservationToCard(card.id, input.observationId.trim());
  }

  for (const item of input.checklist ?? []) {
    const cleaned = item.trim();
    if (cleaned) {
      await service.addChecklistItem(card.id, cleaned);
    }
  }

  const refreshed = await service.getSnapshot(board.project.id);
  return (
    refreshed.board?.columns
      .flatMap((item) => item.cards)
      .find((item) => item.id === card.id) ?? card
  );
}

async function moveConnectorCard(
  service: ProjectBoardService,
  cardId: string,
  input: MoveCardInput
): Promise<Card> {
  const projectId = await resolveRequiredProjectTarget(service, input, "move a card");
  const snapshot = await service.getSnapshot(projectId);
  const board = snapshot.board;
  if (!board) {
    throw new Error("No active board is available.");
  }

  const card = findCard(snapshot, cardId);
  if (!card) {
    throw new Error(`Card "${cardId}" was not found.`);
  }

  const targetColumn =
    (input.columnId
      ? board.columns.find((column) => column.id === input.columnId)
      : undefined) ??
    board.columns.find((column) => column.name.toLowerCase() === input.columnName?.trim().toLowerCase());

  if (!targetColumn) {
    throw new Error("Target column was not found.");
  }

  const targetIndex =
    typeof input.targetIndex === "number" && Number.isFinite(input.targetIndex)
      ? input.targetIndex
      : targetColumn.cards.length;

  return service.moveCard(cardId, targetColumn.id, targetIndex);
}

async function applyConnectorTag(
  service: ProjectBoardService,
  cardId: string,
  input: TagInput
): Promise<Tag> {
  const projectId = await resolveRequiredProjectTarget(service, input, "tag a card");
  const snapshot = await service.getSnapshot(projectId);
  const card = findCard(snapshot, cardId);
  if (!card) {
    throw new Error(`Card "${cardId}" was not found.`);
  }

  const existingTag = findTag(snapshot, input);
  const tag =
    existingTag ??
    (await service.createTag(card.projectId, {
      name: cleanTagName(input.name),
      color: input.color,
      description: input.description
    }));

  await service.applyTag(cardId, tag.id);
  return tag;
}

async function removeConnectorTag(
  service: ProjectBoardService,
  cardId: string,
  input: TagInput
): Promise<void> {
  const projectId = await resolveRequiredProjectTarget(service, input, "remove a tag from a card");
  const snapshot = await service.getSnapshot(projectId);
  const card = findCard(snapshot, cardId);
  if (!card) {
    throw new Error(`Card "${cardId}" was not found.`);
  }

  const tag = findTag(snapshot, input);
  if (!tag) {
    throw new Error("Tag was not found.");
  }

  await service.removeTag(cardId, tag.id);
}

function findCard(snapshot: AppSnapshot, cardId: string): Card | null {
  return snapshot.board?.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === cardId) ?? null;
}

function findTag(snapshot: AppSnapshot, input: TagInput): Tag | null {
  const tags = snapshot.board?.tags ?? [];
  if (input.tagId) {
    return tags.find((tag) => tag.id === input.tagId) ?? null;
  }

  if (input.name) {
    return tags.find((tag) => tag.name.toLowerCase() === input.name?.trim().toLowerCase()) ?? null;
  }

  return null;
}

function cleanTagName(name: string | undefined): string {
  const cleaned = name?.trim();
  if (!cleaned) {
    throw new Error("Tag name is required.");
  }
  return cleaned;
}

function observationTagName(observationId: string): string {
  return `Obs: ${observationId.trim().slice(0, 8)}`;
}

function normalizePriority(priority: Priority | undefined): Priority | undefined {
  if (!priority) {
    return undefined;
  }

  const allowed: Priority[] = ["", "Low", "Medium", "High", "Urgent"];
  return allowed.includes(priority) ? priority : undefined;
}

function readJson<T>(request: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}
