import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { LocalDatabase } from "./database";
import { ProjectBoardService } from "./services";
import type {
  CreateCardInput,
  CreateColumnInput,
  CreateProjectInput,
  CreateTagInput,
  UpdateCardInput,
  UpdateChecklistItemInput,
  UpdateColumnInput,
  UpdateProjectInput
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let servicePromise: Promise<ProjectBoardService> | null = null;

function getService(): Promise<ProjectBoardService> {
  if (!servicePromise) {
    servicePromise = LocalDatabase.open().then((database) => new ProjectBoardService(database));
  }

  return servicePromise;
}

function registerIpc(): void {
  ipcMain.handle("app:getSnapshot", async (_event, projectId?: string) => {
    return (await getService()).getSnapshot(projectId);
  });

  ipcMain.handle("project:create", async (_event, input: CreateProjectInput) => {
    return (await getService()).createProject(input);
  });

  ipcMain.handle("project:update", async (_event, projectId: string, patch: UpdateProjectInput) => {
    return (await getService()).updateProject(projectId, patch);
  });

  ipcMain.handle("project:archive", async (_event, projectId: string) => {
    return (await getService()).archiveProject(projectId);
  });

  ipcMain.handle("column:create", async (_event, boardId: string, input: CreateColumnInput) => {
    return (await getService()).createColumn(boardId, input);
  });

  ipcMain.handle("column:update", async (_event, columnId: string, patch: UpdateColumnInput) => {
    return (await getService()).updateColumn(columnId, patch);
  });

  ipcMain.handle("column:archive", async (_event, columnId: string) => {
    return (await getService()).archiveColumn(columnId);
  });

  ipcMain.handle("card:create", async (_event, columnId: string, input: CreateCardInput) => {
    return (await getService()).createCard(columnId, input);
  });

  ipcMain.handle("card:update", async (_event, cardId: string, patch: UpdateCardInput) => {
    return (await getService()).updateCard(cardId, patch);
  });

  ipcMain.handle("card:move", async (_event, cardId: string, targetColumnId: string, targetIndex: number) => {
    return (await getService()).moveCard(cardId, targetColumnId, targetIndex);
  });

  ipcMain.handle("card:duplicate", async (_event, cardId: string) => {
    return (await getService()).duplicateCard(cardId);
  });

  ipcMain.handle("card:archive", async (_event, cardId: string) => {
    return (await getService()).archiveCard(cardId);
  });

  ipcMain.handle("tag:create", async (_event, projectId: string, input: CreateTagInput) => {
    return (await getService()).createTag(projectId, input);
  });

  ipcMain.handle("tag:apply", async (_event, cardId: string, tagId: string) => {
    return (await getService()).applyTag(cardId, tagId);
  });

  ipcMain.handle("tag:remove", async (_event, cardId: string, tagId: string) => {
    return (await getService()).removeTag(cardId, tagId);
  });

  ipcMain.handle("checklist:add", async (_event, cardId: string, text: string) => {
    return (await getService()).addChecklistItem(cardId, text);
  });

  ipcMain.handle("checklist:update", async (_event, itemId: string, patch: UpdateChecklistItemInput) => {
    return (await getService()).updateChecklistItem(itemId, patch);
  });

  ipcMain.handle("checklist:delete", async (_event, itemId: string) => {
    return (await getService()).deleteChecklistItem(itemId);
  });

  ipcMain.handle("comment:add", async (_event, cardId: string, body: string) => {
    return (await getService()).addComment(cardId, body);
  });

  ipcMain.handle("backup:create", async () => {
    return (await getService()).createBackup();
  });

  ipcMain.handle("data:openFolder", async () => {
    return (await getService()).openDataFolder();
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "Project Board",
    backgroundColor: "#f6f7f8",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  }
}

app.setName("Project Board");

app.whenReady().then(async () => {
  await getService();
  registerIpc();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

