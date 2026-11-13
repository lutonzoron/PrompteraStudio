import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "ia", label: "API de IA" },
  { id: "comfy", label: "ComfyUI" },
  { id: "energy", label: "Energia" },
  { id: "system", label: "Sistema" },
];

const STEP_TAB = {
  llm: "ia",
  hardware: "system",
  comfyui: "comfy",
  dasiwa: "comfy",
  models_sfw: "system",
  ffmpeg: "system",
  cost: "energy",
  styles: "overview",
};

function StatusDot({ ok }) {
  return <i className={`dot ${ok ? "on" : "off"}`} />;
}

export default function Settings({ health, onClose, onDone, setToast, onOpenStyles }) {
  const steps = health?.onboarding?.steps || {};
  const hw = health?.onboarding?.hardware;
  const models = health?.onboarding?.models;
  const comfyOnline = !!health?.comfy?.online;

  const incomplete = useMemo(
    () => Object.entries(steps).filter(([, s]) => !s.done).map(([k]) => k),
    [steps]
  );

  const [tab, setTab] = useState(() => (incomplete[0] ? STEP_TAB[incomplete[0]] || "overview" : "overview"));
  const [llm, setLlm] = useState({
    provider: "openai",
    api_key: "",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  });
  const [machine, setMachine] = useState({ watts: "", tariff_brl_per_kwh: "0.96" });
  const [comfyRoot, setComfyRoot] = useState(health?.onboarding?.comfyui_root || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [deps, setDeps] = useState(null);
  const [depsMsg, setDepsMsg] = useState("");

  useEffect(() => {
    api.getLlm().then((c) =>
      setLlm((prev) => ({
        ...prev,
        provider: c.provider || "openai",
        base_url: c.base_url || prev.base_url,
        model: c.model || prev.model,
      }))
    );
    api.machine().then((m) =>
      setMachine({
        watts: m.watts ?? "",
        tariff_brl_per_kwh: m.tariff_brl_per_kwh ?? 0.96,
      })
    );
  }, []);

  useEffect(() => {
    setComfyRoot(health?.onboarding?.comfyui_root || "");
  }, [health?.onboarding?.comfyui_root]);

  useEffect(() => {
    if (tab !== "comfy") return;
    api
      .comfyDeps()
      .then(setDeps)
      .catch((e) => setDepsMsg(String(e.message || e)));
  }, [tab, health?.comfy?.online]);

  async function refreshDeps() {
    const r = await api.comfyDeps();
    setDeps(r);
    return r;
  }

  async function withBusy(fn) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay-center" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <div>
            <h2>Configuração</h2>
            <p className="muted">
              {health?.onboarding?.complete
                ? "Setup pronto para gerar"
                : `${incomplete.length} item(ns) pendente(s)`}
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Seções">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-nav-btn ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="settings-body">
            {tab === "overview" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <h3>Checklist do Studio</h3>
                  <p className="muted">
                    Toque em um item para ir direto à aba correspondente.
                  </p>
                </div>
                <div className="settings-checklist">
                  {Object.entries(steps).map(([k, s]) => (
                    <button
                      key={k}
                      type="button"
                      className={`settings-check ${s.done ? "ok" : "todo"}`}
                      onClick={() => {
                        if (k === "styles" && onOpenStyles) {
                          onOpenStyles();
                          return;
                        }
                        setTab(STEP_TAB[k] || "overview");
                      }}
                    >
                      <StatusDot ok={!!s.done} />
                      <span className="settings-check-label">{s.label}</span>
                      <span className="settings-check-state">
                        {s.done ? "OK" : "Configurar"}
                      </span>
                    </button>
                  ))}
                </div>
                {hw ? (
                  <div
                    className={`alert ${
                      hw.verdict === "ok" ? "good" : hw.verdict === "tight" ? "warn" : "bad"
                    }`}
                  >
                    {hw.message}
                    <div className="muted" style={{ marginTop: 4 }}>
                      GPU {hw.gpu_name || "—"} · {hw.vram_gb ?? "?"} GB VRAM
                    </div>
                  </div>
                ) : null}
                <div className="settings-quick row">
                  <button type="button" onClick={() => setTab("ia")}>
                    Configurar IA
                  </button>
                  <button type="button" onClick={() => setTab("comfy")}>
                    ComfyUI
                  </button>
                  {onOpenStyles ? (
                    <button type="button" onClick={onOpenStyles}>
                      Estilos
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {tab === "ia" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <h3>API de IA</h3>
                  <p className="muted">
                    Usada para gerar roteiros no app (OpenAI, LM Studio, Ollama…).
                  </p>
                </div>
                <div className="settings-grid-2">
                  <div className="field">
                    <label>Provedor</label>
                    <select
                      value={llm.provider}
                      onChange={(e) => setLlm({ ...llm, provider: e.target.value })}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="openai_compatible">OpenAI-compatible / LM Studio</option>
                      <option value="ollama">Ollama</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Modelo</label>
                    <input
                      value={llm.model || ""}
                      onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Base URL</label>
                  <input
                    value={llm.base_url || ""}
                    onChange={(e) => setLlm({ ...llm, base_url: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>API Key</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={llm.api_key}
                    onChange={(e) => setLlm({ ...llm, api_key: e.target.value })}
                  />
                </div>
                {msg ? (
                  <div className={`alert ${msg.startsWith("IA OK") ? "good" : "bad"}`}>{msg}</div>
                ) : null}
                <div className="settings-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        const r = await api.putLlm(llm);
                        setMsg(r.ok ? `IA OK: ${r.reply}` : `Falhou: ${r.error}`);
                        setToast(r.ok ? "IA conectada" : "Falha na IA");
                        onDone();
                      })
                    }
                  >
                    Salvar e testar IA
                  </button>
                </div>
              </section>
            ) : null}

            {tab === "comfy" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <h3>ComfyUI + Continuity</h3>
                      <p className="muted">Path, dependências, modelos e workflows H3.</p>
                    </div>
                    <span className={`status-pill ${comfyOnline ? "done" : "failed"}`}>
                      {comfyOnline ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>
                <div className="field">
                  <label>ComfyUI path</label>
                  <input value={comfyRoot} onChange={(e) => setComfyRoot(e.target.value)} />
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        await api.setComfyRoot(comfyRoot);
                        setToast("Path salvo");
                        await refreshDeps();
                        onDone();
                      })
                    }
                  >
                    Salvar path
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        await refreshDeps();
                        setToast("Dependências verificadas");
                      })
                    }
                  >
                    Verificar
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        setDepsMsg("Instalando o que faltar…");
                        const r = await api.comfyEnsure(false);
                        setDeps(r.report);
                        setDepsMsg(
                          r.ok
                            ? "Stack ok (Comfy / DaSiWa / workflows)"
                            : "Ainda faltam itens — veja a lista"
                        );
                        setToast(r.ok ? "Dependências corrigidas" : "Correção parcial");
                        onDone();
                      })
                    }
                  >
                    Corrigir / instalar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        await api.comfyStart();
                        setToast("ComfyUI iniciando");
                        onDone();
                      })
                    }
                  >
                    Iniciar ComfyUI
                  </button>
                </div>

                <div className="deps-list">
                  <div className={`deps-row ${deps?.comfyui?.ok ? "ok" : "bad"}`}>
                    <StatusDot ok={!!deps?.comfyui?.ok} />
                    <div>
                      <strong>ComfyUI</strong>
                      <div className="deps-meta">{deps?.comfyui_root || comfyRoot || "—"}</div>
                    </div>
                    {!deps?.comfyui?.ok ? (
                      <div className="deps-actions">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            withBusy(async () => {
                              const r = await api.comfyClone();
                              setToast(r.message || r.error || "Clone");
                              await refreshDeps();
                              onDone();
                            })
                          }
                        >
                          Clonar
                        </button>
                      </div>
                    ) : (
                      <span className="muted">OK</span>
                    )}
                  </div>
                  <div className={`deps-row ${deps?.dasiwa?.ok ? "ok" : "bad"}`}>
                    <StatusDot ok={!!deps?.dasiwa?.ok} />
                    <div>
                      <strong>DaSiWa Continuity</strong>
                      <div className="deps-meta">custom_nodes/ComfyUI-DaSiWa-Nodes</div>
                    </div>
                    {!deps?.dasiwa?.ok ? (
                      <div className="deps-actions">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            withBusy(async () => {
                              const r = await api.dasiwa();
                              setToast(r.message || r.error || "DaSiWa");
                              await refreshDeps();
                              onDone();
                            })
                          }
                        >
                          Instalar
                        </button>
                      </div>
                    ) : (
                      <span className="muted">OK</span>
                    )}
                  </div>
                  <div className={`deps-row ${deps?.workflows?.ok ? "ok" : "bad"}`}>
                    <StatusDot ok={!!deps?.workflows?.ok} />
                    <div>
                      <strong>Workflows H3</strong>
                      <div className="deps-meta">
                        {deps?.workflows
                          ? `${deps.workflows.present}/${deps.workflows.expected} no Comfy`
                          : "—"}
                      </div>
                    </div>
                    <div className="deps-actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          withBusy(async () => {
                            const r = await api.workflows();
                            setToast(`${r.copied?.length || 0} workflows`);
                            await refreshDeps();
                            onDone();
                          })
                        }
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                  <div className={`deps-row ${deps?.ffmpeg?.ok ? "ok" : "bad"}`}>
                    <StatusDot ok={!!deps?.ffmpeg?.ok} />
                    <div>
                      <strong>ffmpeg</strong>
                      <div className="deps-meta">
                        {deps?.ffmpeg?.ok ? "no PATH" : "Instale e reinicie o Studio"}
                      </div>
                    </div>
                    <span className="muted">{deps?.ffmpeg?.ok ? "OK" : "Manual"}</span>
                  </div>
                </div>

                <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                  <strong style={{ fontSize: 13 }}>Modelos MiniMax H3</strong>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        setDepsMsg("Baixando pack SFW (pode demorar)…");
                        const r = await api.comfyEnsure(true);
                        setDeps(r.report);
                        setDepsMsg(
                          r.report?.models?.sfw_ready
                            ? "Pack SFW pronto"
                            : "SFW incompleto — veja itens sem download automático"
                        );
                        setToast("Download SFW finalizado");
                        onDone();
                      })
                    }
                  >
                    Baixar SFW faltantes
                  </button>
                </div>
                <div className="deps-list">
                  {Object.values(deps?.models?.models || models?.models || {}).map((m) => (
                    <div key={m.key} className={`deps-row ${m.ok ? "ok" : "bad"}`}>
                      <StatusDot ok={!!m.ok} />
                      <div>
                        <strong>
                          {m.key} · {m.required_for?.toUpperCase?.() || ""}
                        </strong>
                        <div className="deps-meta">{m.name || m.path}</div>
                      </div>
                      {m.ok ? (
                        <span className="muted">OK</span>
                      ) : m.can_auto_download ? (
                        <div className="deps-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              withBusy(async () => {
                                setDepsMsg(`Baixando ${m.key}…`);
                                await api.downloadModel(m.key);
                                await refreshDeps();
                                setDepsMsg(`${m.key} baixado`);
                                setToast(`${m.key} ok`);
                                onDone();
                              })
                            }
                          >
                            Baixar
                          </button>
                        </div>
                      ) : (
                        <span className="muted" title={m.download_hint}>
                          Manual
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {depsMsg ? <div className="alert">{depsMsg}</div> : null}
                <div className="muted" style={{ fontSize: 11 }}>
                  SFW: download automático via HuggingFace quando possível. NSFW: coloque os
                  arquivos nas pastas indicadas (sem URL pública estável).
                </div>
              </section>
            ) : null}

            {tab === "energy" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <h3>Custo de energia</h3>
                  <p className="muted">
                    Usado para estimar R$ e minutos na fila e na página do projeto.
                  </p>
                </div>
                <div className="settings-grid-2">
                  <div className="field">
                    <label>Watts (GPU + sistema)</label>
                    <input
                      value={machine.watts}
                      onChange={(e) => setMachine({ ...machine, watts: e.target.value })}
                      placeholder="ex. 280"
                    />
                  </div>
                  <div className="field">
                    <label>Tarifa R$/kWh</label>
                    <input
                      value={machine.tariff_brl_per_kwh}
                      onChange={(e) =>
                        setMachine({ ...machine, tariff_brl_per_kwh: e.target.value })
                      }
                    />
                  </div>
                </div>
                {hw ? (
                  <div className="alert">
                    Sugestão de hardware: {hw.gpu_name || "GPU"} · {hw.vram_gb ?? "?"} GB
                    {hw.message ? ` — ${hw.message}` : ""}
                  </div>
                ) : null}
                <div className="settings-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        await api.patchMachine({
                          watts: machine.watts ? Number(machine.watts) : null,
                          tariff_brl_per_kwh: Number(machine.tariff_brl_per_kwh),
                        });
                        setToast("Custo salvo");
                        onDone();
                      })
                    }
                  >
                    Salvar custo
                  </button>
                </div>
              </section>
            ) : null}

            {tab === "system" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <h3>Sistema</h3>
                  <p className="muted">Hardware, ffmpeg e packs de modelo detectados.</p>
                </div>
                {hw ? (
                  <div
                    className={`alert ${
                      hw.verdict === "ok" ? "good" : hw.verdict === "tight" ? "warn" : "bad"
                    }`}
                  >
                    <strong>
                      {hw.verdict === "ok"
                        ? "Hardware ok"
                        : hw.verdict === "tight"
                          ? "Apertado"
                          : "Atenção"}
                    </strong>
                    <div>{hw.message}</div>
                    <div className="muted" style={{ marginTop: 6 }}>
                      {hw.gpu_name || "GPU desconhecida"} · {hw.vram_gb ?? "?"} GB VRAM
                      {hw.ffmpeg?.ok ? " · ffmpeg OK" : " · ffmpeg ausente"}
                    </div>
                  </div>
                ) : (
                  <div className="alert warn">Hardware ainda não detectado.</div>
                )}
                <div className="settings-card-grid">
                  <div className="settings-card">
                    <strong>ffmpeg</strong>
                    <p className="muted">
                      {steps.ffmpeg?.done
                        ? "Encontrado no PATH — posters e masters ok."
                        : "Não encontrado. Instale e reinicie o Studio."}
                    </p>
                    <StatusDot ok={!!steps.ffmpeg?.done} />
                  </div>
                  <div className="settings-card">
                    <strong>Modelos SFW</strong>
                    <p className="muted">
                      {models?.sfw_ready
                        ? "Pack Continuity SFW pronto."
                        : "Baixe os checkpoints MiniMax H3 no ComfyUI."}
                    </p>
                    {models?.missing_sfw?.length ? (
                      <p className="muted" style={{ fontSize: 11 }}>
                        Faltando: {models.missing_sfw.slice(0, 3).join(", ")}
                        {models.missing_sfw.length > 3 ? "…" : ""}
                      </p>
                    ) : null}
                    <StatusDot ok={!!models?.sfw_ready || !!steps.models_sfw?.done} />
                  </div>
                </div>
                <div className="settings-actions">
                  <button type="button" onClick={() => onDone()}>
                    Atualizar status
                  </button>
                  <button type="button" onClick={() => setTab("comfy")}>
                    Ir para ComfyUI
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
