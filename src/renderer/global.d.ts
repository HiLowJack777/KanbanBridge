import type { ProjectBoardApi } from "../shared/types";

declare global {
  interface Window {
    projectBoard: ProjectBoardApi;
  }
}

export {};

