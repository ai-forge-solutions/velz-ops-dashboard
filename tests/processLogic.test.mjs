import assert from "node:assert/strict";
import {
  buildProcessPayload,
  defaultProcessSteps,
  findProcessRunItem,
  isProcessRunTerminal,
  processRunBrands,
  processRunStatusSummary,
  processRunSteps,
  resolveProcessBrandIds,
} from "../src/processLogic.js";

const brands = [
  { id: "brand-a", fit: 91 },
  { id: "brand-b", fit_score: 75 },
  { id: "brand-c", fit: 42 },
];

assert.deepEqual(
  resolveProcessBrandIds({ brands, selectedIds: new Set(["brand-c", "brand-a"]), scope: "selected", limit: 10 }),
  ["brand-a", "brand-c"],
);

assert.deepEqual(
  resolveProcessBrandIds({ brands, selectedIds: new Set(), scope: "fit_score", fitScoreMin: 70, limit: 1 }),
  ["brand-a"],
);

const defaults = defaultProcessSteps();
assert.equal(defaults.find((step) => step.id === "brand_context").mode, "preserve_success");
assert.equal(defaults.find((step) => step.id === "shopify_signals").enabled, true);
assert.equal(defaults.find((step) => step.id === "shopify_signals").mode, "preserve_success");
assert.equal(defaults.find((step) => step.id === "email_generation").mode, "overwrite");
assert.equal(defaults.find((step) => step.id === "email_send").enabled, false);

assert.deepEqual(
  buildProcessPayload({
    brandIds: ["brand-a", "brand-a", "brand-b"],
    fitScoreMin: 70,
    limit: 500,
    steps: [
      { id: "brand_context", mode: "preserve_success", enabled: true },
      { id: "shopify_signals", mode: "overwrite", enabled: true },
      { id: "meta_ads", mode: "overwrite", enabled: true },
      { id: "email_send", mode: "overwrite", enabled: false },
    ],
    strategy: "serial",
    maxConcurrency: 5,
    continueOnError: true,
  }),
  {
    brand_ids: ["brand-a", "brand-b"],
    filters: { fit_score_min: 70, limit: 500 },
    steps: [
      { id: "brand_context", mode: "preserve_success" },
      { id: "shopify_signals", mode: "overwrite" },
      { id: "meta_ads", mode: "overwrite" },
    ],
    execution: { strategy: "serial", max_concurrency: 5, continue_on_error: true },
  },
);

const detail = {
  id: "run-1",
  status: "partial",
  items: [
    { brand_id: "brand-a", brand_name: "Brand A", step_id: "brand_context", mode: "preserve_success", status: "skipped_preserved", service_run_id: "svc-1" },
    { brand_id: "brand-a", brand_name: "Brand A", step_id: "meta_ads", mode: "overwrite", status: "error", error: "boom" },
    { brand_id: "brand-b", step_id: "brand_context", mode: "preserve_success", status: "queued" },
  ],
};

assert.deepEqual(processRunBrands(detail, [{ id: "brand-b", name: "Brand B", domain: "b.test" }]), [
  { id: "brand-a", name: "Brand A", domain: undefined },
  { id: "brand-b", name: "Brand B", domain: "b.test" },
]);
assert.deepEqual(processRunSteps(detail), ["brand_context", "meta_ads"]);
assert.equal(findProcessRunItem(detail, "brand-a", "meta_ads").error, "boom");
assert.deepEqual(processRunStatusSummary(detail.items), {
  queued: 1,
  running: 0,
  success: 0,
  error: 1,
  skipped_preserved: 1,
});
assert.equal(isProcessRunTerminal("partial"), true);
assert.equal(isProcessRunTerminal("running"), false);
