import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(var(--canvas)/0.72)] p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[26rem] overflow-hidden rounded-[24px] border border-line bg-panel shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-3 p-5">
          <p className="text-[15px] font-extrabold tracking-tight text-ink">{title}</p>
          <p className="text-sm leading-relaxed text-ink2">{message}</p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-full border border-line bg-card px-4 py-2.5 text-sm font-bold text-ink2 transition-colors hover:border-accent/30 hover:text-ink"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              className={`flex-1 rounded-full px-4 py-2.5 text-sm font-extrabold transition-all ${
                danger
                  ? "bg-red-500 text-white shadow-md hover:bg-red-600"
                  : "bg-accentbtn hover:bg-accentbtnhover text-white shadow-md"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
