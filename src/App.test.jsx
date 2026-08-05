import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockLoadDashboardBrands = vi.fn();
const mockRunConductorService = vi.fn();
const mockGetMetaAdLibraryRun = vi.fn();

vi.mock("./supabaseData", () => ({
  loadDashboardBrands: mockLoadDashboardBrands,
}));

vi.mock("./conductorApi", async () => {
  const actual = await vi.importActual("./conductorApi");
  return {
    ...actual,
    runConductorService: mockRunConductorService,
    runConductorPipeline: vi.fn(),
    getMetaAdLibraryRun: mockGetMetaAdLibraryRun,
    getProcessRun: vi.fn(),
    previewProcess: vi.fn(),
    runProcess: vi.fn(),
    executeProcess: vi.fn(),
  };
});

vi.mock("./BrandDrawer", () => ({
  default: () => null,
}));

const brand = {
  id: "315037d2-950e-4775-b302-20bd6df800eb",
  name: "OcCre",
  domain: "occre.com",
  revenue: 10000,
  fit: 82,
  runs: {},
  outreach: null,
};

async function renderLoadedApp() {
  const App = (await import("./App.jsx")).default;
  render(<App />);
  await waitFor(() => expect(screen.getAllByText("OcCre").length).toBeGreaterThan(0));
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadDashboardBrands.mockResolvedValue([{ ...brand, runs: {} }]);
  mockRunConductorService.mockResolvedValue({
    success: true,
    status: "success",
    message: "ok",
    service_run_id: "service-run-1",
  });
  mockGetMetaAdLibraryRun.mockResolvedValue({});
});

describe("RunsView service popovers", () => {
  it("desktop service popover action triggers exactly one conductor request and shows immediate feedback", async () => {
    const user = userEvent.setup();
    let resolveConductor;
    mockRunConductorService.mockReturnValue(new Promise((resolve) => { resolveConductor = resolve; }));
    await renderLoadedApp();

    const table = screen.getByRole("table");
    const desktopShopifyCell = within(table).getAllByRole("cell")[7];

    await user.click(within(desktopShopifyCell).getByRole("button"));
    await user.click(within(desktopShopifyCell).getByRole("button", { name: /Ejecutar ahora/i }));

    expect(mockRunConductorService).toHaveBeenCalledTimes(1);
    expect(mockRunConductorService).toHaveBeenCalledWith(brand.id, "shopify_signals");
    expect(screen.getByText("Lanzando Shopify Signals para OcCre…")).toBeTruthy();
    resolveConductor({ success: true, status: "success", message: "ok", service_run_id: "service-run-1" });
  });

  it("mobile service popover action still triggers exactly one conductor request", async () => {
    const user = userEvent.setup();
    await renderLoadedApp();

    const mobileCard = screen.getByRole("article");
    await user.click(within(mobileCard).getByRole("button", { name: /Shopify Signals/i }));
    await user.click(within(mobileCard).getByRole("button", { name: /Ejecutar ahora/i }));

    expect(mockRunConductorService).toHaveBeenCalledTimes(1);
    expect(mockRunConductorService).toHaveBeenCalledWith(brand.id, "shopify_signals");
    await waitFor(() => expect(screen.getByText(/shopify_signals: ok/)).toBeTruthy());
  });

  it("surfaces conductor failures instead of silently no-oping", async () => {
    const user = userEvent.setup();
    mockRunConductorService.mockRejectedValue(new Error("Conductor respondió HTTP 500"));
    await renderLoadedApp();

    const mobileCard = screen.getByRole("article");
    await user.click(within(mobileCard).getByRole("button", { name: /Shopify Signals/i }));
    await user.click(within(mobileCard).getByRole("button", { name: /Ejecutar ahora/i }));

    await waitFor(() => expect(screen.getByText("Conductor respondió HTTP 500")).toBeTruthy());
  });
});
