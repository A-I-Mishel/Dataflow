import { Toaster } from "react-hot-toast";

import { usePipelineStore } from "../stores/pipelineStore";

export default function ThemedToaster() {
  const theme = usePipelineStore((state) => state.theme);
  const isLight = theme === "light";
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: isLight ? "#ffffff" : "#171C27",
          color: isLight ? "#0D1526" : "#E7ECF3",
          border: isLight ? "1px solid #E4E9F0" : "1px solid #2E3849",
        },
      }}
    />
  );
}
