/**
 * The brand-representative renders the design ships, by brand. Files live in
 * `public/home/`.
 *
 * These are illustrations of the brand, not photographs of a unit. Buyers see
 * the real machine's condition photographs, with captions, on the SKU page
 * only; a card that showed a unit photo without its caption would be making a
 * claim about the exact machine that it cannot back.
 */
const PHOTO: Record<string, string> = {
  dell: '/home/laptop-dell.png',
  apple: '/home/laptop-apple.png',
  asus: '/home/laptop-asus.png',
  lenovo: '/home/laptop-lenovo.png',
};

/** The brand render for `brand`, or `null` when the design has none for it. */
export function brandPhoto(brand: string): string | null {
  return PHOTO[brand.trim().toLowerCase()] ?? null;
}
