import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDashboardBrands, saveBrandGroup } from "./supabaseData";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contact name from the lead overview read model", () => {
  it("shows the view name without requesting protected brand_contacts", async () => {
    const endpoints = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const table = new URL(url, "http://localhost").pathname.split("/").pop();
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

describe("Supabase access through the same-origin proxy", () => {
  it("reads tables via /api/supabase/rest without any Supabase key", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => [] };
    }));
    await loadDashboardBrands();
    expect(calls.length).toBeGreaterThan(0);
    for (const { url, init } of calls) {
      expect(url).toMatch(/^\/api\/supabase\/rest\/[a-z_]+(\?|$)/);
      expect(init.credentials).toBe("same-origin");
      expect(init.headers).not.toHaveProperty("apikey");
      expect(init.headers).not.toHaveProperty("Authorization");
    }
    const brandsCall = calls.find(({ url }) => url.startsWith("/api/supabase/rest/brands?"));
    expect(new URLSearchParams(brandsCall.url.split("?")[1]).get("select")).toContain("fit_score");
  });

  it("posts RPCs via /api/supabase/rpc and keeps the error message format", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(url).toBe("/api/supabase/rpc/save_brand_group");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("same-origin");
      expect(init.headers).not.toHaveProperty("apikey");
      return { ok: false, status: 400, text: async () => JSON.stringify({ message: "bad group" }) };
    }));
    await expect(saveBrandGroup({ name: "G", brandIds: [] })).rejects.toThrow(
      "Supabase RPC save_brand_group respondió 400: bad group",
    );
  });
});
