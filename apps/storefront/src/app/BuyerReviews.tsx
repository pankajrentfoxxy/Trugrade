'use client';

import * as React from 'react';

/**
 * Buyer reviews — a masonry wall, reproduced from the supplied design the
 * same way as `WhyTrugrade.tsx` beside it on this page: its own scoped
 * font and colours under `.rv-scope`, a `rv-` prefix on every class so
 * nothing here can collide with the storefront's OWN `.rev`/`.rev-*`
 * classes (`laptops/[slug]/ReviewsSection.tsx`, the per-product review
 * rail), and a white card surface to match `WhyTrugrade`'s poster beside it
 * rather than the supplied cream.
 *
 * **PLACEHOLDER CONTENT — frontend only, not wired to any database.** Every
 * name, quote, and the 4.8 / 1,284 aggregate below are the supplied design's
 * own sample data, not a read of `platform.buyer_review` — the same
 * placeholder status `laptops/[slug]/product-rating.tsx` already carries for
 * the per-product review rail, and the same notice. When a real aggregate
 * exists, this file's contents come from it instead and this notice comes
 * out. Worth flagging plainly: unlike that file's placeholders (first name +
 * last initial), the supplied copy here names full people at named
 * companies with specific order sizes — kept as given, since that is the
 * content asked for, but a real testimonial should be a real buyer's words,
 * not a stand-in with a full name.
 *
 * A masonry wall rather than the rail the product page uses: pure CSS
 * multi-column (`columns:`), no JS layout library, matching the supplied
 * file exactly. The "View all" pill and its toast are the one piece of
 * interactivity, hence `'use client'`.
 */

interface Review {
  name: string;
  role: string;
  stars: number;
  text: React.ReactNode;
  verified?: boolean;
}

const REVIEWS: readonly Review[] = [
  {
    name: 'Rohit Malhotra',
    role: 'IT Head · logistics, Gurugram',
    stars: 5,
    text: (
      <>
        Ordered <b>40 Latitude 5420s</b> across two offices. Every serial on the GST invoice
        matched the machines that arrived, the seals were intact, and the two units our team
        flagged in the 48-hour window were replaced without an argument. This is how B2B should
        work.
      </>
    ),
    verified: true,
  },
  {
    name: 'Priya Nair',
    role: 'Founder · edtech',
    stars: 5,
    text: 'Exactly as graded.',
    verified: true,
  },
  {
    name: 'Amit Deshmukh',
    role: 'Procurement · manufacturing, Pune',
    stars: 5,
    text: (
      <>
        We buy Grade B deliberately for shop-floor terminals. The scuffs are honestly
        photographed and the <b>battery bands are accurate</b> — no surprises across 22 machines.
      </>
    ),
    verified: true,
  },
  {
    name: 'Kavitha R',
    role: 'Operations · CA firm',
    stars: 5,
    text: 'Clean paperwork. GST credit flowed without a single follow-up.',
    verified: true,
  },
  {
    name: 'Shubham Katiyar',
    role: 'Admin · fintech startup',
    stars: 5,
    text: (
      <>
        First order was 6 machines for a new pod. One failed our own IT check — used the reject
        window, replacement reached in <b>3 days</b>. Kept us on schedule for onboarding.
      </>
    ),
    verified: true,
  },
  {
    name: 'Farhan Sheikh',
    role: 'IT admin',
    stars: 5,
    text: 'Excellent service, sealed units, fast dispatch.',
  },
  {
    name: 'Meena Iyer',
    role: 'Finance controller',
    stars: 4,
    text: 'Machines were exactly per certificate. Dispatch took a day longer than quoted — the only reason for a star less. Would order again.',
    verified: true,
  },
  {
    name: 'Vikram Singh',
    role: 'Co-founder · BPO, Noida',
    stars: 5,
    text: (
      <>
        Verified the certificate IDs online before paying — the reports matched what landed, down
        to battery health. That transparency is why the next <b>60 seats</b> are also coming from
        here.
      </>
    ),
    verified: true,
  },
  { name: 'Deepak', role: 'Purchase officer', stars: 5, text: 'Good.' },
  {
    name: 'Ananya Bose',
    role: 'HR Ops · Kolkata',
    stars: 5,
    text: 'Smooth from quote to delivery. The order room showed sealed photos before dispatch — nice touch.',
    verified: true,
  },
  {
    name: 'Suresh Pillai',
    role: 'IT Manager',
    stars: 5,
    text: '48-hour window is real. We tested every unit; all 12 passed.',
  },
  {
    name: 'Neha Gupta',
    role: 'Founder · design studio',
    stars: 5,
    text: 'Best refurb buying experience so far.',
  },
];

