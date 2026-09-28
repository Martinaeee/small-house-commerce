import type { HomepageDocument } from "./homepage-document";

export const HISTORY_LIMIT = 50 as const;

type SaveState = "idle" | "saving" | "saved" | "error";

export type EditorState = {
  document: HomepageDocument;
  past: HomepageDocument[];
  future: HomepageDocument[];
  rev: number;
  dirty: boolean;
  saveState: SaveState;
  lastSavedAt: string | null;
  conflict: boolean;
  savedDocument: HomepageDocument;
  savingDocument: HomepageDocument | null;
};

export type EditorAction =
  | {
      type: "load";
      document: HomepageDocument;
      rev: number;
      savedAt: string | null;
    }
  | { type: "commit"; document: HomepageDocument }
  /**
   * Applies a mutation to the reducer's latest document. Async producers
   * (debounced text buffers, coalesced inputs) must use this instead of
   * pre-building a document from a render-captured snapshot: two timers that
   * expire in the same flush would otherwise each install a document built
   * from the same stale snapshot and silently drop the other's edit.
   */
  | {
      type: "mutate";
      mutate: (document: HomepageDocument) => HomepageDocument;
    }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saving" }
  | { type: "saved"; rev: number; savedAt: string | null }
  | { type: "saveError" }
  | { type: "conflict" }
  | {
      type: "resolveConflict";
      document: HomepageDocument;
      rev: number;
      savedAt: string | null;
    };

type EditorSnapshot = {
  document: HomepageDocument;
  rev: number;
  savedAt: string | null;
};

function createLoadedState(snapshot: EditorSnapshot): EditorState {
  return {
    document: snapshot.document,
    savedDocument: snapshot.document,
    past: [],
    future: [],
    rev: snapshot.rev,
    dirty: false,
    saveState: "idle",
    lastSavedAt: snapshot.savedAt,
    conflict: false,
    savingDocument: null,
  };
}

function capPast(documents: HomepageDocument[]): HomepageDocument[] {
  return documents.length > HISTORY_LIMIT
    ? documents.slice(-HISTORY_LIMIT)
    : documents;
}

function capFuture(documents: HomepageDocument[]): HomepageDocument[] {
  return documents.length > HISTORY_LIMIT
    ? documents.slice(0, HISTORY_LIMIT)
    : documents;
}

function isDirty(
  document: HomepageDocument,
  savedDocument: HomepageDocument,
): boolean {
  return document !== savedDocument;
}

/** Shared history/dirty transition for `commit` and `mutate`. */
function applyDocument(
  state: EditorState,
  document: HomepageDocument,
): EditorState {
  return {
    ...state,
    document,
    past: capPast([...state.past, state.document]),
    future: [],
    dirty: isDirty(document, state.savedDocument),
  };
}

export function initEditorState(snapshot: EditorSnapshot): EditorState {
  return createLoadedState(snapshot);
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "load":
      return createLoadedState(action);

    case "commit":
      return applyDocument(state, action.document);

    case "mutate": {
      const document = action.mutate(state.document);
      // A mutation that returns the same reference changed nothing: keep the
      // exact state so no history entry and no dirty flag are produced.
      return document === state.document
        ? state
        : applyDocument(state, document);
    }

    case "undo": {
      if (state.past.length === 0) {
        return state;
      }

      const document = state.past[state.past.length - 1];
      return {
        ...state,
        document,
        past: state.past.slice(0, -1),
        future: capFuture([state.document, ...state.future]),
        dirty: isDirty(document, state.savedDocument),
      };
    }

    case "redo": {
      if (state.future.length === 0) {
        return state;
      }

      const document = state.future[0];
      return {
        ...state,
        document,
        past: capPast([...state.past, state.document]),
        future: state.future.slice(1),
        dirty: isDirty(document, state.savedDocument),
      };
    }

    case "saving":
      return {
        ...state,
        saveState: "saving",
        savingDocument: state.document,
        conflict: false,
        dirty: isDirty(state.document, state.savedDocument),
      };

    case "saved": {
      const savedDocument = state.savingDocument ?? state.document;
      return {
        ...state,
        savedDocument,
        savingDocument: null,
        rev: action.rev,
        lastSavedAt: action.savedAt,
        saveState: "saved",
        conflict: false,
        dirty: isDirty(state.document, savedDocument),
      };
    }

    case "saveError":
      return {
        ...state,
        saveState: "error",
        savingDocument: null,
      };

    case "conflict":
      return {
        ...state,
        saveState: "error",
        savingDocument: null,
        conflict: true,
      };

    case "resolveConflict":
      return createLoadedState(action);
  }
}
