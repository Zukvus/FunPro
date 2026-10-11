import { createContext, useContext } from 'react';
import type { StatusResponse } from './hooks';

export interface DashboardCtx {
  status: StatusResponse | null;
  refreshStatus: () => void;
  navigate: (path: string) => void;
}

export const DashboardContext = createContext<DashboardCtx>({ status: null, refreshStatus: () => undefined, navigate: () => undefined });

export function useDashboard(): DashboardCtx {
  return useContext(DashboardContext);
}
