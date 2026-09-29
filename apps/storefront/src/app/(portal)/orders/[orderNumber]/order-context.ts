import * as React from 'react';
import type { OrderPhase } from './order-state';

/**
 * The order the layout has read, shared with every panel under it.
 *
 * In its own module so the tab strip and the tabs can read it without
 * importing the chrome that renders them — a cycle the bundler tolerates and a
 * reader should not have to.
 */
export const OrderContext = React.createContext<OrderPhase | null>(null);
export const ReloadContext = React.createContext<() => void>(() => {});

export function useSharedOrder(): OrderPhase | null {
  return React.useContext(OrderContext);
}

export function useReloadOrder(): () => void {
  return React.useContext(ReloadContext);
}
