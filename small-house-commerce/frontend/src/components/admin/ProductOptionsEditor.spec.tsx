import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphDraftHarness, draftJson } from "@/test/harness";
import type {
  AdminCatalogGraphDraft,
  AdminOptionDraft,
  AdminOptionValueDraft,
} from "@/lib/admin-product-graph";
import { ProductOptionsEditor } from "@/components/admin/ProductOptionsEditor";

/**
 * Task 11 — typed option group editing: kinds/presentations, media driver,
 * third-option blocking (≤2 active groups), candidate cap display, thumbnail
 * warnings, and the protected disable path for persisted values.
 */

function valueDraft(
  overrides: Partial<AdminOptionValueDraft> = {},
): AdminOptionValueDraft {
  return {
    clientKey: "value-1",
    label: "Red",
    position: 0,
    swatchHex: null,
    thumbnailUrl: null,
    thumbnailAlt: null,
    isActive: true,
    ...overrides,
  };
}

function optionDraft(
  overrides: Partial<AdminOptionDraft> = {},
): AdminOptionDraft {
  return {
    id: "option-1",
    kind: "COLOR",
    name: "Color",
    position: 0,
    presentation: "TEXT",
    isMediaDriver: false,
    isActive: true,
    values: [valueDraft()],
    ...overrides,
  };
}

function draft(
  options: AdminOptionDraft[],
  overrides: Partial<AdminCatalogGraphDraft> = {},
): AdminCatalogGraphDraft {
  return {
    catalogGraphVersion: 1,
    defaultDisplayVariantRef: null,
    options,
    variants: [],
    media: [],
    ...overrides,
  };
}

function Harness({ initial }: { initial: AdminCatalogGraphDraft }) {
  return (
    <GraphDraftHarness
      initial={initial}
      render={(draft, onChange) => (
        <ProductOptionsEditor draft={draft} onChange={onChange} />
      )}
    />
  );
}

async function setTypeahead(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
): Promise<void> {
  await user.selectOptions(screen.getByRole("combobox", { name: label }), option);
}

