import assert from "node:assert/strict";
import {
  buildProcessPayload,
  defaultProcessSteps,
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
assert.equal(defaults.find((step) => step.id === "email_generation").mode, "overwrite");
assert.equal(defaults.find((step) => step.id === "email_send").enabled, false);

assert.deepEqual(
  buildProcessPayload({
    brandIds: ["brand-a", "brand-a", "brand-b"],
    fitScoreMin: 70,
    limit: 500,
    steps: [
      { id: "brand_context", mode: "preserve_success", enabled: true },
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
      { id: "meta_ads", mode: "overwrite" },
    ],
    execution: { strategy: "serial", max_concurrency: 5, continue_on_error: true },
  },
);
