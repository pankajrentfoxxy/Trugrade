import qrcode from 'qrcode-generator';

/**
 * A real QR code, drawn as one SVG path.
 *
 * `09_FRONTEND_LOCKED.md` §4 lists the QR block against certificate
 * verification and says, of that motif specifically, **"real QR in production,
 * never decorative"**. `QrBlock` in `packages/ui` renders a conic-gradient
 * checkerboard — placeholder geometry, and the file says so in its own comment.
 * A checkerboard on the page whose entire job is to be scanned would be the one
 * thing §4 forbids a motif to be, so this draws the code the reference stands
 * in for. `qrcode-generator` is already in the workspace: the API draws the QR
 * on the printed report with it, and this is the same library encoding the same
 * URL, so the paper and the screen cannot drift apart.
 *
 * **The polarity is fixed and the tokens are the reason it can be.** A scanner
 * expects dark modules on a light ground and many will not read the inverse, so
 * this cannot use `--ink` on `--sheet` — in dark theme that is a light code on a
 * dark ground. `--chrome` and `--on-chrome` are the two tokens that do NOT flip
 * between themes (that is the whole point of the dark chrome), which makes them
 * the only correct pair here: near-black modules on near-white, identically in
 * both themes.
 */
export function Qr({
  value,
  size = 96,
}: {
  value: string;
  size?: number;
}): React.JSX.Element {
  // Type 0 lets the library pick the smallest version that fits; M corrects
  // ~15%, which is what a phone camera at arm's length under warehouse lighting
  // needs and what the printed report already uses.
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();

  const count = qr.getModuleCount();
  // Four modules of quiet zone, as the spec requires. Without it a scanner
  // reads the page background as part of the symbol and fails at a distance.
  const quiet = 4;
  const span = count + quiet * 2;

  let d = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      className="vqr"
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={`QR code linking to ${value}`}
      data-testid="qr"
      data-value={value}
    >
      <rect width={span} height={span} fill="var(--on-chrome)" />
      <path d={d} fill="var(--chrome)" shapeRendering="crispEdges" />
    </svg>
  );
}
