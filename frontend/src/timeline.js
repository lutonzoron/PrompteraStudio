function searchable(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchesCategory(project, category) {
  if (!category || category === "all") return true;
  const value = project?.category === "footage" ? "footage" : "general";
  return value === category;
}

function matchesReviewed(project, reviewed) {
  if (!reviewed || reviewed === "all") return true;
  const isReviewed = !!project?.reviewed;
  if (reviewed === "reviewed") return isReviewed;
  if (reviewed === "unreviewed") return !isReviewed;
  return true;
}

export function generatedTimeline(projects, query = "", filters = {}) {
  const needle = searchable(query.trim());
  const category = filters.category || "all";
  const reviewed = filters.reviewed || "all";
  return (projects || [])
    .filter((project) => project?.id && project.has_master)
    .filter((project) => matchesCategory(project, category))
    .filter((project) => matchesReviewed(project, reviewed))
    .filter((project) => !needle || searchable(`${project.title || ""} ${project.slug || ""}`).includes(needle))
    .slice()
    .sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0) || String(a.id).localeCompare(String(b.id)));
}

export function creationDay(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  if (!timestamp || !Number.isFinite(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function groupTimelineDays(projects) {
  const groups = [];
  for (const project of projects) {
    const key = creationDay(project.created_at);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, timestamp: project.created_at, projects: [] };
      groups.push(group);
    }
    group.projects.push(project);
  }
  return groups;
}
