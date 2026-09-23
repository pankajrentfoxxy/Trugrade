'use client';

import { ProductCartProvider } from '../../../lib/use-product-cart';
import { ViewCartDock } from './ViewCartDock';
import { DefaultPincode } from './DefaultPincode';

/**
 * Shares one cart across the regular and margin comparison boards — and one
 * session probe, which is why the pincode prefill sits here too: it needs to
 * know the buyer is signed in, and this scope already asked.
 */
export function ProductCartScope({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ProductCartProvider>
      {children}
      <DefaultPincode />
      <ViewCartDock />
    </ProductCartProvider>
  );
}