const TOTAL_RATED = '1,284';
const AVERAGE = '4.8';

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function Star({ full }: { full: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={full ? 'rv-full' : 'rv-dim'}>
      <path d="M12 2.6 14.9 8.7l6.6.8-4.9 4.6 1.3 6.5L12 17.4l-5.9 3.2 1.3-6.5L2.5 9.5l6.6-.8L12 2.6z" />
    </svg>
  );
}

function Stars({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="rv-stars" role="img" aria-label={`${count} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} full={i <= count} />
      ))}
    </span>
  );
}

function VerifiedChip(): React.JSX.Element {
  return (
    <span className="rv-vchip">
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.2 5 5.8v5.1c0 4.4 3 8.1 7 9.9 4-1.8 7-5.5 7-9.9V5.8L12 3.2Z" />
        <path d="m9 11.6 2.1 2.1 4.2-4.2" />
      </svg>
      VERIFIED ORDER
    </span>
  );
}

export function BuyerReviews(): React.JSX.Element {
  const [toast, setToast] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onViewAll = (): void => {
    setToast(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setToast(false), 2200);
  };

  React.useEffect(() => () => clearTimeout(timeoutRef.current), []);

  return (
    <div className="rv-scope">
      {/* Scoped to this section only, same as `WhyTrugrade` beside it. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />

      <div className="rv-wrap">
        <div className="rv-head">
          <h2>
            Rated by <span>businesses, on real orders.</span>
          </h2>
          <div className="rv-agg">
            <span className="rv-n">{AVERAGE}</span>
            <span>
              <Stars count={5} />
              <small>
                <b>{TOTAL_RATED}</b> rated orders &middot; every review
                <br />
                tied to a delivered serial
              </small>
            </span>
          </div>
        </div>

        <div className="rv-wall-clip">
          <div className="rv-wall">
            {REVIEWS.map((r) => (
              <article className="rv-card" key={r.name}>
                <div className="rv-card-top">
                  <span className="rv-avx" aria-hidden="true">
                    {initials(r.name)}
                  </span>
                  <span>
                    <b>{r.name}</b>
                    {r.role ? <small>{r.role}</small> : null}
                  </span>
                </div>
                <div className="rv-card-rate">
                  <span className="rv-v">{r.stars}.0</span>
                  <Stars count={r.stars} />
                </div>
                <p>{r.text}</p>
                {r.verified ? <VerifiedChip /> : null}
              </article>
            ))}
          </div>
          <button type="button" className="rv-view-all" onClick={onViewAll}>
            View all {TOTAL_RATED} reviews
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="rv-toast" role="status" aria-live="polite" data-show={toast ? 'true' : 'false'}>
        Opening all <b>{TOTAL_RATED} reviews</b> &hellip; (demo)
      </div>

      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.rv-scope{
  --rv-bg:#ffffff;
  --rv-surface:#ffffff;
  --rv-line:rgba(58,44,8,.14);
  --rv-line-soft:rgba(58,44,8,.08);
  --rv-text:#2a2105;
  --rv-muted:#86754c;
  --rv-accent:#fdb017;
  --rv-accent-ink:#2a2105;
  --rv-accent-soft:rgba(253,176,23,.16);
  --rv-accent-deep:#b07a00;
  --rv-mono:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;
  background:var(--rv-bg);
  color:var(--rv-text);
  font-family:"Archivo","Segoe UI",system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;
  padding:clamp(40px,7vh,80px) clamp(16px,4vw,56px);
  position:relative;
}
.rv-scope *{box-sizing:border-box}
.rv-scope button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}

.rv-wrap{max-width:1280px;margin:0 auto}

.rv-head{display:flex;align-items:flex-end;flex-wrap:wrap;gap:18px}
.rv-head h2{
  font-size:clamp(1.5rem,2.8vw,2.1rem);font-weight:800;letter-spacing:-.015em;line-height:1.12;margin:0;
  /* Explicit, not inherited — see the identical note in WhyTrugrade's CSS:
     Tailwind's base layer sets its own colour on every h1-h6. */
  color:var(--rv-text);
}
.rv-head h2 span{color:var(--rv-accent-deep)}
.rv-agg{margin-left:auto;display:flex;align-items:center;gap:12px}
.rv-n{font-family:var(--rv-mono);font-size:1.7rem;font-weight:700;color:var(--rv-accent-deep)}
.rv-agg small{font-size:.78rem;color:var(--rv-muted);font-weight:600;line-height:1.45}
.rv-agg small b{color:var(--rv-text)}

.rv-stars{display:inline-flex;gap:2px}
.rv-stars svg{width:16px;height:16px}
.rv-full{fill:var(--rv-accent);stroke:var(--rv-accent-deep);stroke-width:1}
.rv-dim{fill:rgba(58,44,8,.12);stroke:rgba(58,44,8,.25);stroke-width:1}

.rv-wall-clip{position:relative;margin-top:28px;max-height:640px;overflow:hidden}
.rv-wall{columns:3 300px;column-gap:18px}
.rv-card{
  break-inside:avoid;background:var(--rv-surface);border:1px solid var(--rv-line);border-radius:16px;
  padding:18px 19px;margin-bottom:18px;
  transition:transform .25s ease,box-shadow .25s ease,border-color .25s ease;
}
.rv-card:hover{transform:translateY(-3px);border-color:rgba(253,176,23,.55);box-shadow:0 14px 32px rgba(58,44,8,.12)}
.rv-card-top{display:flex;align-items:center;gap:11px}
.rv-avx{
  flex:none;width:38px;height:38px;border-radius:50%;background:var(--rv-accent-soft);
  border:1.5px solid var(--rv-accent);color:var(--rv-accent-deep);font-size:.76rem;font-weight:800;
  display:flex;align-items:center;justify-content:center;
}
.rv-card-top b{display:block;font-size:.94rem;font-weight:800}
.rv-card-top small{display:block;font-size:.72rem;color:var(--rv-muted);font-weight:600;margin-top:1px}
.rv-card-rate{display:flex;align-items:center;gap:8px;margin-top:11px}
.rv-v{font-family:var(--rv-mono);font-size:.92rem;font-weight:700}
.rv-card-rate .rv-stars svg{width:14px;height:14px}
.rv-card p{font-size:.86rem;line-height:1.65;color:var(--rv-muted);margin-top:10px}
.rv-card p b{color:var(--rv-text);font-weight:700}
.rv-vchip{
  display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-family:var(--rv-mono);
  font-size:.58rem;font-weight:700;letter-spacing:.1em;color:var(--rv-accent-deep);
  background:var(--rv-accent-soft);border-radius:6px;padding:4px 8px;
}
.rv-vchip svg{width:11px;height:11px;stroke:var(--rv-accent-deep)}

.rv-wall-clip::after{
  content:"";position:absolute;left:0;right:0;bottom:0;height:170px;
  background:linear-gradient(rgba(255,255,255,0),var(--rv-bg) 78%);
  pointer-events:none;
}
.rv-view-all{
  position:absolute;left:50%;bottom:26px;translate:-50% 0;z-index:2;
  display:inline-flex;align-items:center;gap:9px;background:var(--rv-surface);
  border:1.5px solid var(--rv-accent);color:var(--rv-accent-deep);font-weight:800;font-size:.92rem;
  border-radius:999px;padding:14px 28px;box-shadow:0 12px 30px rgba(58,44,8,.14);
  transition:transform .2s ease,box-shadow .2s ease,background-color .2s ease;
}
.rv-view-all:hover{
  transform:translate(-50%,-2px) scale(1.02);translate:none;
  background:var(--rv-accent);color:var(--rv-accent-ink);box-shadow:0 14px 34px rgba(253,176,23,.4);
}
.rv-view-all svg{width:15px;height:15px;stroke:currentColor}

.rv-toast{
  position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);
  background:var(--rv-accent-ink);color:#fff;font-size:.85rem;font-weight:600;
  padding:12px 20px;border-radius:12px;opacity:0;pointer-events:none;
  transition:opacity .3s ease,transform .3s ease;z-index:60;
}
.rv-toast[data-show='true']{opacity:1;transform:translateX(-50%) translateY(0)}
.rv-toast b{color:var(--rv-accent)}

@media (max-width:640px){
  .rv-agg{margin-left:0}
  .rv-wall-clip{max-height:560px}
}
@media (prefers-reduced-motion: reduce){
  .rv-scope *{animation:none !important;transition:none !important}
}
`;
