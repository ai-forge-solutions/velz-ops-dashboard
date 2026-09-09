export function toolLabel(tool) {
  if (!tool) return "—";
  return tool.display_name || tool.resolved_tool_name || tool.tool_key || "—";
}

export function toolOptionLabel(tool) {
  if (!tool) return "—";
  const label = toolLabel(tool);
  return tool.tool_key && tool.tool_key !== label ? `${label} · ${tool.tool_key}` : label;
}

export function groupToolsBySegment(tools = []) {
  return tools.reduce((groups, tool) => {
    const key = tool.segment || "other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(tool);
    return groups;
  }, {});
}

export function assignmentDisplay(assignment, catalogByKey = new Map()) {
  const resolvedKey = assignment?.assigned_tool_key || assignment?.resolved_tool_key || null;
  const tool = resolvedKey ? catalogByKey.get(resolvedKey) : null;
  return {
    selectedToolKey: assignment?.assigned_tool_key || "",
    resolvedToolKey: resolvedKey,
    resolvedToolName: assignment?.resolved_tool_name || tool?.display_name || null,
    assignmentSource: assignment?.assignment_source || "unassigned",
    suggestedTool: assignment?.suggested_tool || "",
  };
}

export function isToolSelectionDirty(currentKey, nextKey) {
  return String(currentKey || "") !== String(nextKey || "");
}
