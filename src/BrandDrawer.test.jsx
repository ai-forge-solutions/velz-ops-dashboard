import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockLoadBrandSource = vi.fn();
const mockSetLeadMagnetToolKey = vi.fn();
const mockGenerateOutreachSequence = vi.fn();
const mockCreateManualOutreachSequenceDraft = vi.fn();
const mockEditOutreachSequenceDraft = vi.fn();
const mockSetLeadArchived = vi.fn();
const mockSetOutreachSequenceStatus = vi.fn();

vi.mock("./supabaseData", () => ({
  loadBrandSource: mockLoadBrandSource,
  loadLeadMagnetTools: vi.fn().mockResolvedValue([]),
  setLeadMagnetToolKey: mockSetLeadMagnetToolKey,
}));

vi.mock("./conductorApi", () => ({
  approveOutreachSequence: vi.fn(),
  createManualOutreachSequenceDraft: mockCreateManualOutreachSequenceDraft,
  editOutreachSequenceDraft: mockEditOutreachSequenceDraft,
  generateOutreachSequence: mockGenerateOutreachSequence,
  launchSaleshandyQaBulk: vi.fn(),
  outreachRuntimeDiagnostics: vi.fn(() => ({
    configured: true,
    baseUrl: "https://outreach.example.com",
    editDraftConfigured: true,
  })),
  probeOutreachRuntime: vi.fn().mockResolvedValue({ diagnostics: { configured: true, editDraftConfigured: true } }),
  rejectOutreachSequence: vi.fn(),
  saleshandyQaLaunchConfigured: vi.fn(() => true),
  setLeadArchived: mockSetLeadArchived,
  setOutreachSequenceStatus: mockSetOutreachSequenceStatus,
}));

const baseOutreach = {
  leadId: "lead-1",
  lead: { ready_to_generate: true, contactName: "Ada Lead", accountEmail: "buyer@example.com" },
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
  actionConfigured: { generate: true, approve: true, reject: true, archiveLead: true, setSequenceStatus: true, launch: true },
  journey: [
    { key: "readiness", label: "Readiness", status: "done" },
    { key: "sequence", label: "Sequence", status: "current" },
    { key: "review", label: "Review", status: "pending" },
    { key: "saleshandy", label: "Instantly", status: "pending" },
    { key: "engagement", label: "Engagement", status: "pending" },
  ],
  nextAction: { key: "generate", label: "Generate sequence" },
};

const brands = [
  { id: "brand-1", name: "Alpha", domain: "alpha.example", websiteUrl: "alpha.example", runs: {}, outreach: baseOutreach },
  { id: "brand-2", name: "Beta", domain: "beta.example", runs: {}, outreach: null },
  { id: "brand-3", name: "Gamma", domain: "gamma.example", runs: {}, outreach: null },
];

