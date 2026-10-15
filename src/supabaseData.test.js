import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDashboardBrands } from "./supabaseData";

afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.__VELZ_RUNTIME_CONFIG__;
});

describe("contact name from the lead overview read model", () => {
  it("shows the view name without requesting protected brand_contacts", async () => {
    globalThis.__VELZ_RUNTIME_CONFIG__ = {
      VITE_SUPABASE_URL: "https://db.example.com",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    };
    const endpoints = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const table = new URL(url).pathname.split("/").pop();
      endpoints.push(table);
      if (table === "brand_contacts") {
        return { ok: false, status: 403, text: async () => "permission denied" };
      }
      const rows = table === "brands"
        ? [{ id: "brand-1", name: "Example", domain: "example.com" }]
        : table === "v_lead_overview"
          ? [{ lead_id: "lead-1", brand_id: "brand-1", primary_email: "alicia@example.com", contact_name: "Alicia García" }]
          : [];
      return { ok: true, json: async () => rows };
    }));
    const brands = await loadDashboardBrands();
    expect(brands[0].outreach?.lead.contactName).toBe("Alicia García");
    expect(brands[0].outreach?.lead.primary_email).toBe("alicia@example.com");
    expect(endpoints).not.toContain("brand_contacts");
  });
});
