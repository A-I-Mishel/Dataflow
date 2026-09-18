import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

import ConfirmDialog from "../components/ConfirmDialog";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
  isOpen: boolean;
} {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    setPending(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean): void => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const dialog =
    pending !== null ? (
      <ConfirmDialog
        title={pending.title}
        message={pending.message}
        confirmLabel={pending.confirmLabel}
        cancelLabel={pending.cancelLabel}
        danger={pending.danger}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    ) : null;

  return { confirm, dialog, isOpen: pending !== null };
}
