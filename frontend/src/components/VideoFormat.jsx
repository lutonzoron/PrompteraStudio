import React, { useId } from 'react';
import { useT } from '../i18n/index.jsx';

export const VIDEO_FORMATS = [
  { id: 'phone', width: 576, height: 1024, ratio: '9:16' },
  { id: 'landscape', width: 1024, height: 576, ratio: '16:9' },
  { id: 'square', width: 768, height: 768, ratio: '1:1' },
  { id: 'feed', width: 768, height: 960, ratio: '4:5' },
];

export default function VideoFormat({ width, height, onChange, disabled = false, locked = false }) {
  const t = useT();
  const id = useId();
  const selected = VIDEO_FORMATS.find((f) => f.width === width && f.height === height);
  return (
    <div className="field">
      <label htmlFor={id}>{t('videoFormat.label')}</label>
      <select id={id} disabled={disabled || locked} value={selected?.id || 'custom'} onChange={(e) => {
        const format = VIDEO_FORMATS.find((f) => f.id === e.target.value);
        if (format) onChange({ width: format.width, height: format.height });
      }}>
        {!selected && <option value="custom">{t('videoFormat.custom')} · {width} × {height}</option>}
        {VIDEO_FORMATS.map((f) => <option key={f.id} value={f.id}>
          {t(`videoFormat.${f.id}`)} · {f.ratio} · {f.width} × {f.height}
        </option>)}
      </select>
      <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        {locked ? t('videoFormat.locked') : t('videoFormat.hint')}
      </p>
    </div>
  );
}
