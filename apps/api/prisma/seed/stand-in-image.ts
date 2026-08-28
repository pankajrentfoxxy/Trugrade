/**
 * The bytes behind a seeded photograph.
 *
 * WHY IT SAYS WHAT IT IS. Every image in this repo's demo data is a placeholder,
 * and a placeholder dressed up as a photograph of a laptop is worse than an
 * obvious one: the entire product is a claim that somebody looked at the machine
 * and photographed what they saw. A stand-in that could be mistaken for evidence
 * turns a demo into a lie the moment a screenshot leaves the room. So these
 * carry the words on their face, and carry the real identifiers — serial, angle,
 * grade, view — so a screen author can tell at a glance that the right frame
 * reached the right slot.
 *
 * SVG rather than a raster: it is text, it is deterministic to the byte, it
 * needs no encoder, and the labels are legible at any size. It is served with
 * `default-src 'none'; sandbox` and `nosniff` (see `ObjectsController`), so it
 * is inert in the browser.
 *
 * Generated, never committed. 600-odd binaries in git to make a demo walk is a
 * repo nobody wants to clone.
 */

/** Greys and one amber, written as rgb() because literal hex belongs in the token layer. */
const INK = 'rgb(232,232,232)';
const INK_DIM = 'rgb(140,140,140)';
const GROUND = 'rgb(24,24,26)';
const FRAME = 'rgb(64,64,68)';
const ACCENT = 'rgb(214,158,46)';

const WIDTH = 1200;
const HEIGHT = 900;

export interface StandInSpec {
  /** The big line: the angle or the view code. */
  heading: string;
  /** Identifiers under it, one per line — serial, grade, model. */
  detail: readonly string[];
}

/** `&` and `<` in a model name would otherwise produce an unparseable document. */
function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function standInImage(spec: StandInSpec): { bytes: Buffer; contentType: string } {
  const detail = spec.detail
    .map((line, i) => {
      const y = 560 + i * 54;
      return `<text x="80" y="${y}" font-family="monospace" font-size="40" fill="${INK_DIM}">${xml(line)}</text>`;
    })
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" ` +
    `viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${GROUND}"/>` +
    // A frame and a cross, so a broken aspect ratio or a cropped container is
    // visible on the screen rather than only in a devtools panel.
    `<rect x="24" y="24" width="${WIDTH - 48}" height="${HEIGHT - 48}" fill="none" ` +
    `stroke="${FRAME}" stroke-width="4"/>` +
    `<path d="M24 24 L${WIDTH - 24} ${HEIGHT - 24} M${WIDTH - 24} 24 L24 ${HEIGHT - 24}" ` +
    `stroke="${FRAME}" stroke-width="2"/>` +
    `<rect x="24" y="24" width="${WIDTH - 48}" height="96" fill="${GROUND}"/>` +
    `<text x="80" y="92" font-family="monospace" font-size="34" letter-spacing="4" ` +
    `fill="${ACCENT}">STAND-IN — NOT A PHOTOGRAPH</text>` +
    `<text x="80" y="470" font-family="sans-serif" font-size="86" font-weight="600" ` +
    `fill="${INK}">${xml(spec.heading)}</text>` +
    detail +
    `</svg>`;

  return { bytes: Buffer.from(svg, 'utf8'), contentType: 'image/svg+xml' };
}
