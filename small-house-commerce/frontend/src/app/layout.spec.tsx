import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const localFontMock = vi.hoisted(() =>
  vi.fn((options: { variable?: string }) => ({
    className: "font-poppins",
    variable: options.variable ? "font-poppins-variable" : "",
  })),
);

vi.mock("next/font/local", () => ({ default: localFontMock }));

import { poppins } from "@/lib/fonts";
import RootLayout, { metadata } from "./layout";

function findElementById(node: ReactNode, id: string): boolean {
  if (!isValidElement(node)) return false;
  if ((node.props as { id?: string }).id === id) return true;
  return Children.toArray(
    (node.props as { children?: ReactNode }).children,
  ).some((child) => findElementById(child, id));
}

describe("RootLayout storefront brand integration", () => {
  it("remains synchronous and carries the self-hosted Poppins variable", () => {
    expect(RootLayout.constructor.name).not.toBe("AsyncFunction");
    expect(poppins.variable).toBe("font-poppins-variable");
    expect(localFontMock).toHaveBeenCalledWith(
      expect.objectContaining({ variable: "--font-poppins" }),
    );

    const tree = RootLayout({ children: <div>Admin or storefront route</div> });
    const body = Children.toArray(
      (tree.props as { children: ReactNode }).children,
    ).find(
      (child) => isValidElement(child) && child.type === "body",
    );
    expect(isValidElement(body) && (body.props as { className: string }).className).toContain(
      "font-poppins-variable",
    );
  });

  it("declares exactly the dynamic brand icon and no root storefront token style", () => {
    expect(metadata.icons).toEqual({ icon: "/brand-mark" });
    const tree = RootLayout({ children: <div>Admin route</div> });
    expect(findElementById(tree, "storefront-theme-tokens")).toBe(false);
  });
});
