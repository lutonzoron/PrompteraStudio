export function formatElapsed(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  const total = Math.max(0, Math.round(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min ${total % 60} s`;
}

export function statusLabel(s, t) {
  if (typeof t === "function") {
    const key = `status.${s}`;
    const v = t(key);
    return v === key ? s : v;
  }
  const map = {
    draft: "Draft",
    queued: "Queued",
    generating: "Generating",
    awaiting_review: "Review",
    paused: "Paused",
    done: "Ready",
    failed: "Failed",
    archived: "Archived",
  };
  return map[s] || s;
}

/** Strip leftover status notes stuck in imported titles. */
export function cleanTitle(title) {
  return String(title || "")
    .replace(/\s*\((gerando agora|na fila[^)]*|pausad[oa][^)]*|generating now|queued[^)]*|paused[^)]*)\)\s*$/i, "")
    .trim();
}

export function fmtDate(ts, dateLocale = "en-US") {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toLocaleString(dateLocale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function initials(title) {
  const parts = String(title || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 320);
  } catch {}
}

export function notify(title, body) {
  try {
    if (Notification.permission === "granted") new Notification(title, { body });
  } catch {}
}

export function isNsfw(p) {
  if (!p) return false;
  if ((p.model_pack || "").toLowerCase() === "nsfw") return true;
  const tags = p.tags || p.tag_list || [];
  if (Array.isArray(tags) && tags.some((t) => String(t).toLowerCase() === "nsfw")) {
    return true;
  }
  const blob = `${p.slug || ""} ${p.title || ""}`.toLowerCase();
  if (/\bnsfw\b|_nsfw|nsfw_/.test(blob)) return true;
  return false;
}

export function posterSrc(p) {
  if (!p?.id || isNsfw(p)) return null;
  // Prefer the URL the list already verified. A missing JPEG must not become an
  // <img> request: the 404 leaves the dark frame looking like a broken preview.
  if (p.poster_url) return p.poster_url;
  if (p.has_poster === true && p.poster_version) {
    return `/api/projects/${p.id}/poster?v=${encodeURIComponent(p.poster_version)}`;
  }
  // Finished master, cover not built yet — one warm request. Queue rows omit
  // the flag and must not invent a URL from updated_at.
  if (p.has_poster === false && p.has_master) {
    const v = p.updated_at || 0;
    return `/api/projects/${p.id}/poster?v=${encodeURIComponent(v)}`;
  }
  return null;
}

export function isProjectComplete(project) {
  if (project?.status === "done") return true;
  const takes = project?.takes || [];
  const completed = new Set((project?.runner_state?.completed || project?.progress?.completed_ns || []).map(Number));
  return takes.length > 0 && takes.every((take) => completed.has(Number(take.n))) &&
    !!(project.has_master || project.master_url);
}

/** Group Continuity takes into scenes: NEW (or session change) starts a block. */
export function groupTakesBySession(takes = []) {
  const groups = [];
  for (const tk of takes) {
    const session = String(tk?.session || "default");
    const kind = String(tk?.kind || "").toUpperCase();
    const last = groups[groups.length - 1];
    const startNew = !last || kind === "NEW" || last.session !== session;
    if (startNew) groups.push({ session, items: [tk] });
    else last.items.push(tk);
  }
  return groups;
}

/**
 * Pull the readable beat from a Continuity prompt so the shot list
 * does not dump the repeated CONTINUITY LOCK on every row.
 */
export function summarizeTakePrompt(prompt) {
  const raw = String(prompt || "");
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat) return { action: "", dialogue: "", mute: false, preview: "" };

  let action = "";
  const actionRe = /ONE action(?:\s+only)?\s*:\s*([^<\n]+)/gi;
  let match;
  while ((match = actionRe.exec(raw)) !== null) {
    const candidate = match[1].replace(/\s+/g, " ").trim();
    if (!candidate || /^same (?:lock|puppets|camera)/i.test(candidate)) continue;
    action = candidate;
  }
  action = action
    .replace(/\s*(?:Sound only:|Then clear lip sync|Soft diegetic|No music|No other speech|No speech).*$/i, "")
    .replace(/\.\s*$/, "")
    .trim();

  const dialogueMatch = raw.match(/<d>\s*\[Portuguese\]\s*([\s\S]*?)<\/d>/i);
  const dialogue = dialogueMatch ? dialogueMatch[1].replace(/\s+/g, " ").trim() : "";

  const mute =
    !dialogue &&
    /AUDIO LOCK:\s*MUTE|MUTE of dialogue|MUTE\b.*\bNo (?:words|dialogue|speech)|All mouths sealed/i.test(raw);

  let preview = action;
  if (dialogue) preview = preview ? `${preview} · “${dialogue}”` : `“${dialogue}”`;
  if (!preview) preview = flat.slice(0, 140);

  return { action, dialogue, mute, preview };
}
