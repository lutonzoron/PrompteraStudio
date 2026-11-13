export function statusLabel(s) {
  const map = {
    draft: "Rascunho",
    queued: "Na fila",
    generating: "Gerando",
    awaiting_review: "Revisão",
    paused: "Pausado",
    done: "Pronto",
    failed: "Falhou",
    archived: "Arquivada",
  };
  return map[s] || s;
}

/** Strip leftover status notes stuck in imported titles. */
export function cleanTitle(title) {
  return String(title || "")
    .replace(/\s*\((gerando agora|na fila[^)]*|pausad[oa][^)]*)\)\s*$/i, "")
    .trim();
}

export function fmtDate(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toLocaleString("pt-BR", {
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
  if (!p?.id) return null;
  // NSFW nunca usa capa/poster na UI
  if (isNsfw(p)) return null;
  return `/api/projects/${p.id}/poster`;
}
