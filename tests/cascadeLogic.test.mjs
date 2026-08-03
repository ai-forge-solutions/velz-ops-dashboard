import assert from "node:assert/strict";
import {
  brandMatchesEtlFilter,
  cascadeEtlServiceKeys,
  resolveCascadeTargets,
} from "../src/cascadeLogic.js";

const services = [
  { key: "meta_ad_library_scraper", deployed: true },
  { key: "brand_reviews", deployed: true },
  { key: "drafting", deployed: false },
];

const brands = [
  {
    id: "brand-not-run",
    fit: 91,
    runs: {},
    outreach: { readyToGenerate: true, leadId: "lead-1" },
  },
  {
    id: "brand-error",
    fit: 88,
    runs: { meta_ad_library_scraper: { status: "error" } },
    outreach: { sequence: { id: "seq-1" }, launchEligible: true },
  },
  {
    id: "brand-success",
    fit: 60,
    runs: { meta_ad_library_scraper: { status: "success" }, brand_reviews: { status: "success" } },
    outreach: null,
  },
];

assert.deepEqual(
  cascadeEtlServiceKeys([
    { key: "meta_ad_library_scraper" },
    { type: "outreach", key: "generate_sequence" },
    { type: "etl", key: "brand_reviews" },
  ], services),
  ["meta_ad_library_scraper", "brand_reviews"],
);

assert.equal(brandMatchesEtlFilter(brands[0], ["meta_ad_library_scraper"], "not_run"), true);
assert.equal(brandMatchesEtlFilter(brands[1], ["meta_ad_library_scraper"], "not_run"), false);
assert.equal(brandMatchesEtlFilter(brands[1], ["meta_ad_library_scraper"], "ran_error"), true);
assert.equal(brandMatchesEtlFilter(brands[2], ["meta_ad_library_scraper"], "ran_error"), false);
assert.equal(brandMatchesEtlFilter(brands[2], ["meta_ad_library_scraper"], "all"), true);

assert.deepEqual(
  resolveCascadeTargets({
    brands,
    selectedIds: new Set(["brand-error", "brand-success"]),
    cascade: {
      scope: "selected",
      scopeBrandIds: ["brand-error", "brand-success"],
      fitMin: 80,
      etlStateFilter: "ran_error",
      steps: [{ key: "meta_ad_library_scraper" }, { type: "outreach", key: "send_sequence" }],
    },
    services,
  }).map((brand) => brand.id),
  ["brand-error"],
);

assert.deepEqual(
  resolveCascadeTargets({
    brands,
    selectedIds: new Set(),
    cascade: {
      scope: "fit_score",
      fitMin: 80,
      etlStateFilter: "not_run",
      steps: [{ key: "meta_ad_library_scraper" }],
    },
    services,
  }).map((brand) => brand.id),
  ["brand-not-run"],
);
