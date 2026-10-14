import { describe, expect, it } from "vitest";
import type { HomepageDocument } from "./homepage-document";
import {
  editorReducer,
  initEditorState,
  type EditorState,
} from "./homepage-editor-state";

function makeDocument(id: string): HomepageDocument {
  return {
    schemaVersion: 1,
    sections: [
      {
        id,
        title: null,
        subtitle: null,
        enabled: true,
        sortOrder: 0,
        schedule: { publishAt: null, unpublishAt: null },
        products: [],
        type: "BRAND_STORY",
        payload: { bullets: [id] },
      },
    ],
    announcement: {
      enabled: false,
      rotationMs: 0,
      items: [],
    },
  };
}

function loadedState(
  document = makeDocument("saved"),
  rev = 1,
  savedAt = "2026-09-28T00:00:00.000Z",
): EditorState {
  return initEditorState({ document, rev, savedAt });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

describe("homepage editor reducer", () => {
  it("initializes with the supplied document reference as the saved snapshot", () => {
    const document = makeDocument("initial");

    const state = initEditorState({
      document,
      rev: 3,
      savedAt: "2026-09-28T01:00:00.000Z",
    });

    expect(state.document).toBe(document);
    expect(state.savedDocument).toBe(document);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(state.savingDocument).toBeNull();
    expect(state.rev).toBe(3);
    expect(state.dirty).toBe(false);
    expect(state.saveState).toBe("idle");
    expect(state.lastSavedAt).toBe("2026-09-28T01:00:00.000Z");
    expect(state.conflict).toBe(false);
  });

  it("commit pushes the previous document onto past and marks dirty", () => {
    const initial = makeDocument("initial");
    const edited = makeDocument("edited");
    const state = loadedState(initial);

    const next = editorReducer(state, { type: "commit", document: edited });

    expect(next.document).toBe(edited);
    expect(next.past).toEqual([initial]);
    expect(next.past[0]).toBe(initial);
    expect(next.future).toEqual([]);
    expect(next.savedDocument).toBe(initial);
    expect(next.dirty).toBe(true);
    expect(next.rev).toBe(state.rev);
    expect(next.saveState).toBe(state.saveState);
  });

  it("mutate installs the mutation result with the same history and dirty semantics as commit", () => {
    const initial = makeDocument("initial");
    const mutated = makeDocument("mutated");
    const state = loadedState(initial);

    const next = editorReducer(state, {
      type: "mutate",
      mutate: () => mutated,
    });

    expect(next.document).toBe(mutated);
    expect(next.past).toEqual([initial]);
    expect(next.past[0]).toBe(initial);
    expect(next.future).toEqual([]);
    expect(next.savedDocument).toBe(initial);
    expect(next.dirty).toBe(true);
    expect(next.rev).toBe(state.rev);
    expect(next.saveState).toBe(state.saveState);
    expect(next.conflict).toBe(state.conflict);
    expect(next.lastSavedAt).toBe(state.lastSavedAt);
  });

  it("mutate applies to the latest document so queued mutations cannot drop each other's edit", () => {
    const initial = makeDocument("initial");
    let state = loadedState(initial);

    // Both callers captured the same pre-edit snapshot; each mutation must
    // still see the document produced by the mutation before it.
    state = editorReducer(state, {
      type: "mutate",
      mutate: (document) => ({
        ...document,
        announcement: { ...document.announcement, rotationMs: 4000 },
      }),
    });
    state = editorReducer(state, {
      type: "mutate",
      mutate: (document) => ({
        ...document,
        announcement: { ...document.announcement, enabled: true },
      }),
    });

    expect(state.document.announcement.rotationMs).toBe(4000);
    expect(state.document.announcement.enabled).toBe(true);
    expect(state.past).toHaveLength(2);
    expect(state.past[0]).toBe(initial);
  });

  it("mutate recomputes dirty and undo walks back over its history entries", () => {
    const initial = makeDocument("initial");
    const first = makeDocument("first");
    let state = loadedState(initial);

    state = editorReducer(state, { type: "mutate", mutate: () => first });
    state = editorReducer(state, {
      type: "mutate",
      mutate: () => makeDocument("second"),
    });

    const undone = editorReducer(state, { type: "undo" });
    expect(undone.document).toBe(first);
    expect(undone.dirty).toBe(true);

    const undoneAgain = editorReducer(undone, { type: "undo" });
    expect(undoneAgain.document).toBe(initial);
    expect(undoneAgain.dirty).toBe(false);
  });

  it("mutate returning the same document reference is a no-op", () => {
    const state = loadedState(makeDocument("initial"));

    const next = editorReducer(state, {
      type: "mutate",
      mutate: (document) => document,
    });

    expect(next).toBe(state);
    expect(next.past).toEqual([]);
  });

  it("mutate leaves a frozen state untouched and installs a new document", () => {
    const initial = deepFreeze(makeDocument("initial"));
    const state = deepFreeze(loadedState(initial));

    const next = editorReducer(state, {
      type: "mutate",
      mutate: (document) => ({
        ...document,
        announcement: { ...document.announcement, rotationMs: 6000 },
      }),
    });

    expect(next).not.toBe(state);
    expect(state.document).toBe(initial);
    expect(state.past).toEqual([]);
    expect(next.document).not.toBe(initial);
    expect(next.document.announcement.rotationMs).toBe(6000);
    expect(next.dirty).toBe(true);
  });

  it("undo and redo walk history and clear dirty when returning to the saved reference", () => {
    const initial = makeDocument("initial");
    const edited = makeDocument("edited");
    const state = editorReducer(loadedState(initial), {
      type: "commit",
      document: edited,
    });

    const undone = editorReducer(state, { type: "undo" });
    expect(undone.document).toBe(initial);
    expect(undone.past).toEqual([]);
    expect(undone.future).toEqual([edited]);
    expect(undone.dirty).toBe(false);

    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.document).toBe(edited);
    expect(redone.past).toEqual([initial]);
    expect(redone.future).toEqual([]);
    expect(redone.dirty).toBe(true);
  });

  it("caps history at 50 entries while retaining the newest entries in undo order", () => {
    const initial = makeDocument("initial");
    const commits = Array.from({ length: 60 }, (_, index) =>
      makeDocument(`commit-${index}`),
    );
    let state = loadedState(initial);

    for (const document of commits) {
      state = editorReducer(state, { type: "commit", document });
    }

    expect(state.past).toHaveLength(50);
    expect(state.past).toEqual(commits.slice(9, 59));
    expect(state.document).toBe(commits[59]);

    const undone: HomepageDocument[] = [];
    for (let index = 0; index < 50; index += 1) {
      state = editorReducer(state, { type: "undo" });
      undone.push(state.document);
    }

    expect(undone).toEqual(commits.slice(9, 59).reverse());
    expect(state.past).toEqual([]);
    expect(editorReducer(state, { type: "undo" })).toBe(state);
  });

  it("load replaces the document and clears history, save, error, and conflict state", () => {
    const initial = makeDocument("initial");
    const edited = makeDocument("edited");
    const latest = makeDocument("latest");
    let state = editorReducer(loadedState(initial), {
      type: "commit",
      document: edited,
    });
    state = editorReducer(state, { type: "saving" });
    state = editorReducer(state, { type: "conflict" });

    const loaded = editorReducer(state, {
      type: "load",
      document: latest,
      rev: 8,
      savedAt: "2026-09-28T08:00:00.000Z",
    });

    expect(loaded.document).toBe(latest);
    expect(loaded.savedDocument).toBe(latest);
    expect(loaded.past).toEqual([]);
    expect(loaded.future).toEqual([]);
    expect(loaded.savingDocument).toBeNull();
    expect(loaded.rev).toBe(8);
    expect(loaded.lastSavedAt).toBe("2026-09-28T08:00:00.000Z");
    expect(loaded.dirty).toBe(false);
    expect(loaded.saveState).toBe("idle");
    expect(loaded.conflict).toBe(false);
  });

  it("saved records the server revision and clears dirty using the saved reference", () => {
    const initial = makeDocument("initial");
    const edited = makeDocument("edited");
    let state = editorReducer(loadedState(initial), {
      type: "commit",
      document: edited,
    });
    state = editorReducer(state, { type: "saving" });

    const saved = editorReducer(state, {
      type: "saved",
      rev: 4,
      savedAt: "2026-09-28T04:00:00.000Z",
    });

    expect(saved.document).toBe(edited);
    expect(saved.savedDocument).toBe(edited);
    expect(saved.savingDocument).toBeNull();
    expect(saved.rev).toBe(4);
    expect(saved.lastSavedAt).toBe("2026-09-28T04:00:00.000Z");
    expect(saved.dirty).toBe(false);
    expect(saved.saveState).toBe("saved");
    expect(saved.conflict).toBe(false);
  });

  it("keeps a later local commit dirty when a saved response confirms an earlier document", () => {
    const documentA = makeDocument("a");
    const documentB = makeDocument("b");
    let state = loadedState(documentA, 2, "before");
    state = editorReducer(state, { type: "saving" });
    state = editorReducer(state, { type: "commit", document: documentB });

    const saved = editorReducer(state, {
      type: "saved",
      rev: 3,
      savedAt: "after",
    });

    expect(saved.document).toBe(documentB);
    expect(saved.savedDocument).toBe(documentA);
    expect(saved.savingDocument).toBeNull();
    expect(saved.dirty).toBe(true);
    expect(saved.rev).toBe(3);
    expect(saved.lastSavedAt).toBe("after");
  });

  it("undoes and redoes around a newly saved snapshot by reference", () => {
    const initial = makeDocument("initial");
    const savedEdit = makeDocument("saved-edit");
    const unsavedEdit = makeDocument("unsaved-edit");
    let state = loadedState(initial);
    state = editorReducer(state, { type: "commit", document: savedEdit });
    state = editorReducer(state, { type: "saving" });
    state = editorReducer(state, {
      type: "saved",
      rev: 2,
      savedAt: "saved",
    });
    state = editorReducer(state, { type: "commit", document: unsavedEdit });

    const undone = editorReducer(state, { type: "undo" });
    expect(undone.document).toBe(savedEdit);
    expect(undone.dirty).toBe(false);

    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.document).toBe(unsavedEdit);
    expect(redone.dirty).toBe(true);
  });

  it("clears the redo branch when committing after undo", () => {
    const initial = makeDocument("initial");
    const first = makeDocument("first");
    const abandoned = makeDocument("abandoned");
    const branch = makeDocument("branch");
    let state = loadedState(initial);
    state = editorReducer(state, { type: "commit", document: first });
    state = editorReducer(state, { type: "commit", document: abandoned });
    state = editorReducer(state, { type: "undo" });

    state = editorReducer(state, { type: "commit", document: branch });

    expect(state.document).toBe(branch);
    expect(state.past).toEqual([initial, first]);
    expect(state.future).toEqual([]);
    expect(editorReducer(state, { type: "redo" })).toBe(state);
  });

  it("returns the exact state for empty undo and redo", () => {
    const state = loadedState();

    expect(editorReducer(state, { type: "undo" })).toBe(state);
    expect(editorReducer(state, { type: "redo" })).toBe(state);
  });

  it("saving captures the current reference and clears a transient conflict", () => {
    const initial = makeDocument("initial");
    const edited = makeDocument("edited");
    let state = editorReducer(loadedState(initial), {
      type: "commit",
      document: edited,
    });
    state = editorReducer(state, { type: "conflict" });

    const saving = editorReducer(state, { type: "saving" });

    expect(saving.saveState).toBe("saving");
    expect(saving.savingDocument).toBe(edited);
    expect(saving.document).toBe(edited);
    expect(saving.dirty).toBe(true);
    expect(saving.conflict).toBe(false);
  });

  it("saveError retains the exact local document, history, dirty flag, revision, and conflict state", () => {
    const initial = makeDocument("initial");
    const edited = makeDocument("edited");
    let state = editorReducer(loadedState(initial, 5, "before"), {
      type: "commit",
      document: edited,
    });
    state = editorReducer(state, { type: "saving" });
    const beforeError = state;

    const errored = editorReducer(state, { type: "saveError" });

    expect(errored.document).toBe(beforeError.document);
    expect(errored.past).toBe(beforeError.past);
    expect(errored.future).toBe(beforeError.future);
    expect(errored.savedDocument).toBe(beforeError.savedDocument);
    expect(errored.dirty).toBe(beforeError.dirty);
    expect(errored.rev).toBe(beforeError.rev);
    expect(errored.lastSavedAt).toBe(beforeError.lastSavedAt);
    expect(errored.conflict).toBe(beforeError.conflict);
    expect(errored.savingDocument).toBeNull();
    expect(errored.saveState).toBe("error");
  });

  it("a conflict keeps the local document and history while clearing an in-flight save", () => {
    const initial = makeDocument("initial");
    const edited = makeDocument("edited");
    let state = editorReducer(loadedState(initial, 5, "before"), {
      type: "commit",
      document: edited,
    });
    state = editorReducer(state, { type: "saving" });
    const beforeConflict = state;

    const conflicted = editorReducer(state, { type: "conflict" });

    expect(conflicted.document).toBe(beforeConflict.document);
    expect(conflicted.past).toBe(beforeConflict.past);
    expect(conflicted.future).toBe(beforeConflict.future);
    expect(conflicted.savedDocument).toBe(beforeConflict.savedDocument);
    expect(conflicted.dirty).toBe(beforeConflict.dirty);
    expect(conflicted.rev).toBe(beforeConflict.rev);
    expect(conflicted.lastSavedAt).toBe(beforeConflict.lastSavedAt);
    expect(conflicted.savingDocument).toBeNull();
    expect(conflicted.saveState).toBe("error");
    expect(conflicted.conflict).toBe(true);
  });

  it("resolveConflict adopts the server document and resets all local state", () => {
    const initial = makeDocument("initial");
    const edited = makeDocument("edited");
    const server = makeDocument("server");
    let state = editorReducer(loadedState(initial), {
      type: "commit",
      document: edited,
    });
    state = editorReducer(state, { type: "saving" });
    state = editorReducer(state, { type: "conflict" });

    const resolved = editorReducer(state, {
      type: "resolveConflict",
      document: server,
      rev: 9,
      savedAt: "resolved",
    });

    expect(resolved.document).toBe(server);
    expect(resolved.savedDocument).toBe(server);
    expect(resolved.past).toEqual([]);
    expect(resolved.future).toEqual([]);
    expect(resolved.savingDocument).toBeNull();
    expect(resolved.rev).toBe(9);
    expect(resolved.lastSavedAt).toBe("resolved");
    expect(resolved.dirty).toBe(false);
    expect(resolved.saveState).toBe("idle");
    expect(resolved.conflict).toBe(false);
  });

  it("never mutates state, history arrays, documents, or action documents", () => {
    const initial = deepFreeze(makeDocument("initial"));
    const edited = deepFreeze(makeDocument("edited"));
    const state = deepFreeze(
      editorReducer(loadedState(initial), {
        type: "commit",
        document: edited,
      }),
    );
    const nextDocument = deepFreeze(makeDocument("next"));
    const before = {
      document: state.document,
      savedDocument: state.savedDocument,
      past: [...state.past],
      future: [...state.future],
      dirty: state.dirty,
    };

    const next = editorReducer(state, {
      type: "commit",
      document: nextDocument,
    });

    expect(state.document).toBe(before.document);
    expect(state.savedDocument).toBe(before.savedDocument);
    expect(state.past).toEqual(before.past);
    expect(state.future).toEqual(before.future);
    expect(state.dirty).toBe(before.dirty);
    expect(next.document).toBe(nextDocument);
    expect(next.past[1]).toBe(edited);
  });
});
