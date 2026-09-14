import * as React from 'react';
import { useAuth } from '../../lib/auth';
import { SupplierSignup } from './SupplierSignup';

/**
 * ARCHETYPE F — Focus. One-minute signup; the seven-step KYC form is retired
 * from this route (components kept until Stage 9).
 */
export function VendorRegisterRoute(): React.JSX.Element {
  const { syncSession } = useAuth();

  // Returned, not fired-and-forgotten: `SupplierSignup` awaits this before it
  // navigates to `/vendor`, so the route guard sees the current session
  // instead of racing a `setPrincipal` that has not landed yet.
  const handleSessionEstablished = React.useCallback((): Promise<void> => syncSession(), [
    syncSession,
  ]);

  return <SupplierSignup onSessionEstablished={handleSessionEstablished} />;
}
