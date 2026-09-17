import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockLoadDashboardBrands = vi.fn();
const mockRunConductorService = vi.fn();
const mockGetMetaAdLibraryRun = vi.fn();
const mockGenerateOutreachSequence = vi.fn();

vi.mock("./supabaseData", () => ({
  loadDashboardBrands: mockLoadDashboardBrands,
}));

vi.mock("./conductorApi", async () => {
  const actual = await vi.importActual("./conductorApi");
  return {
    ...actual,
    runConductorService: mockRunConductorService,
    generateOutreachSequence: mockGenerateOutreachSequence,
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

const readyToGenerateOutreach = {
  leadId: "lead-1",
  lead: { primary_email: "buyer@example.com", ready_to_generate: true },
  sequence: null,
  send: null,
  events: { counts: {}, latestEvent: null },
  magnetEvents: { counts: {}, latestEvent: null },
  email: "buyer@example.com",
  readiness: { key: "ready_to_generate", label: "Ready to generate" },
  lifecycle: { key: "not_launched", label: "Not launched" },
  provider: {},
  blockers: [],
  warnings: [],
  launchBlockers: [],
  readyToGenerate: true,
  generateEligible: true,
  generateBlockers: [],
  canApprove: false,
  canReject: false,
  launchEligible: false,
  actionConfigured: { generate: true, approve: true, reject: true, launch: true },
  journey: [
    { key: "readiness", status: "done" },
    { key: "sequence", status: "current" },
    { key: "review", status: "pending" },
    { key: "saleshandy", status: "pending" },
    { key: "engagement", status: "pending" },
  ],
  nextAction: { key: "generate", label: "Generate sequence" },
};

const generatedSequence = {
  id: "seq-1",
  lead_id: "lead-1",
  subject: "Precio y antigüedad",
  status: "draft",
  review_status: "pending_review",
  send_status: "not_scheduled",
  metadata: { recipient_email: "buyer@example.com", public_tool_url: "https://velz.test/tool/1" },
  created_at: "2026-09-17T12:00:00Z",
};

async function renderLoadedApp() {
  const App = (await import("./App.jsx")).default;
  render(<App />);
  await waitFor(() => expect(screen.getAllByText("OcCre").length).toBeGreaterThan(0));
}

afterEach(() => {
  cleanup();
  delete globalThis.__VELZ_RUNTIME_CONFIG__;
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
  mockGenerateOutreachSequence.mockResolvedValue({ message: "Drafting completado.", sequence: generatedSequence });
});

describe("Outreach generate availability", () => {
  it("keeps Drafting available for legacy not_ready when generate endpoint is configured and only warnings remain", async () => {
    globalThis.__VELZ_RUNTIME_CONFIG__ = { VITE_OUTREACH_API_BASE_URL: "https://outreach.example.com" };
    const { outreachServiceAvailability } = await import("./App.jsx");

    const availability = outreachServiceAvailability({
      ...brand,
      outreach: {
        leadId: "dfa83244-018b-4912-8a5e-ef53ad8da8e8",
        readyToGenerate: false,
        generateEligible: true,
        generateBlockers: [],
        blockers: [],
        warnings: ["legacy readiness not_ready"],
      },
    }, { type: "outreach", action: "generate" });

    expect(availability.available).toBe(true);
    expect(availability.message).toMatch(/Aviso readiness no bloqueante/);
  });

  it("blocks Drafting on hard generate blockers even when endpoint is configured", async () => {
    globalThis.__VELZ_RUNTIME_CONFIG__ = { VITE_OUTREACH_API_BASE_URL: "https://outreach.example.com" };
    const { outreachServiceAvailability } = await import("./App.jsx");

    const availability = outreachServiceAvailability({
      ...brand,
      outreach: {
        leadId: "dfa83244-018b-4912-8a5e-ef53ad8da8e8",
        readyToGenerate: false,
        generateEligible: false,
        generateBlockers: ["missing recipient email"],
        blockers: ["missing recipient email"],
        warnings: ["legacy readiness not_ready"],
      },
    }, { type: "outreach", action: "generate" });

    expect(availability.available).toBe(false);
    expect(availability.message).toMatch(/condición dura: missing recipient email/);
  });
});

describe("RunsView service popovers", () => {
  it("patches Outreach state immediately from a generated draft even when the Supabase refresh is still stale", async () => {
    globalThis.__VELZ_RUNTIME_CONFIG__ = { VITE_OUTREACH_API_BASE_URL: "https://outreach.example.com" };
    const user = userEvent.setup();
    const staleBrand = { ...brand, runs: {}, outreach: readyToGenerateOutreach };
    mockLoadDashboardBrands.mockResolvedValue([staleBrand]);

    await renderLoadedApp();

    const mobileCard = screen.getByRole("article");
    await user.click(within(mobileCard).getByRole("button", { name: /Drafting/i }));
    await user.click(within(mobileCard).getByRole("button", { name: /Ejecutar ahora/i }));

    expect(mockGenerateOutreachSequence).toHaveBeenCalledWith("lead-1");
    await waitFor(() => expect(screen.getAllByText("Draft pending review").length).toBeGreaterThan(0));
    expect(screen.getByText("Drafting completado.")).toBeTruthy();
  });

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