async function renderDrawer(props = {}) {
  const BrandDrawer = (await import("./BrandDrawer.jsx")).default;
  return render(
    <BrandDrawer
      brand={brands[0]}
      brandUniverse={brands}
      onNavigateBrand={vi.fn()}
      onClose={vi.fn()}
      onRefresh={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadBrandSource.mockResolvedValue([]);
  mockSetLeadMagnetToolKey.mockResolvedValue({});
  mockCreateManualOutreachSequenceDraft.mockResolvedValue({ message: "manual draft", sequence: { id: "seq-manual-1", lead_id: "lead-1", send_status: "not_scheduled" } });
  mockGenerateOutreachSequence.mockResolvedValue({ message: "generated", sequence: { id: "seq-1", lead_id: "lead-1" } });
  mockSetLeadArchived.mockResolvedValue({ ok: true });
  mockSetOutreachSequenceStatus.mockResolvedValue({ ok: true });
});

function sequenceBrand(id, subject) {
  return { ...brands[0], id, name: id, outreach: { ...baseOutreach, leadId: `lead-${id}`, sequence: { id: `seq-${id}`, subject, initial_email: `${subject} body`, send_status: "not_scheduled", followups: [] } } };
}

async function switchBrand(rerender, brand, onRefresh = vi.fn()) {
  const BrandDrawer = (await import("./BrandDrawer.jsx")).default;
  rerender(<BrandDrawer brand={brand} brandUniverse={brands} onClose={vi.fn()} onRefresh={onRefresh} />);
}

describe("BrandDrawer sequence isolation", () => {
  it("does not apply a pending save from A after navigating to B", async () => {
    const user = userEvent.setup();
    let resolveSave;
    const onRefresh = vi.fn();
    mockEditOutreachSequenceDraft.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { rerender } = await renderDrawer({ brand: sequenceBrand("A", "Original A"), onRefresh });
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    await switchBrand(rerender, sequenceBrand("B", "Original B"), onRefresh);
    await act(async () => resolveSave({ sequence: { id: "seq-A", subject: "Late A", initial_email: "Late body" } }));
    expect(screen.getByLabelText("Subject").value).toBe("Original B");
    expect(screen.getByLabelText("Subject").disabled).toBe(false);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it("discards unsaved A text when navigating to B", async () => {
    const user = userEvent.setup();
    const { rerender } = await renderDrawer({ brand: sequenceBrand("A", "Original A") });
    await user.type(screen.getByLabelText("Subject"), " unsaved");
    await switchBrand(rerender, sequenceBrand("B", "Original B"));
    expect(screen.getByLabelText("Subject").value).toBe("Original B");
    expect(mockEditOutreachSequenceDraft).not.toHaveBeenCalled();
  });
  it("does not leak a saved sequence from A into B", async () => {
    const user = userEvent.setup();
    mockEditOutreachSequenceDraft.mockResolvedValue({ sequence: { id: "seq-A", subject: "Saved A", initial_email: "Saved body", send_status: "not_scheduled" } });
    const { rerender } = await renderDrawer({ brand: sequenceBrand("A", "Original A") });
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    expect(screen.getByLabelText("Subject").value).toBe("Saved A");
    await switchBrand(rerender, sequenceBrand("B", "Original B"));
    expect(screen.getByLabelText("Subject").value).toBe("Original B");
  });
});

describe("BrandDrawer inline sequence", () => {
  it("does not create a backend draft when required copy is blank", async () => {
    const user = userEvent.setup();
    await renderDrawer();
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    expect(mockCreateManualOutreachSequenceDraft).not.toHaveBeenCalled();
    expect(mockEditOutreachSequenceDraft).not.toHaveBeenCalled();
    expect(screen.getByText(/Completa el asunto y el cuerpo/)).toBeTruthy();
  });
  it("keeps launched sequences read-only", async () => {
    const brand = sequenceBrand("A", "Sent A");
    brand.outreach.sequence.send_status = "sent";
    await renderDrawer({ brand });
    expect(screen.queryByLabelText("Subject")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Guardar$/ })).toBeNull();
  });
  it("does not allow editing an archived lead", async () => {
    const brand = sequenceBrand("A", "Archived A");
    brand.outreach.archived = true;
    await renderDrawer({ brand });
    expect(screen.queryByLabelText("Subject")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Guardar$/ })).toBeNull();
  });
  it("syncs same-brand refresh while pristine but preserves unsaved text", async () => {
    const user = userEvent.setup();
    const { rerender } = await renderDrawer({ brand: sequenceBrand("A", "Original A") });
    await switchBrand(rerender, sequenceBrand("A", "Refreshed A"));
    expect(screen.getByLabelText("Subject").value).toBe("Refreshed A");
    await user.type(screen.getByLabelText("Subject"), " unsaved");
    const incoming = sequenceBrand("A", "Server A");
    incoming.outreach.sequence.id = "seq-A-new";
    await switchBrand(rerender, incoming);
    expect(screen.getByLabelText("Subject").value).toBe("Refreshed A unsaved");
    await user.click(screen.getByRole("button", { name: /Descartar cambios/ }));
    expect(screen.getByLabelText("Subject").value).toBe("Server A");
  });
  it("enables editing after persistence without waiting for refresh and reports refresh failures separately", async () => {
    const user = userEvent.setup();
    let rejectRefresh;
    const onRefresh = vi.fn(() => new Promise((resolve, reject) => { rejectRefresh = reject; }));
    mockEditOutreachSequenceDraft.mockImplementation(async (id, payload) => ({ sequence: { id, ...payload, send_status: "not_scheduled" } }));
    await renderDrawer({ brand: sequenceBrand("A", "Original A"), onRefresh });
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    expect(screen.getByLabelText("Subject").disabled).toBe(false);
    expect(screen.getByRole("button", { name: /^Guardar$/ })).toBeTruthy();
    await act(async () => rejectRefresh(new Error("refresh offline")));
    expect(screen.getByText(/Guardado.*actualizar.*refresh offline/)).toBeTruthy();
    expect(screen.queryByText(/Save failed/)).toBeNull();
    expect(screen.getByLabelText("Subject").value).toBe("Original A");
  });
  it("retries a failed edit using the already-created manual sequence id", async () => {
    const user = userEvent.setup();
    mockEditOutreachSequenceDraft.mockRejectedValueOnce(new Error("edit unavailable")).mockImplementation(async (id, payload) => ({ sequence: { id, ...payload, send_status: "not_scheduled" } }));
    await renderDrawer();
    await user.type(screen.getByLabelText("Subject"), "Retry subject");
    await user.type(screen.getByLabelText("Initial email body"), "Retry body");
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    await screen.findByText(/Save failed: edit unavailable/);
    expect(screen.getByLabelText("Subject").value).toBe("Retry subject");
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    expect(mockCreateManualOutreachSequenceDraft).toHaveBeenCalledTimes(1);
    expect(mockEditOutreachSequenceDraft).toHaveBeenNthCalledWith(2, "seq-manual-1", expect.objectContaining({ subject: "Retry subject" }));
    await user.type(screen.getByLabelText("Subject"), " updated");
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    expect(mockCreateManualOutreachSequenceDraft).toHaveBeenCalledTimes(1);
    expect(mockEditOutreachSequenceDraft).toHaveBeenLastCalledWith("seq-manual-1", expect.objectContaining({ subject: "Retry subject updated" }));
  });
  it("edits existing copy directly and calls the API only on Save", async () => {
    const user = userEvent.setup();
    mockEditOutreachSequenceDraft.mockImplementation(async (id, payload) => ({ sequence: { id, ...payload, send_status: "not_scheduled" } }));
    await renderDrawer({ brand: sequenceBrand("A", "Original A") });
    expect(screen.queryByRole("button", { name: /Edit draft|Crear draft manual/i })).toBeNull();
    await user.clear(screen.getByLabelText("Subject"));
    await user.type(screen.getByLabelText("Subject"), "Edited A");
    expect(mockEditOutreachSequenceDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    expect(mockEditOutreachSequenceDraft).toHaveBeenCalledWith("seq-A", expect.objectContaining({ subject: "Edited A", initial_email: "Original A body" }));
    expect(screen.getByLabelText("Subject").value).toBe("Edited A");
  });
});

