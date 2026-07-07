import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateCardInput,
  CreateColumnInput,
  CreateObservationInput,
  CreateProjectInput,
  CreateTagInput,
  ProjectBoardApi,
  UpdateCardInput,
  UpdateChecklistItemInput,
  UpdateColumnInput,
  UpdateProjectInput
} from "./shared/types";

const api: ProjectBoardApi = {
  getSnapshot: (projectId?: string) => ipcRenderer.invoke("app:getSnapshot", projectId),
  onExternalChange: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("app:external-change", listener);
    return () => ipcRenderer.removeListener("app:external-change", listener);
  },
  createObservation: (input: CreateObservationInput) => ipcRenderer.invoke("observation:create", input),
  archiveObservation: (observationId: string) =>
    ipcRenderer.invoke("observation:archive", observationId),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke("project:create", input),
  updateProject: (projectId: string, patch: UpdateProjectInput) =>
    ipcRenderer.invoke("project:update", projectId, patch),
  archiveProject: (projectId: string) => ipcRenderer.invoke("project:archive", projectId),
  createColumn: (boardId: string, input: CreateColumnInput) =>
    ipcRenderer.invoke("column:create", boardId, input),
  updateColumn: (columnId: string, patch: UpdateColumnInput) =>
    ipcRenderer.invoke("column:update", columnId, patch),
  archiveColumn: (columnId: string) => ipcRenderer.invoke("column:archive", columnId),
  createCard: (columnId: string, input: CreateCardInput) =>
    ipcRenderer.invoke("card:create", columnId, input),
  updateCard: (cardId: string, patch: UpdateCardInput) =>
    ipcRenderer.invoke("card:update", cardId, patch),
  moveCard: (cardId: string, targetColumnId: string, targetIndex: number) =>
    ipcRenderer.invoke("card:move", cardId, targetColumnId, targetIndex),
  duplicateCard: (cardId: string) => ipcRenderer.invoke("card:duplicate", cardId),
  archiveCard: (cardId: string) => ipcRenderer.invoke("card:archive", cardId),
  createTag: (projectId: string, input: CreateTagInput) =>
    ipcRenderer.invoke("tag:create", projectId, input),
  applyTag: (cardId: string, tagId: string) => ipcRenderer.invoke("tag:apply", cardId, tagId),
  removeTag: (cardId: string, tagId: string) => ipcRenderer.invoke("tag:remove", cardId, tagId),
  linkObservationToCard: (cardId: string, observationId: string) =>
    ipcRenderer.invoke("observation:linkCard", cardId, observationId),
  unlinkObservationFromCard: (cardId: string, observationId: string) =>
    ipcRenderer.invoke("observation:unlinkCard", cardId, observationId),
  addChecklistItem: (cardId: string, text: string) =>
    ipcRenderer.invoke("checklist:add", cardId, text),
  updateChecklistItem: (itemId: string, patch: UpdateChecklistItemInput) =>
    ipcRenderer.invoke("checklist:update", itemId, patch),
  deleteChecklistItem: (itemId: string) => ipcRenderer.invoke("checklist:delete", itemId),
  addComment: (cardId: string, body: string) => ipcRenderer.invoke("comment:add", cardId, body),
  createBackup: () => ipcRenderer.invoke("backup:create"),
  openDataFolder: () => ipcRenderer.invoke("data:openFolder")
};

contextBridge.exposeInMainWorld("projectBoard", api);
