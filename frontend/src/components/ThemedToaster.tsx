import { Toaster } from 'react-hot-toast';

import { usePipelineStore } from '../stores/pipelineStore';

export default function ThemedToaster() {
  const theme = usePipelineStore((state) => state.theme);
  const isLight = theme === 'light';
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: isLight ? '#ffffff' : '#1e293b',
          color: isLight ? '#0f172a' : '#f1f5f9',
          border: isLight ? '1px solid #e2e8f0' : '1px solid #334155',
        },
      }}
    />
  );
}
