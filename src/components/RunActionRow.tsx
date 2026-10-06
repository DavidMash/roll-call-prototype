import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

// undefined means a component is rendered outside the run shell (for example,
// a focused static test); null means the shell target has not mounted yet.
export const RunActionRowContext = createContext<HTMLElement | null | undefined>(undefined);

export function RunActionPortal({ children }: { children: ReactNode }) {
  const target = useContext(RunActionRowContext);
  if (target === undefined) return children;
  return target ? createPortal(children, target) : null;
}

export function RunActionRow({ setTarget }: { setTarget: (target: HTMLDivElement | null) => void }) {
  return <div ref={setTarget} className="run-action-row" data-testid="run-action-row"
    aria-label="Run actions" />;
}
