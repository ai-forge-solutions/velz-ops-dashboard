import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/supabaseData.js", import.meta.url), "utf8");

const metaScrapeFieldsMatch = source.match(/const META_SCRAPE_FIELDS = \[([\s\S]*?)\]\.join\(","\);/);
assert.ok(metaScrapeFieldsMatch, "META_SCRAPE_FIELDS must be declared in supabaseData.js");

const metaScrapeFields = Array.from(metaScrapeFieldsMatch[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
assert.deepEqual(metaScrapeFields, [
  "brand_id",
  "service_run_id",
  "ad_count",
  "raw_payload",
  "scraped_at",
]);
assert.equal(metaScrapeFields.includes("created_at"), false, "meta_ad_scrapes select must not request created_at");

const buildMetaScrapeParamsMatch = source.match(/export function buildMetaScrapeParams[\s\S]*?return new URLSearchParams\(\{([\s\S]*?)\}\);\n\}/);
assert.ok(buildMetaScrapeParamsMatch, "meta_ad_scrapes query params must be built through buildMetaScrapeParams");

const buildMetaScrapeParamsBody = buildMetaScrapeParamsMatch[1];
assert.match(buildMetaScrapeParamsBody, /select:\s*META_SCRAPE_FIELDS/);
assert.match(buildMetaScrapeParamsBody, /order:\s*"scraped_at\.desc\.nullslast"/);
assert.doesNotMatch(buildMetaScrapeParamsBody, /created_at/, "meta_ad_scrapes query params must not order by created_at");
