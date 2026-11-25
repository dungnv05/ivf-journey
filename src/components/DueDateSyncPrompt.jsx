import React from 'react';
import './DueDateSyncPrompt.css';

function formatDateVi(isoDate) {
  if (typeof isoDate !== 'string') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function DueDateSyncPrompt({
  kind,
  localDate,
  serverDate,
  busy = false,
  onUseServer,
  onUseLocal,
  onLater,
}) {
  if (kind !== 'offer_upload' && kind !== 'conflict') {
    return null;
  }

  const formattedLocal = formatDateVi(localDate);
  const formattedServer = formatDateVi(serverDate);

  return (
    <div className="dds-card" role="region" aria-live="polite">
      <p className="dds-message">
        {kind === 'offer_upload'
          ? `Lưu ngày dự sinh ${formattedLocal} vào tài khoản YunDev để dùng trên thiết bị khác?`
          : `Ngày dự sinh trên tài khoản (${formattedServer}) khác với trên máy này (${formattedLocal}).`}
      </p>

      <div className="dds-actions">
        {kind === 'conflict' ? (
          <button
            type="button"
            className="dds-btn dds-btn-primary"
            disabled={busy}
            onClick={onUseServer}
          >
            Dùng ngày trên tài khoản
          </button>
        ) : null}

        <button
          type="button"
          className={
            kind === 'offer_upload'
              ? 'dds-btn dds-btn-primary'
              : 'dds-btn dds-btn-secondary'
          }
          disabled={busy}
          onClick={onUseLocal}
        >
          {kind === 'offer_upload'
            ? 'Lưu vào tài khoản'
            : 'Dùng ngày trên máy này'}
        </button>

        <button
          type="button"
          className="dds-btn dds-btn-ghost"
          disabled={busy}
          onClick={onLater}
        >
          Để sau
        </button>
      </div>
    </div>
  );
}

export default DueDateSyncPrompt;
