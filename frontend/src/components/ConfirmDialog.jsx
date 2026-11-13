import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const confirm = useCallback((opts = {}) => {
    const {
      title = "Confirmar",
      message = "",
      confirmLabel = "OK",
      cancelLabel = "Cancelar",
      danger = false,
    } = typeof opts === "string" ? { message: opts } : opts;

    return new Promise((resolve) => {
      setDialog({
        title,
        message,
        confirmLabel,
        cancelLabel,
        danger,
        resolve,
      });
    });
  }, []);

  const close = useCallback(
    (value) => {
      if (!dialog) return;
      dialog.resolve(value);
      setDialog(null);
    },
    [dialog]
  );

  const api = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {dialog ? (
        <div
          className="backdrop confirm-backdrop"
          onClick={() => close(false)}
          role="presentation"
        >
          <div
            className={`confirm-dialog ${dialog.danger ? "is-danger" : ""}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-msg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-title">{dialog.title}</h3>
            <p id="confirm-msg" className="confirm-msg">
              {String(dialog.message)
                .split("\n")
                .map((line, i) => (
                  <span key={i}>
                    {i > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
            </p>
            <div className="confirm-actions">
              <button type="button" onClick={() => close(false)}>
                {dialog.cancelLabel}
              </button>
              <button
                type="button"
                className={dialog.danger ? "danger" : "primary"}
                autoFocus
                onClick={() => close(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    return (opts) =>
      Promise.resolve(
        window.confirm(typeof opts === "string" ? opts : opts?.message || "Confirmar?")
      );
  }
  return ctx;
}
