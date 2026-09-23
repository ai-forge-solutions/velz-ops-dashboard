import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockLoadDashboardBrands = vi.fn();
const mockLoadBrandGroups = vi.fn();
const mockSaveBrandGroup = vi.fn();
const mockDeleteBrandGroup = vi.fn();
const mockRunConductorService = vi.fn();
const mockGetMetaAdLibraryRun = vi.fn();
const mockGenerateOutreachSequence = vi.fn();
const mockPreviewProcess = vi.fn();

vi.mock("./supabaseData", () => ({
  loadDashboardBrands: mockLoadDashboardBrands,
  loadBrandGroups: mockLoadBrandGroups,
  saveBrandGroup: mockSaveBrandGroup,
  deleteBrandGroup: mockDeleteBrandGroup,
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
    previewProcess: mockPreviewProcess,
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

const secondBrand = {
  id: "9ac8c4fb-305d-4e8f-82ec-097559dc7f58",
  name: "Velz Test Store",
  domain: "velz-test.example",
  revenue: 8000,
  fit: 78,
  runs: {},
  outreach: null,
};

const qaGroup = {
  id: "group-qa",
  name: "Grupo QA",
  description: "",
  brandCount: 1,
  brandIds: [brand.id],
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
  initial_email: "Hola, vi oportunidades claras para mejorar vuestro flujo de venta.",
  followups: [
    { subject: "¿Lo revisamos?", body: "Te dejo una idea concreta para priorizar esta semana." },
  ],
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
  vi.restoreAllMocks();
  delete globalThis.__VELZ_RUNTIME_CONFIG__;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadDashboardBrands.mockResolvedValue([{ ...brand, runs: {} }]);
  mockLoadBrandGroups.mockResolvedValue([]);
  mockSaveBrandGroup.mockResolvedValue({ id: "group-1", name: "Grupo QA", description: "", brandCount: 1, brandIds: [brand.id] });
  mockDeleteBrandGroup.mockResolvedValue(undefined);
  mockPreviewProcess.mockResolvedValue({ brand_count: 1, total_items_estimated: 5 });
  mockRunConductorService.mockResolvedValue({
    success: true,
    status: "success",
    message: "ok",
    service_run_id: "service-run-1",
  });
  mockGetMetaAdLibraryRun.mockResolvedValue({});
  mockGenerateOutreachSequence.mockResolvedValue({ message: "Drafting completado.", sequence: generatedSequence });
});

describe("Brand group MVP", () => {
  it("exports selected lead sequences as markdown and can clear the current selection", async () => {
    const user = userEvent.setup();
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn();
    if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:velz-export");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mockLoadDashboardBrands.mockResolvedValue([
      { ...brand, runs: {}, outreach: { ...readyToGenerateOutreach, sequence: generatedSequence } },
      { ...secondBrand, runs: {}, outreach: null },
    ]);

    await renderLoadedApp();
    const table = screen.getByRole("table");
    await user.click(within(table).getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: /Exportar \.md/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const exported = await createObjectURL.mock.calls[0][0].text();
    expect(exported).toContain("# Secuencias Velz");
    expect(exported).toContain("## OcCre");
    expect(exported).toContain("**Subject:** Precio y antigüedad");
    expect(exported).toContain("Hola, vi oportunidades claras");
    expect(exported).toContain("### Followup 1: ¿Lo revisamos?");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 seleccionadas/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Deseleccionar todo/i }));
    expect(within(table).getAllByRole("checkbox").filter((checkbox) => checkbox.checked)).toHaveLength(0);
    expect(screen.queryByText(/seleccionadas/)).toBeNull();
  });

  it("creates a persisted group from the current selection and selects it without a manual reload", async () => {
    const user = userEvent.setup();
    const savedGroup = { ...qaGroup, brandCount: 2, brandIds: [brand.id, secondBrand.id] };
    mockLoadDashboardBrands.mockResolvedValue([{ ...brand, runs: {} }, { ...secondBrand, runs: {} }]);
    mockSaveBrandGroup.mockResolvedValue(savedGroup);

    await renderLoadedApp();
    const table = screen.getByRole("table");
    const rowCheckboxes = within(table).getAllByRole("checkbox");
    await user.click(rowCheckboxes[0]);
    await user.click(rowCheckboxes[1]);
    await user.type(screen.getByRole("textbox", { name: /Nombre del grupo/i }), "Grupo QA");
    await user.click(screen.getByRole("button", { name: /Crear grupo/i }));

    await waitFor(() => expect(mockSaveBrandGroup).toHaveBeenCalledWith({
      name: "Grupo QA",
      brandIds: [brand.id, secondBrand.id],
    }));
    expect(screen.getByText(/Grupo “Grupo QA” creado con 2 marcas/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Grupo:/i }).value).toBe("group-qa");
  });

  it("filters runs by group and selects exactly the visible brands", async () => {
    const user = userEvent.setup();
    mockLoadDashboardBrands.mockResolvedValue([{ ...brand, runs: {} }, { ...secondBrand, runs: {} }]);
    mockLoadBrandGroups.mockResolvedValue([qaGroup]);

    await renderLoadedApp();
    await user.selectOptions(screen.getByRole("combobox", { name: /Grupo:/i }), "group-qa");

    expect(screen.getAllByText("OcCre").length).toBeGreaterThan(0);
    expect(screen.queryByText("Velz Test Store")).toBeNull();
    expect(screen.queryByRole("button", { name: /Actualizar grupo/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Seleccionar visibles/i }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("checkbox").filter((checkbox) => checkbox.checked)).toHaveLength(1);
  });

  it("sends group brand_ids to the real process preview payload", async () => {
    const user = userEvent.setup();
    mockLoadDashboardBrands.mockResolvedValue([{ ...brand, runs: {} }, { ...secondBrand, runs: {} }]);
    mockLoadBrandGroups.mockResolvedValue([qaGroup]);

    await renderLoadedApp();
    await user.click(screen.getByRole("button", { name: "Procesos" }));
    await user.click(screen.getByRole("radio", { name: /Grupo/i }));
    await user.click(screen.getByRole("button", { name: /Preview real/i }));

    await waitFor(() => expect(mockPreviewProcess).toHaveBeenCalled());
    expect(mockPreviewProcess.mock.calls[0][0].brand_ids).toEqual([brand.id]);
    expect(screen.getByText("Preview real generado por el backend de procesos.")).toBeTruthy();
  });
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
