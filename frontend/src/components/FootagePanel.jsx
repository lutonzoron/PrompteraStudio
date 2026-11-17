import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';
import { runProjectAction, useProjectActions } from '../projectActions.js';

export default function FootagePanel({ project, onProject, onRefresh, setToast, available }) {
  const t = useT();
  const pending = useProjectActions();
  const [start, setStart] = useState(project.cctv_timestamp_start || '');
  const [position, setPosition] = useState('top-left');
  const [color, setColor] = useState('white');
  useEffect(() => {
    setStart(project.cctv_timestamp_start || '');
  }, [project.id, project.cctv_timestamp_start, project.cctv_timestamp_enabled]);
  const busy = pending.has(project.id);

  async function apply(exportVideo) {
    return runProjectAction(project.id, t(exportVideo ? 'footage.exporting' : 'footage.saving'), async () => {
      try {
        await api.patchProject(project.id, { cctv_timestamp_start: start });
        if (exportVideo) await api.footageExport(project.id, { start_time: start, position, color });
        onProject(await api.project(project.id));
        await onRefresh();
        setToast(t(exportVideo ? 'footage.exported' : 'footage.saved'));
      } catch (e) { setToast(String(e.message || e)); }
    });
  }

  return <section className="pp-panel footage-panel" id="footage-controls">
    <h2>{t('footage.title')}</h2>
    <p className="muted">{t('footage.hint')}</p>
    {!available && <p className="alert warn">{t('footage.needsRestart')}</p>}
    <div className="field">
      <label htmlFor={`clock-${project.id}`}>{t('footage.start')}</label>
      <input id={`clock-${project.id}`} type="datetime-local" step="1" value={start.slice(0,19)}
        disabled={busy || !available} onChange={(e) => setStart(e.target.value)} />
    </div>
    <div className="footage-options">
      <label>{t('footage.position')}<select value={position} disabled={busy || !available} onChange={(e) => setPosition(e.target.value)}>
        {['top-left','top-right','bottom-left','bottom-right'].map((p) => <option key={p} value={p}>{t(`footage.${p}`)}</option>)}
      </select></label>
      <label>{t('footage.color')}<select value={color} disabled={busy || !available} onChange={(e) => setColor(e.target.value)}>
        <option value="white">{t('footage.white')}</option><option value="green">{t('footage.green')}</option>
      </select></label>
    </div>
    <div className="row">
      <button type="button" disabled={busy || !available || !start} onClick={() => apply(false)}>{t('common.save')}</button>
      <button type="button" className="primary" disabled={busy || !available || !start || !project.has_master}
        onClick={() => apply(true)}>{t('footage.apply')}</button>
    </div>
    {!project.has_master && <p className="muted">{t('footage.waitMaster')}</p>}
    <div className="stack">
      {(project.footage_exports || []).slice(0,5).map((item) => <a className="btn-link" key={item.id} href={item.url} download>
        {t('footage.download')} · {item.start_time.replace('T',' ')}
      </a>)}
    </div>
  </section>;
}
