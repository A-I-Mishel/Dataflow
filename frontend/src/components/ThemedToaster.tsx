import { Toaster } from "react-hot-toast";

// Theme-aware via CSS variables: switching .light/.dark repaints toasts
// with no subscription and no duplicated hex literals.
export default function ThemedToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: "rgb(var(--panel))",
          color: "rgb(var(--ink))",
          border: "1px solid rgb(var(--line))",
        },
      }}
    />
  );
}
