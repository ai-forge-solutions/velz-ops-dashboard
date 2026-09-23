import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockLoadBrandSource = vi.fn();
const mockSetLeadMagnetToolKey = vi.fn();
const mockGenerateOutreachSequence = vi.fn();

vi.mock("./supabaseData", () => ({
  loadBrandSource: mockLoadBrandSource,
  loadLeadMagnetTools: vi.fn().mockResolvedValue([]),
  setLeadMagnetToolKey: mockSetLeadMagnetToolKey,
}));

vi.mock("./conductorApi", () => ({
  approveOutreachSequence: vi.fn(),
  editOutreachSequenceDraft: vi.fn(),
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
}));

const baseOutreach = {
  leadId: "lead-1",
  lead: { ready_to_generate: true },
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
    { key: "readiness", label: "Readiness", status: "done" },
    { key: "sequence", label: "Sequence", status: "current" },
    { key: "review", label: "Review", status: "pending" },
    { key: "saleshandy", label: "Instantly", status: "pending" },
    { key: "engagement", label: "Engagement", status: "pending" },
  ],
  nextAction: { key: "generate", label: "Generate sequence" },
};

const brands = [
  { id: "brand-1", name: "Alpha", domain: "alpha.example", runs: {}, outreach: baseOutreach },
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
  mockGenerateOutreachSequence.mockResolvedValue({ message: "generated", sequence: { id: "seq-1", lead_id: "lead-1" } });
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

    expect(screen.getByText("Demo subject")).toBeTruthy();
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
});