describe("ProductOptionsEditor", () => {
  it("renders group name, kind, and presentation controls", () => {
    render(<Harness initial={draft([optionDraft()])} />);

    expect(screen.getByLabelText("Option 1 name")).toHaveValue("Color");
    expect(screen.getByLabelText("Option 1 kind")).toHaveValue("COLOR");
    expect(screen.getByLabelText("Option 1 presentation")).toHaveValue("TEXT");
    expect(
      screen.getByRole("checkbox", { name: "Option 1 media driver" }),
    ).not.toBeChecked();
  });

  it("renames a group through onChange", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await user.type(screen.getByLabelText("Option 1 name"), "X");
    expect((draftJson() as AdminCatalogGraphDraft).options[0].name).toBe(
      "ColorX",
    );
  });

  it("blocks a third active option group", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft([
          optionDraft({ id: "option-1", name: "Color", position: 0 }),
          optionDraft({
            id: "option-2",
            name: "Size",
            kind: "SIZE",
            position: 1,
            values: [valueDraft({ clientKey: "value-s", label: "M" })],
          }),
          optionDraft({
            id: "option-3",
            name: "Material",
            kind: "MATERIAL",
            position: 2,
            isActive: false,
            values: [valueDraft({ clientKey: "value-m", label: "Oak" })],
          }),
        ])}
      />,
    );

    // Adding a fourth group is blocked…
    expect(screen.getByRole("button", { name: /Add option group/i })).toBeDisabled();
    // …and the third (inactive) group cannot be activated.
    const thirdActive = screen.getByRole("checkbox", { name: "Option 3 active" });
    expect(thirdActive).toBeDisabled();
    expect(
      screen.getByText(/最多同时启用两个选项组/),
    ).toBeInTheDocument();

    await user.click(thirdActive).catch(() => undefined);
    // Clicking a disabled checkbox must not mutate the draft.
    expect(
      (draftJson() as AdminCatalogGraphDraft).options[2].isActive,
    ).toBe(false);
  });

  it("reports the candidate count and the >100 cap as a validation alert", () => {
    const manyValues = Array.from({ length: 11 }, (_, i) =>
      valueDraft({ clientKey: `v-a-${i}`, label: `A${i}`, position: i }),
    );
    const manySizes = Array.from({ length: 10 }, (_, i) =>
      valueDraft({ clientKey: `v-b-${i}`, label: `B${i}`, position: i }),
    );
    render(
      <Harness
        initial={draft([
          optionDraft({ id: "option-1", values: manyValues }),
          optionDraft({
            id: "option-2",
            name: "Size",
            kind: "SIZE",
            position: 1,
            values: manySizes,
          }),
        ])}
      />,
    );

    // Summary shows the real count; the alert names the cap violation.
    expect(screen.getByText(/候选款式：110/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/110/);
    expect(screen.getByRole("alert")).toHaveTextContent(/100/);
  });

  it("shows a swatch field for SWATCH presentation", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await setTypeahead(user, "Option 1 presentation", "SWATCH");
    const swatch = screen.getByLabelText("Value 1 swatch hex");
    await user.type(swatch, "#ff0000");
    expect(
      (draftJson() as AdminCatalogGraphDraft).options[0].values[0].swatchHex,
    ).toBe("#ff0000");
  });

  it("warns when an IMAGE presentation value has no thumbnail and clears the warning once set", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await setTypeahead(user, "Option 1 presentation", "IMAGE");
    expect(screen.getByText(/建议上传缩略图/)).toBeInTheDocument();

    // The existing ImageUrlInput uploader is reused (upload button present).
    expect(
      screen.getByRole("button", { name: "上传图片" }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Thumbnail for Red"), "/uploads/a.jpg");
    expect(
      (draftJson() as AdminCatalogGraphDraft).options[0].values[0].thumbnailUrl,
    ).toBe("/uploads/a.jpg");
    expect(screen.queryByText(/建议上传缩略图/)).not.toBeInTheDocument();
  });

  it("deactivates a persisted value (protected) instead of removing it", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft([
          optionDraft({ values: [valueDraft({ id: "val-1", clientKey: undefined })] }),
        ])}
      />,
    );

    // Persisted values offer deactivate, never a hard Remove.
    expect(screen.queryByRole("button", { name: /^Remove$/ })).not.toBeInTheDocument();
    const valueRow = screen.getByLabelText("Value 1 label").closest("li");
    expect(valueRow).not.toBeNull();
    await user.click(
      within(valueRow as HTMLElement).getByRole("button", { name: /Deactivate/i }),
    );
    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options[0].values[0].isActive).toBe(false);
    expect(state.options[0].values[0].id).toBe("val-1");
  });

  it("removes a draft-only value outright", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await user.click(screen.getByRole("button", { name: /^Remove$/ }));
    expect(
      (draftJson() as AdminCatalogGraphDraft).options[0].values,
    ).toHaveLength(0);
  });

  it("adds a value and a new group with request-local client keys", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await user.click(screen.getByRole("button", { name: "Add value" }));
    await user.type(screen.getByLabelText("Value 2 label"), "Blue");

    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options[0].values).toHaveLength(2);
    expect(state.options[0].values[1].label).toBe("Blue");
    expect(state.options[0].values[1].clientKey).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Add option group/i }));
    const next = draftJson() as AdminCatalogGraphDraft;
    expect(next.options).toHaveLength(2);
    expect(next.options[1].clientKey).toBeTruthy();
    expect(next.options[1].kind).toBe("COLOR");
  });

  it("allows exactly one media driver and blocks a second", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft([
          optionDraft({ isMediaDriver: true }),
          optionDraft({
            id: "option-2",
            name: "Size",
            kind: "SIZE",
            position: 1,
            values: [valueDraft({ clientKey: "value-s", label: "M" })],
          }),
        ])}
      />,
    );

    const second = screen.getByRole("checkbox", { name: "Option 2 media driver" });
    expect(second).toBeDisabled();
    await user.click(second).catch(() => undefined);
    expect(
      (draftJson() as AdminCatalogGraphDraft).options[1].isMediaDriver,
    ).toBe(false);
  });
});
