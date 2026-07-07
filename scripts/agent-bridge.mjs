#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONNECTOR_URL = "http://127.0.0.1:38731";
const APP_DATA_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ProjectBoard");
const INBOX_PATH = path.join(APP_DATA_DIR, "agent-inbox.jsonl");

const [command = "help", ...args] = process.argv.slice(2);

try {
  if (command === "observe") {
    await observe(args);
  } else if (command === "update-observation") {
    await updateObservation(args);
  } else if (command === "list") {
    await list(args);
  } else if (command === "projects" || command === "list-projects") {
    await listProjects();
  } else if (command === "snapshot") {
    await snapshot(args);
  } else if (command === "card") {
    await createCard(args);
  } else if (command === "update-card") {
    await updateCard(args);
  } else if (command === "archive-card") {
    await archiveCard(args);
  } else if (command === "move-card") {
    await moveCard(args);
  } else if (command === "checklist") {
    await addChecklistItem(args);
  } else if (command === "link-observation") {
    await linkObservation(args);
  } else if (command === "unlink-observation") {
    await unlinkObservation(args);
  } else if (command === "tag-card") {
    await tagCard(args);
  } else if (command === "untag-card") {
    await untagCard(args);
  } else if (command === "archive") {
    await archive(args);
  } else {
    help();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function observe(args) {
  const options = parseArgs(args);
  const body = options._.join(" ").trim() || options.body || options.text;

  if (!body) {
    throw new Error("Usage: agent-bridge observe \"observation text\" [--source codex] [--project-id id] [--project-path C:\\path]");
  }

  const input = {
    body,
    projectId: optionValue(options["project-id"]),
    projectName: optionValue(options["project-name"]),
    workspaceId: optionValue(options["workspace-id"]),
    source: options.source || "Agent",
    projectPath: options["project-path"] || process.cwd(),
    kind: options.kind || "observation"
  };

  const response = await postObservation(input).catch(async () => {
    await queueObservation(input);
    return { queued: true, observation: input };
  });

  console.log(JSON.stringify(response, null, 2));
}

async function updateObservation(args) {
  const [observationId, ...rest] = args;
  const options = parseArgs(rest);
  const body = options._.join(" ").trim() || optionValue(options.body) || optionValue(options.text);

  if (!observationId || !body) {
    throw new Error("Usage: agent-bridge update-observation <observation-id> \"updated observation text\"");
  }

  const response = await fetch(`${CONNECTOR_URL}/observations/${encodeURIComponent(observationId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function list(args) {
  const options = parseArgs(args);
  const limit = Number(options.limit || 20);
  const url = new URL(`${CONNECTOR_URL}/observations`);
  const projectId = optionValue(options["project-id"]);
  const projectName = optionValue(options["project-name"]);
  if (projectId) {
    url.searchParams.set("projectId", projectId);
  }
  if (projectName) {
    url.searchParams.set("projectName", projectName);
  }
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("KanbanBridge is not running. Open it to list live observations.");
  }

  const payload = await response.json();
  const observations = payload.observations.slice(0, limit);
  console.log(JSON.stringify({ observations }, null, 2));
}

async function listProjects() {
  const response = await fetch(`${CONNECTOR_URL}/projects`);

  if (!response.ok) {
    throw new Error("KanbanBridge is not running. Open it to list live projects.");
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function snapshot(args) {
  const options = parseArgs(args);
  const url = new URL(`${CONNECTOR_URL}/snapshot`);
  const projectId = optionValue(options["project-id"]);
  const projectName = optionValue(options["project-name"]);
  if (projectId) {
    url.searchParams.set("projectId", projectId);
  }
  if (projectName) {
    url.searchParams.set("projectName", projectName);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("KanbanBridge is not running. Open it to read the live snapshot.");
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function createCard(args) {
  const options = parseArgs(args);
  const title = options._.join(" ").trim() || optionValue(options.title);

  if (!title) {
    throw new Error("Usage: agent-bridge card \"title\" --project-id <id> [--column Backlog] [--description text]");
  }

  requireProjectTarget(options, "create a card");

  const payload = {
    title,
    description: optionValue(options.description),
    priority: optionValue(options.priority),
    dueDate: optionValue(options["due-date"]),
    projectId: optionValue(options["project-id"]),
    projectName: optionValue(options["project-name"]),
    columnId: optionValue(options["column-id"]),
    columnName: optionValue(options.column) || optionValue(options["column-name"]),
    observationId: optionValue(options["observation-id"]),
    tags: splitList(options.tag ?? options.tags, /[,|]/),
    checklist: splitList(options.checklist, /\|/)
  };

  const response = await fetch(`${CONNECTOR_URL}/cards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(compact(payload))
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function updateCard(args) {
  const [cardId, ...rest] = args;
  if (!cardId) {
    throw new Error("Usage: agent-bridge update-card <card-id> [--title text] [--description text] [--priority High]");
  }

  const options = parseArgs(rest);
  const patch = compact({
    title: optionValue(options.title),
    description: optionValue(options.description),
    priority: optionValue(options.priority),
    dueDate: optionValue(options["due-date"])
  });

  if (!Object.keys(patch).length) {
    throw new Error("No card updates were provided.");
  }

  const response = await fetch(`${CONNECTOR_URL}/cards/${encodeURIComponent(cardId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function archiveCard(args) {
  const [cardId] = args;
  if (!cardId) {
    throw new Error("Usage: agent-bridge archive-card <card-id>");
  }

  const response = await fetch(`${CONNECTOR_URL}/cards/${encodeURIComponent(cardId)}/archive`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function moveCard(args) {
  const [cardId, ...rest] = args;
  const options = parseArgs(rest);
  const columnName = optionValue(options.column) || optionValue(options["column-name"]);
  const columnId = optionValue(options["column-id"]);

  if (!cardId || (!columnName && !columnId)) {
    throw new Error("Usage: agent-bridge move-card <card-id> --project-id <id> --column \"In Progress\"");
  }

  requireProjectTarget(options, "move a card");

  const response = await fetch(`${CONNECTOR_URL}/cards/${encodeURIComponent(cardId)}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(compact({
      columnName,
      columnId,
      targetIndex: numberOption(options.index),
      projectId: optionValue(options["project-id"]),
      projectName: optionValue(options["project-name"])
    }))
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function addChecklistItem(args) {
  const [cardId, ...textParts] = args;
  const text = textParts.join(" ").trim();
  if (!cardId || !text) {
    throw new Error("Usage: agent-bridge checklist <card-id> \"checklist item text\"");
  }

  const response = await fetch(`${CONNECTOR_URL}/cards/${encodeURIComponent(cardId)}/checklist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function linkObservation(args) {
  const [cardId, observationId] = args;
  if (!cardId || !observationId) {
    throw new Error("Usage: agent-bridge link-observation <card-id> <observation-id>");
  }

  const response = await fetch(`${CONNECTOR_URL}/cards/${encodeURIComponent(cardId)}/observations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ observationId })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function unlinkObservation(args) {
  const [cardId, observationId] = args;
  if (!cardId || !observationId) {
    throw new Error("Usage: agent-bridge unlink-observation <card-id> <observation-id>");
  }

  const response = await fetch(`${CONNECTOR_URL}/cards/${encodeURIComponent(cardId)}/observations/remove`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ observationId })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function tagCard(args) {
  const [cardId, ...rest] = args;
  const options = parseArgs(rest);
  const name = options._.join(" ").trim() || optionValue(options.name);
  const tagId = optionValue(options["tag-id"]);

  if (!cardId || (!name && !tagId)) {
    throw new Error("Usage: agent-bridge tag-card <card-id> --project-id <id> --name \"Obs: 6036d5d3\"");
  }

  requireProjectTarget(options, "tag a card");

  const payload = compact({
    name,
    tagId,
    color: optionValue(options.color),
    description: optionValue(options.description),
    projectId: optionValue(options["project-id"]),
    projectName: optionValue(options["project-name"])
  });

  const response = await fetch(`${CONNECTOR_URL}/cards/${encodeURIComponent(cardId)}/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function untagCard(args) {
  const [cardId, ...rest] = args;
  const options = parseArgs(rest);
  const name = options._.join(" ").trim() || optionValue(options.name);
  const tagId = optionValue(options["tag-id"]);

  if (!cardId || (!name && !tagId)) {
    throw new Error("Usage: agent-bridge untag-card <card-id> --project-id <id> --name Observation");
  }

  requireProjectTarget(options, "remove a tag from a card");

  const payload = compact({
    name,
    tagId,
    projectId: optionValue(options["project-id"]),
    projectName: optionValue(options["project-name"])
  });

  const response = await fetch(`${CONNECTOR_URL}/cards/${encodeURIComponent(cardId)}/tags/remove`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function archive(args) {
  const [observationId] = args;
  if (!observationId) {
    throw new Error("Usage: agent-bridge archive <observation-id>");
  }

  const response = await fetch(`${CONNECTOR_URL}/observations/${encodeURIComponent(observationId)}/archive`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("KanbanBridge is not running. Open it to archive observations.");
  }

  console.log(JSON.stringify(await response.json(), null, 2));
}

async function postObservation(input) {
  const response = await fetch(`${CONNECTOR_URL}/observations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function queueObservation(input) {
  await fs.mkdir(APP_DATA_DIR, { recursive: true });
  await fs.appendFile(INBOX_PATH, `${JSON.stringify(input)}\n`, "utf-8");
}

function parseArgs(args) {
  const parsed = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        appendArg(parsed, key, "true");
      } else {
        appendArg(parsed, key, next);
        index += 1;
      }
    } else {
      parsed._.push(value);
    }
  }

  return parsed;
}

function appendArg(parsed, key, value) {
  if (parsed[key] === undefined) {
    parsed[key] = value;
  } else if (Array.isArray(parsed[key])) {
    parsed[key].push(value);
  } else {
    parsed[key] = [parsed[key], value];
  }
}

function optionValue(value) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function numberOption(value) {
  const raw = optionValue(value);
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitList(value, separator) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => String(item).split(separator))
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireProjectTarget(options, action) {
  if (!optionValue(options["project-id"]) && !optionValue(options["project-name"])) {
    throw new Error(
      `Refusing to ${action} without an explicit project target. Use --project-id <id> or --project-name "Project board". Run "node scripts/agent-bridge.mjs projects" to list projects.`
    );
  }
}

function compact(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== "";
    })
  );
}

function help() {
  console.log(`KanbanBridge agent bridge

Commands:
  projects
  observe "text" [--source codex] [--project-id id] [--project-name name] [--workspace-id id] [--project-path C:\\path] [--kind observation]
  update-observation <observation-id> "updated text"
  list [--limit 20] [--project-id id] [--project-name name]
  snapshot [--project-id id] [--project-name name]
  card "title" --project-id id [--column Backlog] [--description text] [--priority High] [--observation-id id] [--checklist "one|two"]
  update-card <card-id> [--title text] [--description text] [--priority High] [--due-date YYYY-MM-DD]
  checklist <card-id> "checklist item text"
  link-observation <card-id> <observation-id>
  unlink-observation <card-id> <observation-id>
  tag-card <card-id> --project-id id --name "Obs: 6036d5d3"
  untag-card <card-id> --project-id id --name Observation
  move-card <card-id> --project-id id --column "In Progress" [--index 0]
  archive-card <card-id>
  archive <observation-id>

Examples:
  node scripts/agent-bridge.mjs projects
  node scripts/agent-bridge.mjs observe "The card modal should remember its last tab." --source codex --project-id 0e33a86f-7126-488f-9d2a-0aaaffbc6d79
  node scripts/agent-bridge.mjs update-observation 6036d5d3-e1a8-4ca7-bb63-124c1e84e83c "Column plus button should open the card modal."
  node scripts/agent-bridge.mjs observe "Drag feels better now." --source claude-code --project-path "C:\\repo"
  node scripts/agent-bridge.mjs card "Link observations to cards" --project-id 0e33a86f-7126-488f-9d2a-0aaaffbc6d79 --column Backlog --priority High --observation-id 5bd9c675-06b9-4973-8c51-76ec605ddba7 --checklist "Design relation|Render linked notes"
  node scripts/agent-bridge.mjs update-card 15bcece6-fddc-4a6b-9c5a-b57b2c6807ac --priority High
  node scripts/agent-bridge.mjs link-observation 15bcece6-fddc-4a6b-9c5a-b57b2c6807ac 6036d5d3-e1a8-4ca7-bb63-124c1e84e83c
  node scripts/agent-bridge.mjs tag-card 15bcece6-fddc-4a6b-9c5a-b57b2c6807ac --project-id 0e33a86f-7126-488f-9d2a-0aaaffbc6d79 --name "Obs: 6036d5d3"
  node scripts/agent-bridge.mjs move-card 15bcece6-fddc-4a6b-9c5a-b57b2c6807ac --project-id 0e33a86f-7126-488f-9d2a-0aaaffbc6d79 --column "In Progress"
  node scripts/agent-bridge.mjs list --project-id 0e33a86f-7126-488f-9d2a-0aaaffbc6d79 --limit 10
  node scripts/agent-bridge.mjs archive 2aab4bdd-423c-449d-aed8-622df00b9252

If KanbanBridge is open, connector changes are sent through http://127.0.0.1:38731 and the window refreshes live.
If it is closed, observations are queued in ${INBOX_PATH} and imported on next app launch.`);
}
