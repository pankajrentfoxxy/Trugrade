/**
 * The hero machine, drawn in three-quarter view.
 *
 * WHY THIS IS VECTOR AND NOT A PHOTOGRAPH
 * ---------------------------------------
 * There is no product photography in this system — the search API carries no
 * image field and the condition-image store holds nothing yet — and licensed
 * stock photography is not something this repo can source. A stock render of a
 * machine we do not sell, sitting over a claim about our inspection process,
 * would also be the same class of untruth as a fabricated counter.
 *
 * So this is a generic machine that claims to be no particular model, built
 * from the system's own tokens so it flips with the theme, and shaded with
 * gradients rather than flat fills so it reads as an object rather than a
 * wireframe. It is ~4KB and stays sharp at any size.
 *
 * Replace it the moment real photography exists: the hero reserves the same box.
 */
export function LaptopArt({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 640 420"
      fill="none"
      role="img"
      aria-label="A laptop open on an inspection bench"
    >
      <defs>
        <linearGradient id="la-lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--la-hi)" />
          <stop offset="100%" stopColor="var(--la-lo)" />
        </linearGradient>
        <linearGradient id="la-deck" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="var(--la-lo)" />
          <stop offset="100%" stopColor="var(--la-hi)" />
        </linearGradient>
        <linearGradient id="la-glass" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="var(--la-glass-a)" />
          <stop offset="100%" stopColor="var(--la-glass-b)" />
        </linearGradient>
        <radialGradient id="la-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="la-clip">
          <path d="M196 74 L512 60 L512 250 L196 262 Z" />
        </clipPath>
      </defs>

      {/* Accent bloom behind the machine — the only decorative use of the
          accent on the page, and it is a glow, not a label. */}
      <ellipse cx="350" cy="220" rx="250" ry="150" fill="url(#la-glow)" />

      {/* Lid, in three-quarter perspective */}
      <path d="M186 68 L520 52 L520 256 L186 270 Z" fill="url(#la-lid)" className="la-edge" />
      <path d="M196 74 L512 60 L512 250 L196 262 Z" fill="url(#la-glass)" />

      <g clipPath="url(#la-clip)">
        {/* The readout: four measurement bands and one measured value. */}
        <path d="M222 106 L392 98 L392 112 L222 120 Z" className="la-bar" />
        <path d="M222 136 L340 129 L340 143 L222 150 Z" className="la-bar la-bar-2" />
        <path d="M222 166 L424 157 L424 171 L222 180 Z" className="la-bar la-bar-3" />
        <path d="M222 196 L310 189 L310 203 L222 210 Z" className="la-bar la-bar-4" />
        <path d="M410 190 L484 185 L484 205 L410 210 Z" className="la-chip" />
        <path d="M196 74 L204 73.6 L204 262 L196 262 Z" className="la-sweep" />
      </g>

      {/* Deck */}
      <path
        d="M186 270 L520 256 L612 318 Q618 322 610 326 L212 348 Q202 350 196 344 Z"
        fill="url(#la-deck)"
        className="la-edge"
      />
      <path d="M338 288 L432 284 L440 296 L342 300 Z" className="la-pad" />
    </svg>
  );
}
