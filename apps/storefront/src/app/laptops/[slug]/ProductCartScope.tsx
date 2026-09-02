'use client';

import { ProductCartProvider } from '../../../lib/use-product-cart';

/** Shares one cart across the regular and margin comparison boards. */
export function ProductCartScope({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <ProductCartProvider>{children}</ProductCartProvider>;
}
