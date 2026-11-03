import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrivacyPolicyPage from "./page";

vi.mock("@/components/consent/CookieSettingsButton", () => ({
  CookieSettingsButton: () => <button type="button">Cookie settings</button>,
}));

describe("privacy page", () => {
  it("explains that unfinished checkout input is saved for recovery", () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getByText(/as an unfinished checkout draft/i)).toBeInTheDocument();
    expect(
      screen.getByText(/drafts with no typed information are deleted within 24 hours/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/kept for at most 30 days/i),
    ).toBeInTheDocument();
  });

  it("states the retention periods that apply to those drafts", () => {
    render(<PrivacyPolicyPage />);
    expect(
      screen.getByText(/unfinished checkout drafts follow the periods above/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no more than 30 days/i)).toBeInTheDocument();
  });
});
