import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const stack: HTMLElement[] = [];

function focusables(root: HTMLElement): HTMLElement[] {
  const found = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return [...found].filter((el) => el.getClientRects().length > 0);
}

interface FocusTrapOptions {
  /** Element to focus on open. Defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * Trap Tab inside a modal dialog. Stack-aware: when dialogs nest (confirm
 * over save/load), only the topmost trap handles Tab; each trap restores
 * focus to whatever was focused before it opened when it unmounts.
 * Attach the returned ref to the `role="dialog"` element.
 */
export function useFocusTrap<T extends HTMLElement>(options: FocusTrapOptions = {}): RefObject<T> {
  const ref = useRef<T>(null);
  const { initialFocus } = options;

  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    stack.push(root);
    const initial = initialFocus?.current;
    if (initial !== undefined && initial !== null && root.contains(initial)) {
      initial.focus();
    } else {
      focusables(root)[0]?.focus();
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      // A stacked dialog renders above — it owns Tab while open.
      if (stack[stack.length - 1] !== root) return;
      const items = focusables(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = stack.indexOf(root);
      if (index >= 0) stack.splice(index, 1);
      previouslyFocused?.focus?.();
    };
  }, [initialFocus]);

  return ref;
}
