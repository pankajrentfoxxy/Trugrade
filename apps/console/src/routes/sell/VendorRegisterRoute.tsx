import * as React from 'react';
import { useAuth } from '../../lib/auth';
import { SupplierSignup } from './SupplierSignup';

/**
 * ARCHETYPE F — Focus. One-minute signup; the seven-step KYC form is retired
 * from this route (components kept until Stage 9).
 */
export function VendorRegisterRoute(): React.JSX.Element {
  const { syncSession } = useAuth();

  const handleSessionEstablished = React.useCallback((): void => {
    void syncSession();
  }, [syncSession]);

  return <SupplierSignup onSessionEstablished={handleSessionEstablished} />;
}
