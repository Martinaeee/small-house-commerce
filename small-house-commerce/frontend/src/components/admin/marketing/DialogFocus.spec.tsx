import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dialog } from "@/components/admin/Dialog";
const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")!;
beforeEach(() => Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get: () => document.body }));
afterEach(() => Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParent));
describe("dialog initial focus", () => {
  it("retains the existing default focus on the final action", () => {
    render(<Dialog open title="Existing dialog" onClose={() => {}}><input aria-label="Name" /><button type="button">Cancel</button><button type="button">Save</button></Dialog>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });
  it("allows a long marketing dialog to start at its header instead of scrolling to the bottom", () => {
    render(<Dialog open initialFocus="first" title="Long dialog" onClose={() => {}}><input aria-label="Name" /><button type="button">Cancel</button><button type="button" disabled>Save</button></Dialog>);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });
});
