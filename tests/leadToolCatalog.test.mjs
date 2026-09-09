import assert from "node:assert/strict";
import {
  assignmentDisplay,
  groupToolsBySegment,
  isToolSelectionDirty,
  toolOptionLabel,
} from "../src/leadToolCatalog.js";

const tools = [
  { tool_key: "stockout_size_curve", display_name: "Stockout & Size Curve Score", segment: "hold_inventory" },
  { tool_key: "existing_outreach", display_name: "Existing Outreach", segment: "launch_now_no_inventory" },
  { tool_key: "manual_draft", display_name: "Manual draft" },
];

assert.equal(toolOptionLabel(tools[0]), "Stockout & Size Curve Score · stockout_size_curve");
assert.deepEqual(Object.keys(groupToolsBySegment(tools)).sort(), ["hold_inventory", "launch_now_no_inventory", "other"]);

const catalogByKey = new Map(tools.map((tool) => [tool.tool_key, tool]));
assert.deepEqual(
  assignmentDisplay({
    assigned_tool_key: "",
    resolved_tool_key: "stockout_size_curve",
    assignment_source: "alias",
    suggested_tool: "#1 Stockout & Broken Size-Curve Score.",
  }, catalogByKey),
  {
    selectedToolKey: "",
    resolvedToolKey: "stockout_size_curve",
    resolvedToolName: "Stockout & Size Curve Score",
    assignmentSource: "alias",
    suggestedTool: "#1 Stockout & Broken Size-Curve Score.",
  },
);

assert.equal(isToolSelectionDirty("stockout_size_curve", "stockout_size_curve"), false);
assert.equal(isToolSelectionDirty("", "existing_outreach"), true);
assert.equal(isToolSelectionDirty(null, ""), false);
