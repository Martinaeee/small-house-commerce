import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  deriveStorefrontTheme,
  themePublicationIssues,
} from "@/lib/storefront-theme";
import {
  createCurrentLuwagShellDocument,
  type StorefrontThemeSource as DocumentThemeSource,
} from "@/lib/storefront-shell-document";
import { BrandThemeEditor } from "./BrandThemeEditor";

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));

function currentTheme(): DocumentThemeSource {
  return createCurrentLuwagShellDocument({
    rootCategories: [],
    navigationCollections: [],
    supportEmail: "support@luwag.ph",
    supportHours: "Mon–Sat, 9am–6pm (PHT)",
  }).theme;
}

function Harness({ initial }: { initial?: DocumentThemeSource }) {
  const [theme, setTheme] = useState<DocumentThemeSource>(
    () => initial ?? currentTheme(),
  );
  return (
    <>
      <BrandThemeEditor theme={theme} onChange={setTheme} />
      <output data-testid="theme-state">{JSON.stringify(theme)}</output>
    </>
  );
}

function state(): DocumentThemeSource {
  return JSON.parse(screen.getByTestId("theme-state").textContent!);
}

describe("BrandThemeEditor", () => {
  it("exposes exactly the five editable colors and the fixed font enums", () => {
    render(<Harness />);

    const controls = [
      ["primary", "storefront_shell_theme_primary"],
      ["action", "storefront_shell_theme_action"],
      ["background", "storefront_shell_theme_background"],
      ["surface", "storefront_shell_theme_surface"],
      ["text", "storefront_shell_theme_text"],
    ] as const;
    for (const [key, label] of controls) {
      const color = screen.getByLabelText(label) as HTMLInputElement;
      expect(color).toHaveValue(currentTheme()[key]);
      expect(color).toHaveAttribute("type", "color");
    }

    const heading = screen.getByRole("combobox", {
      name: "storefront_shell_theme_heading_font",
    });
    expect(
      Array.from(heading.querySelectorAll("option")).map(
        (option) => option.value,
      ),
    ).toEqual(["SYSTEM", "POPPINS_HEADING", "SERIF_HEADING"]);

    const body = screen.getByRole("combobox", {
      name: "storefront_shell_theme_body_font",
    });
    expect(body).toHaveValue("SYSTEM");
    expect(
      Array.from(body.querySelectorAll("option")).map((option) => option.value),
    ).toEqual(["SYSTEM"]);
  });

  it("commits a color change to the draft and keeps the other tokens", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("storefront_shell_theme_action"), {
      target: { value: "#123456" },
    });

    expect(state().action).toBe("#123456");
    expect(state().primary).toBe(currentTheme().primary);
    expect(state().background).toBe(currentTheme().background);
  });

  it("resets every token to the current LUWAG theme", () => {
    render(
      <Harness
        initial={{
          ...currentTheme(),
          primary: "#000001",
          action: "#000002",
          background: "#000003",
          surface: "#000004",
          text: "#000005",
          headingFont: "SERIF_HEADING",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_theme_reset" }),
    );

    expect(state()).toEqual(currentTheme());
  });

  it("renders live derived swatches and the exact contrast issues", () => {
    render(<Harness />);

    const derived = deriveStorefrontTheme(currentTheme());
    expect(
      screen.getByTestId("theme-derived-primary-dark"),
    ).toHaveTextContent(derived.primaryDark);
    expect(screen.getByTestId("theme-derived-focus")).toHaveTextContent(
      derived.focus,
    );
    expect(screen.getByTestId("theme-issues")).toHaveTextContent(
      "storefront_shell_theme_contrast_pass",
    );

    fireEvent.change(screen.getByLabelText("storefront_shell_theme_text"), {
      target: { value: "#808080" },
    });
    fireEvent.change(
      screen.getByLabelText("storefront_shell_theme_background"),
      { target: { value: "#808080" } },
    );

    const failing = state();
    const expectedCodes = themePublicationIssues(failing).map(
      (issue) => issue.code,
    );
    expect(expectedCodes.length).toBeGreaterThan(0);
    for (const code of expectedCodes) {
      expect(screen.getByTestId("theme-issues")).toHaveTextContent(code);
    }
  });

  it("never rewrites the chosen source colors", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("storefront_shell_theme_text"), {
      target: { value: "#808080" },
    });
    fireEvent.change(
      screen.getByLabelText("storefront_shell_theme_background"),
      { target: { value: "#808080" } },
    );

    expect(state().text).toBe("#808080");
    expect(state().background).toBe("#808080");
  });

  it("serializes to the same source the server derives from", () => {
    render(<Harness />);
    const source: DocumentThemeSource = state();

    expect(deriveStorefrontTheme(source)).toEqual(
      deriveStorefrontTheme(currentTheme()),
    );
  });
});