describe("BrandDrawer dashboard optimizations", () => {
  it("renders as a large centered dialog and keeps fullscreen available", async () => {
    const user = userEvent.setup();
    await renderDrawer();

    const dialogPanel = screen.getByRole("dialog").firstElementChild;
    expect(dialogPanel.className).toContain("rounded-2xl");
    expect(dialogPanel.className).toContain("max-h-[92vh]");

    await user.click(screen.getByRole("button", { name: /Pantalla completa/i }));
    expect(screen.getByRole("dialog").firstElementChild.className).toContain("h-full");
    expect(screen.getByRole("button", { name: /Restaurar panel/i })).toBeTruthy();
  });

  it("does not show the source-backed evidence block in the sequence preview", async () => {
    await renderDrawer({
      brand: {
        ...brands[0],
        outreach: {
          ...baseOutreach,
          sequence: {
            id: "seq-1",
            lead_id: "lead-1",
            subject: "Demo subject",
            initial_email: "Demo body",
            followups: [],
            metadata: { evidence_summary: "hidden evidence" },
          },
        },
      },
    });

    expect(screen.getByLabelText("Subject").value).toBe("Demo subject");
    expect(screen.queryByText(/Source-backed evidence/i)).toBeNull();
    expect(screen.queryByText(/hidden evidence/i)).toBeNull();
  });

  it("navigates within the visible brand universe without closing the drawer", async () => {
    const user = userEvent.setup();
    const onNavigateBrand = vi.fn();

    await renderDrawer({ onNavigateBrand });

    await user.click(screen.getByRole("button", { name: /Siguiente/i }));
    expect(onNavigateBrand).toHaveBeenLastCalledWith(brands[1]);

    await user.click(screen.getByRole("button", { name: /Anterior/i }));
    expect(onNavigateBrand).toHaveBeenLastCalledWith(brands[2]);
  });

  it("preserves fullscreen mode when navigating to the next brand", async () => {
    const user = userEvent.setup();
    const BrandDrawer = (await import("./BrandDrawer.jsx")).default;
    const { rerender } = await renderDrawer();

    await user.click(screen.getByRole("button", { name: /Pantalla completa/i }));
    expect(screen.getByRole("button", { name: /Restaurar panel/i })).toBeTruthy();

    rerender(
      <BrandDrawer
        brand={brands[1]}
        brandUniverse={brands}
        onNavigateBrand={vi.fn()}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Restaurar panel/i })).toBeTruthy();
  });

  it("keeps generate blockers in the disabled button tooltip instead of a warning block", async () => {
    await renderDrawer({
      brand: {
        ...brands[0],
        outreach: {
          ...baseOutreach,
          generateEligible: false,
          generateBlockers: ["existing sequence"],
        },
      },
    });

    const generateButton = screen.getByRole("button", { name: /^Generate$/i });
    expect(generateButton.getAttribute("title")).toBe("Generate blocked by hard blockers: existing sequence");
    expect(screen.queryByText(/Generate blocked by hard blockers/i)).toBeNull();
  });

  it("places Generate inside Sequence draft / review and keeps the backend action", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    await renderDrawer({ onRefresh });

    expect(screen.queryByRole("heading", { name: /Generate sequence/i })).toBeNull();
    const reviewSection = screen.getByText("Sequence draft / review").closest("section");
    await user.click(within(reviewSection).getByRole("button", { name: /^Generate$/i }));

    expect(mockGenerateOutreachSequence).toHaveBeenCalledWith("lead-1");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("shows lead name/email and a clickable/copyable homepage in the drawer header", async () => {
    await renderDrawer();

    expect(screen.getByText("Lead contact")).toBeTruthy();
    expect(screen.getByText("Ada Lead")).toBeTruthy();
    expect(screen.getAllByText("buyer@example.com").length).toBeGreaterThan(0);

    const homepage = screen.getByRole("link", { name: /https:\/\/alpha\.example/i });
    expect(homepage.getAttribute("href")).toBe("https://alpha.example");
    expect(screen.getByRole("button", { name: /Copiar/i })).toBeTruthy();
  });

  it("does not render the Outreach config diagnostics block in the sequence review area", async () => {
    await renderDrawer({
      brand: {
        ...brands[0],
        outreach: {
          ...baseOutreach,
          sequence: {
            id: "seq-1",
            lead_id: "lead-1",
            subject: "Demo subject",
            initial_email: "Demo body",
            followups: [],
          },
        },
      },
    });

    expect(screen.queryByText(/Outreach config diagnostics/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Test Outreach API/i })).toBeNull();
  });

  it("types an empty sequence locally and creates it only on Save", async () => {
    const user = userEvent.setup();
    mockEditOutreachSequenceDraft.mockImplementation(async (id, payload) => ({ sequence: { id, ...payload, send_status: "not_scheduled" } }));
    await renderDrawer();
    expect(screen.queryByRole("button", { name: /Crear draft manual/i })).toBeNull();
    await user.type(screen.getByLabelText("Subject"), "Manual subject");
    await user.type(screen.getByLabelText("Initial email body"), "Manual body");
    expect(mockCreateManualOutreachSequenceDraft).not.toHaveBeenCalled();
    expect(mockEditOutreachSequenceDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Guardar$/ }));
    expect(mockCreateManualOutreachSequenceDraft).toHaveBeenCalledWith("lead-1");
    expect(mockEditOutreachSequenceDraft).toHaveBeenCalledWith("seq-manual-1", expect.objectContaining({ subject: "Manual subject", initial_email: "Manual body" }));
  });

  it("renders no_enviable as metadata instead of sendable copy and disables approve/export", async () => {
    await renderDrawer({
      brand: {
        ...brands[0],
        outreach: {
          ...baseOutreach,
          sequence: {
            id: "seq-no",
            lead_id: "lead-1",
            status: "no_enviable",
            review_status: "not_ready",
            subject: "NO_ENVIABLE",
            initial_email: "NO_ENVIABLE: faltan fuentes",
          },
          readiness: { key: "no_enviable", label: "No enviable" },
          noEnviable: true,
          noEnviableReasons: ["faltan fuentes"],
          canApprove: false,
          launchEligible: false,
        },
      },
    });

    expect(screen.getAllByText(/No enviable/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/faltan fuentes/i)).toBeTruthy();
    expect(screen.queryByText("NO_ENVIABLE: faltan fuentes")).toBeNull();
    expect(screen.getByRole("button", { name: /Approve sequence/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Export to Instantly/i }).disabled).toBe(true);
  });

  it("archives an active lead through the Outreach API", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    await renderDrawer({ onRefresh });
    await user.click(screen.getByRole("button", { name: /Archive lead/i }));

    expect(mockSetLeadArchived).toHaveBeenCalledWith("lead-1", true, "Archived from Velz Ops Dashboard.");
    expect(onRefresh).toHaveBeenCalled();
  });
});
