import { screen } from "@testing-library/react";
import { useCallback, useState, type ReactNode } from "react";
import type { AdminCatalogGraphDraft } from "@/lib/admin-product-graph";

/**
 * Shared component-test harness for the Task 11 admin editors.
 *
 * The editors receive `(mutate) => void` so the owner decides how drafts are
 * cloned; the harness mirrors ProductForm.updateGraph: clone, mutate, replace.
 * The latest draft is rendered as JSON so specs can assert on the produced
 * graph state without reaching into component internals.
 */
export function GraphDraftHarness({
  initial,
  render,
}: {
  initial: AdminCatalogGraphDraft;
  render: (
    draft: AdminCatalogGraphDraft,
    onChange: (mutate: (draft: AdminCatalogGraphDraft) => void) => void,
  ) => ReactNode;
}): ReactNode {
  const [draft, setDraft] = useState(initial);
  const onChange = useCallback(
    (mutate: (draft: AdminCatalogGraphDraft) => void): void => {
      setDraft((prev) => {
        const next = structuredClone(prev);
        mutate(next);
        return next;
      });
    },
    [],
  );
  return (
    <div>
      {render(draft, onChange)}
      <pre data-testid="draft-json">{JSON.stringify(draft)}</pre>
    </div>
  );
}

/** Parses the harness' dumped draft for structural assertions. */
export function draftJson(): AdminCatalogGraphDraft {
  const text = screen.getByTestId("draft-json").textContent ?? "{}";
  return JSON.parse(text) as AdminCatalogGraphDraft;
}
