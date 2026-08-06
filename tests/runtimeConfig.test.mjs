import assert from "node:assert/strict";

globalThis.__VELZ_RUNTIME_CONFIG__ = {
  VITE_OUTREACH_API_BASE_URL: "https://runtime-outreach.example.com/",
  VITE_OUTREACH_EDIT_SEQUENCE_DRAFT_PATH: "/runtime/sequences/{sequence_id}/draft",
};

const conductorApi = await import("../src/conductorApi.js?runtime-config-test");

assert.equal(conductorApi.outreachActionConfigured("editDraft"), true);
assert.equal(
  conductorApi.buildOutreachActionUrl("https://runtime-outreach.example.com/", "editDraft", { sequenceId: "seq runtime" }),
  "https://runtime-outreach.example.com/runtime/sequences/seq%20runtime/draft",
);

assert.throws(
  () => conductorApi.buildOutreachActionUrl("https://runtime-outreach.example.com/", "editDraft"),
  /sequence_id/,
);

delete globalThis.__VELZ_RUNTIME_CONFIG__;
