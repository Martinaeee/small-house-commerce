import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentSettingsPage from "./page";
import { AdminApiError } from "@/lib/admin-auth";
import type { AdminPaymentMethodsSettings } from "@/lib/admin-api";

/**
 * The payment settings page: four switches, a store that can never be left
 * without a way to pay, and an optimistic-lock save that reports a stale
 * revision instead of overwriting someone else's change.
 */

const apiMock = vi.hoisted(() => ({
  getPaymentMethodSettings: vi.fn(),
  updatePaymentMethodSettings: vi.fn(),
}));
vi.mock("@/lib/admin-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-api")>(
    "@/lib/admin-api",
  );
  return { ...actual, adminApi: { ...actual.adminApi, ...apiMock } };
});

vi.mock("@/lib/admin-i18n", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-i18n")>(
    "@/lib/admin-i18n",
  );
  // A stable t: the real hook returns a stable function, and an unstable
  // one would re-run every effect that depends on it.
  const t = (key: string) => key;
  return {
    ...actual,
    useAdminI18n: () => ({ t, lang: "en" }),
  };
});

function settings(
  overrides: Partial<AdminPaymentMethodsSettings> = {},
): AdminPaymentMethodsSettings {
  return {
    codEnabled: true,
    revision: 3,
    methods: [
      { id: "COD", enabled: true, ready: true, updatedAt: null, updatedBy: null },
      { id: "CARD", enabled: false, ready: false, updatedAt: null, updatedBy: null },
      { id: "GCASH", enabled: true, ready: true, updatedAt: null, updatedBy: null },
      { id: "BPI", enabled: false, ready: false, updatedAt: null, updatedBy: null },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getPaymentMethodSettings.mockResolvedValue(settings());
  apiMock.updatePaymentMethodSettings.mockImplementation(
    async (input: {
      methods: { id: string; enabled: boolean }[];
      revision: number;
    }) => {
      const next = settings({ revision: input.revision + 1 });
      return {
        ...next,
        methods: next.methods.map((method) => ({
          ...method,
          enabled:
            input.methods.find((change) => change.id === method.id)?.enabled ??
            method.enabled,
        })),
      };
    },
  );
});

describe("payment settings page", () => {
  it("renders the current switches and disables the methods that are not ready", async () => {
    render(<PaymentSettingsPage />);

    expect(await screen.findByTestId("payment-setting-cod")).toBeChecked();
    expect(screen.getByTestId("payment-setting-gcash")).toBeChecked();
    expect(screen.getByTestId("payment-setting-card")).toBeDisabled();
    expect(screen.getByTestId("payment-setting-bpi")).toBeDisabled();
    // The not-ready reason is shown beside the switch.
    expect(screen.getAllByText("payment_settings_not_ready")).toHaveLength(2);
  });

  it("refuses to save a store with no way to pay", async () => {
    render(<PaymentSettingsPage />);

    await userEvent.setup().click(await screen.findByTestId("payment-setting-cod"));
    await userEvent.setup().click(screen.getByTestId("payment-setting-gcash"));
    expect(await screen.findByTestId("payment-settings-keep-one")).toBeInTheDocument();
    expect(screen.getByTestId("payment-settings-save")).toBeDisabled();
    expect(apiMock.updatePaymentMethodSettings).not.toHaveBeenCalled();
  });

  it("saves the switches with the revision it read", async () => {
    render(<PaymentSettingsPage />);

    // Cash off, GCash stays on: a valid configuration.
    await userEvent.setup().click(await screen.findByTestId("payment-setting-cod"));
    await userEvent.setup().click(screen.getByTestId("payment-settings-save"));

    await waitFor(() =>
      expect(apiMock.updatePaymentMethodSettings).toHaveBeenCalledWith({
        revision: 3,
        methods: [
          { id: "COD", enabled: false },
          { id: "CARD", enabled: false },
          { id: "GCASH", enabled: true },
          { id: "BPI", enabled: false },
        ],
      }),
    );
    expect(await screen.findByTestId("payment-settings-saved")).toBeInTheDocument();
  });

  it("asks the operator to reload when the revision is stale", async () => {
    apiMock.updatePaymentMethodSettings.mockRejectedValue(
      new AdminApiError("REVISION_CONFLICT", 409),
    );
    render(<PaymentSettingsPage />);

    await userEvent.setup().click(await screen.findByTestId("payment-setting-gcash"));
    await userEvent.setup().click(screen.getByTestId("payment-settings-save"));

    expect(await screen.findByTestId("payment-settings-error")).toHaveTextContent(
      "payment_settings_conflict",
    );
  });
});
