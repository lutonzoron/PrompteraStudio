import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { LOCALES, useLocale, useT } from "../i18n/index.jsx";

const STEP_TAB = {
  llm: "ia",
  hardware: "system",
  comfyui: "comfy",
  dasiwa: "comfy",
  models_sfw: "comfy",
  ffmpeg: "system",
  cost: "energy",
  styles: "overview",
};

const STEP_LABEL = {
  llm: "settings.stepLlm",
  hardware: "settings.stepHardware",
  comfyui: "settings.stepComfy",
  dasiwa: "settings.stepDasiwa",
  models_sfw: "settings.stepModels",
  ffmpeg: "settings.stepFfmpeg",
  cost: "settings.stepCost",
  styles: "settings.stepStyles",
};

function StatusDot({ ok }) {
  return <i className={`dot ${ok ? "on" : "off"}`} />;
}

export default function Settings({ health, onClose, onDone, setToast, onOpenStyles }) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const steps = health?.onboarding?.steps || {};
  const hw = health?.onboarding?.hardware;
  const models = health?.onboarding?.models;
  const comfyOnline = !!health?.comfy?.online;

  const incomplete = useMemo(
    () => Object.entries(steps).filter(([, s]) => !s.done).map(([k]) => k),
    [steps]
  );

  const tabs = useMemo(
    () => [
      { id: "overview", label: t("settings.tabOverview") },
      { id: "ia", label: t("settings.tabAi") },
      { id: "comfy", label: t("settings.tabComfy") },
      { id: "energy", label: t("settings.tabEnergy") },
      { id: "system", label: t("settings.tabSystem") },
    ],
    [t]
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
  const [modelSources, setModelSources] = useState({});

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
    } catch (e) {
      setDepsMsg(String(e.message || e));
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay-center" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <div>
            <h2>{t("settings.title")}</h2>
            <p className="muted">
              {health?.onboarding?.complete
                ? t("settings.ready")
                : t("settings.pending", { n: incomplete.length })}
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            {t("settings.close")}
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-btn ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="settings-body">
            {tab === "overview" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <h3>{t("lang.label")}</h3>
                  <p className="muted">{t("lang.hint")}</p>
                </div>
                <div className="field" style={{ maxWidth: 280 }}>
                  <label htmlFor="promptera-locale">{t("lang.label")}</label>
                  <select
                    id="promptera-locale"
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                  >
                    {LOCALES.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {t(loc.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-intro">
                  <h3>{t("settings.checklist")}</h3>
                  <p className="muted">{t("settings.checklistHint")}</p>
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
                      <span className="settings-check-label">
                        {STEP_LABEL[k] ? t(STEP_LABEL[k]) : s.label}
                      </span>
                      <span className="settings-check-state">
                        {s.done ? t("common.ok") : t("common.configure")}
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
                    {t("settings.configureAi")}
                  </button>
                  <button type="button" onClick={() => setTab("comfy")}>
                    ComfyUI
                  </button>
                  {onOpenStyles ? (
                    <button type="button" onClick={onOpenStyles}>
                      {t("settings.styles")}
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {tab === "ia" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <h3>{t("settings.aiTitle")}</h3>
                  <p className="muted">{t("settings.aiHint")}</p>
                </div>
                <div className="settings-grid-2">
                  <div className="field">
                    <label>{t("settings.provider")}</label>
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
                    <label>{t("settings.model")}</label>
                    <input
                      value={llm.model || ""}
                      onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                    />
                  </div>
                </div>
                <div className="field">
                  <label>{t("settings.baseUrl")}</label>
                  <input
                    value={llm.base_url || ""}
                    onChange={(e) => setLlm({ ...llm, base_url: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{t("settings.apiKey")}</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={llm.api_key}
                    onChange={(e) => setLlm({ ...llm, api_key: e.target.value })}
                  />
                </div>
                {msg ? (
                  <div className={`alert ${msg.startsWith("AI OK") || msg.startsWith("IA OK") ? "good" : "bad"}`}>
                    {msg}
                  </div>
                ) : null}
                <div className="settings-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        const r = await api.putLlm(llm);
                        setMsg(
                          r.ok
                            ? t("settings.aiOk", { reply: r.reply })
                            : t("settings.aiFail", { error: r.error })
                        );
                        setToast(r.ok ? t("settings.aiConnected") : t("settings.aiFailedToast"));
                        onDone();
                      })
                    }
                  >
                    {t("settings.saveTestAi")}
                  </button>
                </div>
              </section>
            ) : null}

            {tab === "comfy" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <h3>{t("settings.comfyTitle")}</h3>
                      <p className="muted">{t("settings.comfyHint")}</p>
                    </div>
                    <span className={`status-pill ${comfyOnline ? "done" : "failed"}`}>
                      {comfyOnline ? t("common.online") : t("common.offline")}
                    </span>
                  </div>
                </div>
                <div className="field">
                  <label>{t("settings.comfyPath")}</label>
                  <input value={comfyRoot} onChange={(e) => setComfyRoot(e.target.value)} />
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        await api.setComfyRoot(comfyRoot);
                        setToast(t("settings.pathSaved"));
                        await refreshDeps();
                        onDone();
                      })
                    }
                  >
                    {t("settings.savePath")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        await refreshDeps();
                        setToast(t("settings.depsChecked"));
                      })
                    }
                  >
                    {t("settings.verify")}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        setDepsMsg(t("settings.installing"));
                        const r = await api.comfyEnsure(false);
                        setDeps(r.report);
                        setDepsMsg(r.ok ? t("settings.stackOk") : t("settings.stackPartial"));
                        setToast(r.ok ? t("settings.depsFixed") : t("settings.depsPartial"));
                        onDone();
                      })
                    }
                  >
                    {t("settings.fixInstall")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        await api.comfyStart();
                        setToast(t("settings.comfyStarting"));
                        onDone();
                      })
                    }
                  >
                    {t("settings.startComfy")}
                  </button>
                </div>

                {['runtime', 'runtime_nsfw'].map((key) => deps?.[key] ? (
                  <div key={key} className={`alert ${deps[key].ok ? 'good' : 'bad'}`}>
                    <strong>ComfyUI · {key === 'runtime' ? 'SFW' : 'NSFW'} · {deps[key].ok ? 'Compatível com o workflow' : 'Pendências para gerar'}</strong>
                    {deps[key].errors.map((message, i) => <div key={i}>{message}</div>)}
                  </div>
                ) : null)}
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
                          {t("settings.clone")}
                        </button>
                      </div>
                    ) : (
                      <span className="muted">{t("common.ok")}</span>
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
                          {t("settings.install")}
                        </button>
                      </div>
                    ) : (
                      <span className="muted">{t("common.ok")}</span>
                    )}
                  </div>
                  <div className={`deps-row ${deps?.workflows?.ok ? "ok" : "bad"}`}>
                    <StatusDot ok={!!deps?.workflows?.ok} />
                    <div>
                      <strong>H3 workflows</strong>
                      <div className="deps-meta">
                        {deps?.workflows
                          ? t("settings.workflowsMeta", {
                              present: deps.workflows.present,
                              expected: deps.workflows.expected,
                            })
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
                        {t("settings.copy")}
                      </button>
                    </div>
                  </div>
                  <div className={`deps-row ${deps?.ffmpeg?.ok ? "ok" : "bad"}`}>
                    <StatusDot ok={!!deps?.ffmpeg?.ok} />
                    <div>
                      <strong>ffmpeg</strong>
                      <div className="deps-meta">
                        {deps?.ffmpeg?.ok ? t("settings.ffmpegPathOk") : t("settings.ffmpegInstall")}
                      </div>
                    </div>
                    <span className="muted">
                      {deps?.ffmpeg?.ok ? t("common.ok") : t("common.manual")}
                    </span>
                  </div>
                </div>

                <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                  <strong style={{ fontSize: 13 }}>Modelos MiniMax H3 · SFW e NSFW</strong>
                  {['sfw', 'nsfw'].map((pack) => (
                  <button
                    key={pack}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        setDepsMsg(`Baixando modelos H3 ${pack.toUpperCase()} faltantes. Arquivos grandes: aguarde a conclusão.`);
                        const r = await api.downloadModelPack(pack);
                        await refreshDeps();
                        setDepsMsg(r.ok ? `Pacote ${pack.toUpperCase()} instalado. Reinicie o ComfyUI e verifique as dependências.` :
                          r.results.filter((item) => !item.ok).map((item) => `${item.key}: ${item.error}`).join('\n'));
                        setToast(r.ok ? t("settings.downloadDone") : 'Download incompleto: confira as pendências.');
                        onDone();
                      })
                    }
                  >
                    Baixar H3 {pack.toUpperCase()} faltantes
                  </button>
                  ))}
                </div>
                <p className="muted">Os pacotes incluem o modelo H3, o encoder de texto e os VAEs compartilhados. Configure o link direto quando não houver uma fonte definida. Após baixar, reinicie o ComfyUI e verifique as dependências.</p>
                <div className="deps-list">
                  {Object.values(deps?.models?.models || models?.models || {}).map((m) => (
                    <div key={m.key} className={`deps-row ${m.ok ? "ok" : "bad"}`}>
                      <StatusDot ok={!!m.ok} />
                      <div>
                        <strong>
                          {m.label || m.key} · {m.required_for?.toUpperCase?.() || ""}
                        </strong>
                        <div className="deps-meta">{m.name || m.path}</div>
                        <div className="deps-meta">Destino: {m.path}</div>
                        <details>
                          <summary>Link de download{!m.can_auto_download ? ' · configurar para baixar' : ''}</summary>
                          <input aria-label={`Link direto ${m.key}`} type="url" placeholder="https://huggingface.co/.../resolve/main/arquivo.safetensors"
                            value={modelSources[m.key] ?? m.download_url ?? ''}
                            onChange={(e) => setModelSources((prev) => ({ ...prev, [m.key]: e.target.value }))} />
                          <button type="button" disabled={busy} onClick={() => withBusy(async () => {
                            await api.modelSource(m.key, modelSources[m.key] ?? m.download_url ?? '');
                            await refreshDeps();
                            setDepsMsg('Link salvo. Agora você pode baixar este modelo ou o pacote completo.');
                          })}>Salvar link</button>
                        </details>
                      </div>
                      {m.ok ? (
                        <span className="muted">{t("common.ok")}</span>
                      ) : m.can_auto_download ? (
                        <div className="deps-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              withBusy(async () => {
                                setDepsMsg(t("settings.downloading", { key: m.key }));
                                await api.downloadModel(m.key);
                                await refreshDeps();
                                setDepsMsg(`${t("settings.downloaded", { key: m.key })} Reinicie o ComfyUI e verifique as dependências.`);
                                setToast(`${m.key} ok`);
                                onDone();
                              })
                            }
                          >
                            Download
                          </button>
                        </div>
                      ) : (
                        <span className="muted">Informe e salve o link direto para habilitar o download.</span>
                      )}
                    </div>
                  ))}
                </div>
                {depsMsg ? <div className="alert">{depsMsg}</div> : null}
                <div className="muted" style={{ fontSize: 11 }}>
                  {t("settings.modelsHint")}
                </div>
              </section>
            ) : null}

            {tab === "energy" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <h3>{t("settings.energyTitle")}</h3>
                  <p className="muted">{t("settings.energyHint")}</p>
                </div>
                <div className="settings-grid-2">
                  <div className="field">
                    <label>{t("settings.watts")}</label>
                    <input
                      value={machine.watts}
                      onChange={(e) => setMachine({ ...machine, watts: e.target.value })}
                      placeholder={t("settings.wattsPh")}
                    />
                  </div>
                  <div className="field">
                    <label>{t("settings.tariff")}</label>
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
                    {t("settings.hwSuggest", {
                      gpu: hw.gpu_name || "GPU",
                      vram: hw.vram_gb ?? "?",
                    })}
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
                        setToast(t("settings.costSaved"));
                        onDone();
                      })
                    }
                  >
                    {t("settings.saveCost")}
                  </button>
                </div>
              </section>
            ) : null}

            {tab === "system" ? (
              <section className="settings-section stack">
                <div className="settings-intro">
                  <h3>{t("settings.systemTitle")}</h3>
                  <p className="muted">{t("settings.systemHint")}</p>
                </div>
                {hw ? (
                  <div
                    className={`alert ${
                      hw.verdict === "ok" ? "good" : hw.verdict === "tight" ? "warn" : "bad"
                    }`}
                  >
                    <strong>
                      {hw.verdict === "ok"
                        ? t("settings.hwOk")
                        : hw.verdict === "tight"
                          ? t("settings.hwTight")
                          : t("settings.hwWarn")}
                    </strong>
                    <div>{hw.message}</div>
                    <div className="muted" style={{ marginTop: 6 }}>
                      {hw.gpu_name || t("settings.gpuUnknown")} · {hw.vram_gb ?? "?"} GB VRAM
                      {hw.ffmpeg?.ok ? " · ffmpeg OK" : " · ffmpeg missing"}
                    </div>
                  </div>
                ) : (
                  <div className="alert warn">{t("settings.hwUnknown")}</div>
                )}
                <div className="settings-card-grid">
                  <div className="settings-card">
                    <strong>ffmpeg</strong>
                    <p className="muted">
                      {steps.ffmpeg?.done ? t("settings.ffmpegOkCard") : t("settings.ffmpegMissing")}
                    </p>
                    <StatusDot ok={!!steps.ffmpeg?.done} />
                  </div>
                  <div className="settings-card">
                    <strong>{t("settings.modelsSfwCard")}</strong>
                    <p className="muted">
                      {models?.sfw_ready ? t("settings.modelsSfwReady") : t("settings.modelsSfwNeed")}
                    </p>
                    {models?.missing_sfw?.length ? (
                      <p className="muted" style={{ fontSize: 11 }}>
                        {t("settings.missing", {
                          list:
                            models.missing_sfw.slice(0, 3).join(", ") +
                            (models.missing_sfw.length > 3 ? "…" : ""),
                        })}
                      </p>
                    ) : null}
                    <StatusDot ok={!!models?.sfw_ready || !!steps.models_sfw?.done} />
                  </div>
                </div>
                <div className="settings-actions">
                  <button type="button" onClick={() => onDone()}>
                    {t("settings.refreshStatus")}
                  </button>
                  <button type="button" onClick={() => setTab("comfy")}>
                    {t("settings.goComfy")}
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
