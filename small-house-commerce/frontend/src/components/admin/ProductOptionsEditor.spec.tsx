import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphDraftHarness, draftJson } from "@/test/harness";
import type {
  AdminCatalogGraphDraft,
  AdminOptionDraft,
  AdminOptionValueDraft,
} from "@/lib/admin-product-graph";
import { ProductOptionsEditor } from "@/components/admin/ProductOptionsEditor";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

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
    <AdminI18nProvider>
      <GraphDraftHarness
        initial={initial}
        render={(draft, onChange) => (
          <ProductOptionsEditor draft={draft} onChange={onChange} />
        )}
      />
    </AdminI18nProvider>
  );
}

beforeEach(() => {
  setAdminLang("en");
});

async function setTypeahead(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
): Promise<void> {
  await user.selectOptions(screen.getByRole("combobox", { name: label }), option);
}

describe("ProductOptionsEditor", () => {
  it("renders operator names for option name, type, display style, and values", () => {
    render(<Harness initial={draft([optionDraft()])} />);

    expect(screen.getByLabelText("Option 1 name")).toHaveValue("Color");
    expect(screen.getByLabelText("Option 1 type")).toHaveValue("COLOR");
    expect(screen.getByLabelText("Option 1 display style")).toHaveValue("TEXT");
    expect(screen.getByText(/Option values/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Option 1 media driver" })).not.toBeInTheDocument();
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
    const thirdEnabled = screen.getByRole("checkbox", { name: "Option 3 enabled" });
    expect(thirdEnabled).toBeDisabled();
    expect(
      screen.getByText(/At most two option groups can be enabled/),
    ).toBeInTheDocument();

    await user.click(thirdEnabled).catch(() => undefined);
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
    expect(screen.getAllByText(/110 candidates/).length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent(/110/);
    expect(screen.getByRole("alert")).toHaveTextContent(/100/);
  });

  it("shows a swatch field for SWATCH presentation", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await setTypeahead(user, "Option 1 display style", "SWATCH");
    const swatch = screen.getAllByLabelText("Value 1 swatch hex")[1]!;
    await user.type(swatch, "#ff0000");
    expect(
      (draftJson() as AdminCatalogGraphDraft).options[0].values[0].swatchHex,
    ).toBe("#ff0000");
  });

  it("warns when an IMAGE presentation value has no thumbnail and clears the warning once set", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await setTypeahead(user, "Option 1 display style", "IMAGE");
    expect(screen.getByText(/selector thumbnail/i)).toBeInTheDocument();
    expect(screen.getByText(/falls back to the first image/i)).toBeInTheDocument();

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

  it("disables a persisted value with the status control instead of removing it", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft([
          optionDraft({ values: [valueDraft({ id: "val-1", clientKey: undefined })] }),
        ])}
      />,
    );

    expect(screen.queryByRole("button", { name: /Remove option value/i })).not.toBeInTheDocument();
    const status = screen.getByRole("checkbox", { name: "Value 1 enabled" });
    await user.click(status);
    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options[0].values[0].isActive).toBe(false);
    expect(state.options[0].values[0].id).toBe("val-1");
  });

  it("removes a draft-only value outright", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await user.click(screen.getByRole("button", { name: "Remove option value" }));
    expect(
      (draftJson() as AdminCatalogGraphDraft).options[0].values,
    ).toHaveLength(0);
  });

  it("removes media and variants orphaned by a draft-only value", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft([optionDraft()], {
          variants: [
            {
              clientKey: "variant-new",
              name: "Red",
              position: 0,
              combinationKey: "red",
              optionValueRefs: [{ clientKey: "value-1" }],
              sku: null,
            },
          ],
          media: [
            {
              clientKey: "value-media",
              url: "not-a-url",
              type: "IMAGE",
              altText: null,
              sortOrder: 0,
              optionValueRef: { clientKey: "value-1" },
              variantRef: null,
            },
            {
              clientKey: "variant-media",
              url: "not-a-url",
              type: "IMAGE",
              altText: null,
              sortOrder: 0,
              optionValueRef: null,
              variantRef: { clientKey: "variant-new" },
            },
          ],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove option value" }));

    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options[0].values).toHaveLength(0);
    expect(state.variants).toHaveLength(0);
    expect(state.media).toHaveLength(0);
  });

  it("removes media and variants orphaned by a draft-only option group", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft(
          [optionDraft({ id: undefined, clientKey: "option-new" })],
          {
            variants: [
              {
                clientKey: "variant-new",
                name: "Red",
                position: 0,
                combinationKey: "red",
                optionValueRefs: [{ clientKey: "value-1" }],
                sku: null,
              },
            ],
            media: [
              {
                clientKey: "value-media",
                url: "not-a-url",
                type: "IMAGE",
                altText: null,
                sortOrder: 0,
                optionValueRef: { clientKey: "value-1" },
                variantRef: null,
              },
              {
                clientKey: "variant-media",
                url: "not-a-url",
                type: "IMAGE",
                altText: null,
                sortOrder: 0,
                optionValueRef: null,
                variantRef: { clientKey: "variant-new" },
              },
            ],
          },
        )}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove option group" }));

    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options).toHaveLength(0);
    expect(state.variants).toHaveLength(0);
    expect(state.media).toHaveLength(0);
  });

  it("adds a value and a new group with request-local client keys", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    await user.click(screen.getByRole("button", { name: "Add option value" }));
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

  it("uses one enabled status control for a persisted group without a deactivate action", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft([optionDraft()])} />);

    const status = screen.getByRole("checkbox", { name: "Option 1 enabled" });
    expect(status).toBeChecked();
    expect(screen.queryByRole("button", { name: /Deactivate/i })).not.toBeInTheDocument();

    await user.click(status);
    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options[0].isActive).toBe(false);
    expect(state.options[0].id).toBe("option-1");
  });

  it("keeps the same enabled control and offers remove only for an unsaved group", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft([
          optionDraft({ id: undefined, clientKey: "option-new" }),
        ])}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Option 1 enabled" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Remove option group" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove option group" }));
    expect((draftJson() as AdminCatalogGraphDraft).options).toHaveLength(0);
  });

  it("uses one enabled status control for a persisted value without a deactivate action", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={draft([
          optionDraft({ values: [valueDraft({ id: "value-1", clientKey: undefined })] }),
        ])}
      />,
    );

    const status = screen.getByRole("checkbox", { name: "Value 1 enabled" });
    expect(status).toBeChecked();
    expect(screen.queryByRole("button", { name: /Deactivate/i })).not.toBeInTheDocument();
    await user.click(status);
    const state = draftJson() as AdminCatalogGraphDraft;
    expect(state.options[0].values[0].isActive).toBe(false);
    expect(state.options[0].values[0].id).toBe("value-1");
  });
});
