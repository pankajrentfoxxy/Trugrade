/**
 * The brand-representative picture each product card shows, by brand.
 *
 * These are illustrations of the brand, not photographs of a unit. Buyers see
 * the real machine's condition photographs, with captions, on the SKU page
 * only; a card that showed a unit photo without its caption would be making a
 * claim about the exact machine that it cannot back.
 *
 * Dell, HP, Lenovo, Apple, Acer, Microsoft and Asus are supplied product shots, served from the
 * marketplace CDN they were given at. That makes every card depend on a third
 * party's servers and on their hotlinking staying allowed; when these are
 * final, copy the files into `public/home/` and point these entries there.
 * A brand with no entry gets the
 * drawn laptop outline every card already falls back to.
 */
const PHOTO: Record<string, string> = {
  dell: 'https://m.media-amazon.com/images/I/61BdsDQbMiL._AC_UY218_.jpg',
  hp: 'https://m.media-amazon.com/images/I/71Fz6SvBTRL._AC_UY218_.jpg',
  lenovo: 'https://m.media-amazon.com/images/I/71ufvci7cRL._AC_UY218_.jpg',
  apple: 'https://m.media-amazon.com/images/I/71OjWwgFuEL._AC_UY218_.jpg',
  acer: 'https://m.media-amazon.com/images/I/71JEGsayyGL._AC_UY218_.jpg',
  microsoft: 'https://m.media-amazon.com/images/I/710CFplp8+L._AC_UY218_.jpg',
  asus: 'https://m.media-amazon.com/images/I/71oGM-26fZL._AC_UY218_.jpg',
};

/** The brand picture for `brand`, or `null` when there is none for it. */
export function brandPhoto(brand: string): string | null {
  return PHOTO[brand.trim().toLowerCase()] ?? null;
}
