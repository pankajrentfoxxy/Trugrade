/**
 * "Why Trugrade" — the comparison table + bulk-order poster, reproduced
 * exactly from the supplied design (colours, type, layout, animation).
 *
 * Homepage only, between the spec showcase and the "verify a certificate"
 * strip. Per the explicit direction to match the supplied file exactly, this
 * is scoped rather than merged into the shared stylesheet: its own font
 * (Archivo, loaded here) and its own literal colours live inside `.wt-scope`,
 * a wrapper class every selector below is namespaced under. That keeps the
 * rest of the storefront — Lato, the token palette in `globals.css` — exactly
 * as it was; nothing here reaches outside this one section.
 *
 * The five rows and the poster's copy are the supplied content, unchanged.
 */

const ROWS: ReadonlyArray<{
  feature: string;
  detail?: string;
  new: boolean;
  grey: boolean;
}> = [
  { feature: 'Save 40–65% on price', new: false, grey: true },
  {
    feature: '12-area inspection certificate',
    detail: 'per unit, verifiable online',
    new: false,
    grey: false,
  },
  { feature: 'One GST invoice, input credit yours', new: true, grey: false },
  {
    feature: 'Warranty + 48-hour reject window',
    detail: 'inspect on arrival, return no questions',
    new: true,
    grey: false,
  },
  {
    feature: 'Tamper-sealed & serial-tracked',
    detail: 'the machine on the certificate is the one in the box',
    new: false,
    grey: false,
  },
];

function NoMark(): React.JSX.Element {
  return (
    <span className="wt-mark wt-no">
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.1} strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6M15 9l-6 6" />
      </svg>
      <span className="wt-sr-only">Not included</span>
    </span>
  );
}

function YesMark(): React.JSX.Element {
  return (
    <span className="wt-mark wt-yes">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.4 2.4 4.6-4.8" />
      </svg>
      <span className="wt-sr-only">Included</span>
    </span>
  );
}

function StrongYesMark(): React.JSX.Element {
  return (
    <span className="wt-mark wt-yes wt-strong">
      <i>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </i>
      <span className="wt-sr-only">Included</span>
    </span>
  );
}

export function WhyTrugrade(): React.JSX.Element {
  return (
    <div className="wt-scope">
      {/* Scoped to this section only — the rest of the storefront stays on Lato. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />

      <div className="wt-wrap">
        <div>
          <h2 className="wt-h2">
            Here&rsquo;s why <span>Trugrade is the smarter buy</span> <i />
          </h2>

          <div className="wt-cmp">
            <div className="wt-crow wt-head">
              <span />
              <span className="wt-col-h">Buying new</span>
              <span className="wt-col-h">
                Grey-market
                <br />
                dealer
              </span>
              <span className="wt-col-h wt-tg">
                tru<b>grade</b>
                <small>BY GOREFURBO</small>
              </span>
            </div>

            {ROWS.map((row) => (
              <div className="wt-crow" key={row.feature}>
                <span className="wt-feat">
                  {row.feature}
                  {row.detail ? <small>{row.detail}</small> : null}
                </span>
                {row.new ? <YesMark /> : <NoMark />}
                {row.grey ? <YesMark /> : <NoMark />}
                <StrongYesMark />
              </div>
            ))}
          </div>

          <p className="wt-foot-line">
            <b>Every tick is checkable:</b> the certificate ID on your seal verifies online, the
            grade bands are published, and the invoice carries every serial &mdash; nothing rests
            on a dealer&rsquo;s word.
          </p>
        </div>

        <aside className="wt-poster">
          <span className="wt-p-logo">t</span>
          <h3>
            The Big <b>Fleet Upgrade</b>
          </h3>
          <p className="wt-sub">
            Bulk offers live &middot; <b>&#8377;500 off</b> per machine on orders of 10+
          </p>
          <div className="wt-ribbon">UP TO 24% OFF</div>

          <div className="wt-scene" aria-hidden="true">
            <div className="wt-bx wt-b1">
              <span className="wt-stamp">A</span>
            </div>
            <div className="wt-bx wt-b3" />
            <div className="wt-bx wt-b2">
              <span className="wt-stamp">A+</span>
            </div>

            <div className="wt-hero-lap">
              <div className="wt-scr">
                <i />
              </div>
              <div className="wt-base" />
            </div>
            <div className="wt-hero-bx">
              <span className="wt-inner" />
              <span className="wt-flapl" />
              <span className="wt-flapr" />
              <span className="wt-lbl">
                <b>DELL LATITUDE 5420</b>
                <small>SN 5CG1234XYZ</small>
              </span>
              <span className="wt-bars" />
            </div>

            <div className="wt-floor" />
          </div>

          <p className="wt-p-foot">
            GRADED &middot; SEALED &middot; DELIVERED ON <b>ONE INVOICE</b>
          </p>
        </aside>
      </div>

      <style>{CSS}</style>
    </div>
  );
}

/**
 * The supplied `<style>` block, verbatim in colour, spacing and animation —
 * every selector renamed under `.wt-scope`/`wt-*` so it cannot touch anything
 * outside this section (the source used bare names like `.wrap`, `.head` and
 * `.sub` that already mean something else elsewhere on this site).
 */
const CSS = `
.wt-scope{
  --wt-bg:#ffffff;
  --wt-surface:#ffffff;
  --wt-line:rgba(58,44,8,.14);
  --wt-line-soft:rgba(58,44,8,.08);
  --wt-text:#2a2105;
  --wt-muted:#86754c;
  --wt-accent:#fdb017;
  --wt-accent-ink:#2a2105;
  --wt-accent-soft:rgba(253,176,23,.16);
  --wt-accent-deep:#b07a00;
  --wt-ink:#171204;
  --wt-card-b:#e9d3a2;
  --wt-card-b2:#dcc088;
  --wt-card-edge:#bf9c58;
  --wt-mono:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;
  --wt-colw:118px;
  background:var(--wt-bg);
  color:var(--wt-text);
  font-family:"Archivo","Segoe UI",system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;
  padding:clamp(40px,7vh,80px) clamp(16px,4vw,56px);
}
.wt-scope *{box-sizing:border-box}
.wt-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0,0,0,0);white-space:nowrap;border:0}

.wt-wrap{
  max-width:1360px;margin:0 auto;
  display:grid;
  grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);
  gap:clamp(28px,4vw,64px);
  align-items:center;
}

.wt-h2{
  /* Explicit, not inherited: Tailwind's base layer sets its own color on every
     h1-h6 (\`:where(h1,h2,h3,h4,h5,h6){color:var(--ink)}\` in globals.css), and
     an element's own declared color always wins over inheritance from
     \`.wt-scope\` regardless of that rule's zero specificity. */
  color:var(--wt-text);
  font-size:clamp(1.5rem,2.8vw,2.1rem);
  font-weight:800;letter-spacing:-.015em;line-height:1.15;
  display:flex;align-items:center;flex-wrap:wrap;gap:14px;
  margin:0;
}
.wt-h2 span{color:var(--wt-accent-deep)}
.wt-h2 i{font-style:normal;flex:none;width:64px;height:4px;border-radius:999px;background:var(--wt-accent)}
.wt-cmp{position:relative;margin-top:34px}
.wt-cmp::before{
  content:"";position:absolute;top:-16px;bottom:-16px;right:0;width:var(--wt-colw);
  background:var(--wt-surface);border:1.5px solid rgba(253,176,23,.55);border-radius:16px;
  box-shadow:0 18px 44px rgba(58,44,8,.14);
}
.wt-crow{
  position:relative;display:grid;
  grid-template-columns:minmax(0,1fr) var(--wt-colw) var(--wt-colw) var(--wt-colw);
  align-items:center;
}
.wt-crow + .wt-crow{border-top:1px solid var(--wt-line-soft)}
.wt-crow.wt-head{border-top:none}
.wt-crow > *{padding:16px 8px}

.wt-crow.wt-head .wt-col-h{text-align:center;font-size:.86rem;font-weight:800;color:var(--wt-muted);padding-bottom:12px}
.wt-crow.wt-head .wt-col-h.wt-tg{color:var(--wt-text);font-size:1rem;font-weight:800}
.wt-crow.wt-head .wt-col-h.wt-tg b{color:var(--wt-accent-deep)}
.wt-crow.wt-head .wt-col-h.wt-tg small{
  display:block;font-family:var(--wt-mono);font-size:.54rem;font-weight:700;letter-spacing:.14em;
  color:var(--wt-muted);margin-top:2px;
}

.wt-feat{font-size:.95rem;font-weight:700;line-height:1.45;padding-right:18px}
.wt-feat small{display:block;font-weight:600;color:var(--wt-muted);font-size:.78rem}

.wt-mark{display:flex;align-items:center;justify-content:center}
.wt-mark svg{width:24px;height:24px}
.wt-no svg{stroke:rgba(58,44,8,.35)}
.wt-yes svg{stroke:var(--wt-accent-deep)}
.wt-yes.wt-strong svg{stroke:var(--wt-ink)}
.wt-yes.wt-strong i{
  display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;
  background:var(--wt-accent);box-shadow:0 5px 14px rgba(253,176,23,.4);
}
.wt-yes.wt-strong i svg{width:16px;height:16px}

.wt-foot-line{margin-top:26px;font-size:.82rem;color:var(--wt-muted);line-height:1.6;max-width:56ch}
.wt-foot-line b{color:var(--wt-text)}

.wt-poster{
  position:relative;background:var(--wt-surface);border:1.5px solid var(--wt-line);
  border-radius:22px;padding:30px 26px 0;overflow:hidden;
  color:var(--wt-text);min-height:560px;display:flex;flex-direction:column;
  box-shadow:0 24px 60px rgba(58,44,8,.16);
}
.wt-poster::before{
  content:"";position:absolute;inset:0;
  background-image:radial-gradient(rgba(58,44,8,.08) 1px,transparent 1px);
  background-size:26px 26px;
  -webkit-mask-image:radial-gradient(ellipse 100% 60% at 50% 0%,#000 25%,transparent 85%);
          mask-image:radial-gradient(ellipse 100% 60% at 50% 0%,#000 25%,transparent 85%);
}
.wt-p-logo{
  position:absolute;top:16px;right:16px;width:30px;height:30px;border-radius:8px;
  background:var(--wt-accent);color:var(--wt-accent-ink);font-weight:800;font-size:.9rem;
  display:flex;align-items:center;justify-content:center;
}
.wt-poster h3{position:relative;font-size:1.35rem;font-weight:600;text-align:center;color:var(--wt-muted);margin:0}
.wt-poster h3 b{display:block;font-size:2.1rem;font-weight:800;letter-spacing:-.015em;color:var(--wt-text)}
.wt-sub{position:relative;text-align:center;font-size:.78rem;color:var(--wt-muted);margin-top:8px}
.wt-sub b{color:var(--wt-accent-deep)}
.wt-ribbon{
  position:relative;align-self:center;margin-top:18px;background:var(--wt-accent);color:var(--wt-accent-ink);
  font-weight:800;font-size:1.05rem;letter-spacing:.04em;padding:12px 30px;
  clip-path:polygon(0 0,100% 6%,96% 100%,4% 94%);rotate:-3deg;
  animation:wtRibbonPulse 3.2s ease-in-out infinite;
}
@keyframes wtRibbonPulse{0%,100%{scale:1}50%{scale:1.05}}

.wt-scene{position:relative;flex:1;margin-top:14px}
.wt-bx{position:absolute;background:var(--wt-card-b);border:2px solid var(--wt-card-edge);border-radius:6px}
.wt-bx::after{
  content:"";position:absolute;top:0;bottom:0;left:50%;width:16px;translate:-50% 0;
  background:rgba(255,246,227,.5);border-left:1px solid rgba(58,44,8,.12);border-right:1px solid rgba(58,44,8,.12);
}
.wt-bx .wt-stamp{
  position:absolute;top:-11px;right:-9px;width:30px;height:27px;border-radius:8px;
  background:var(--wt-accent);color:var(--wt-accent-ink);font-weight:800;font-size:.7rem;
  display:flex;align-items:center;justify-content:center;rotate:7deg;box-shadow:0 5px 12px rgba(253,176,23,.45);
}
.wt-b1{left:6%;bottom:34px;width:86px;height:64px}
.wt-b2{right:4%;bottom:34px;width:74px;height:88px}
.wt-b3{right:26%;bottom:34px;width:56px;height:46px;rotate:-4deg}

.wt-hero-bx{
  position:absolute;left:50%;bottom:44px;translate:-50% 0;width:190px;height:118px;
  background:var(--wt-card-b);border:2px solid var(--wt-card-edge);border-radius:8px;
  animation:wtHeroFloat 4.5s ease-in-out infinite;z-index:2;
}
@keyframes wtHeroFloat{0%,100%{translate:-50% 0}50%{translate:-50% -7px}}
.wt-hero-bx .wt-inner{position:absolute;left:7px;right:7px;top:-7px;height:13px;background:#241c08;border-radius:5px 5px 0 0}
.wt-hero-bx .wt-flapl,.wt-hero-bx .wt-flapr{
  position:absolute;top:-46px;width:92px;height:44px;background:var(--wt-card-b2);border:2px solid var(--wt-card-edge);
}
.wt-hero-bx .wt-flapl{left:0;rotate:-16deg;transform-origin:bottom left;border-radius:8px 5px 0 0}
.wt-hero-bx .wt-flapr{right:0;rotate:16deg;transform-origin:bottom right;border-radius:5px 8px 0 0}
.wt-hero-lap{position:absolute;left:50%;bottom:104px;translate:-50% 0;width:126px;z-index:3;animation:wtHeroFloat 4.5s ease-in-out infinite}
.wt-hero-lap .wt-scr{height:74px;background:#241c08;border:2.5px solid #3b2f0c;border-radius:8px 8px 2px 2px;padding:6px}
.wt-hero-lap .wt-scr i{display:block;width:100%;height:100%;background:var(--wt-accent-soft);border-radius:3px;position:relative;overflow:hidden;font-style:normal}
.wt-hero-lap .wt-scr i::after{
  content:"A+";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-weight:800;font-size:1.15rem;color:var(--wt-accent-deep);
}
.wt-hero-lap .wt-base{height:8px;background:#3b2f0c;border-radius:1px 1px 6px 6px;margin:0 -8px}
.wt-hero-bx .wt-lbl{
  position:absolute;left:14px;bottom:12px;right:74px;background:#fffdf6;border:1px solid rgba(58,44,8,.2);
  border-radius:4px;padding:5px 7px;
}
.wt-hero-bx .wt-lbl b{display:block;font-family:var(--wt-mono);font-size:.5rem;font-weight:700;letter-spacing:.06em;color:var(--wt-text)}
.wt-hero-bx .wt-lbl small{font-family:var(--wt-mono);font-size:.44rem;color:var(--wt-muted)}
.wt-hero-bx .wt-bars{
  position:absolute;right:14px;bottom:12px;width:38px;height:26px;
  background-image:repeating-linear-gradient(90deg,#2a2105 0 1.5px,transparent 1.5px 4px);opacity:.7;
}
.wt-floor{position:absolute;left:-30px;right:-30px;bottom:0;height:36px;background:#241c08;border-radius:18px 18px 0 0}
.wt-p-foot{
  position:relative;text-align:center;font-family:var(--wt-mono);font-size:.6rem;font-weight:700;
  letter-spacing:.12em;color:var(--wt-muted);padding:12px 0 14px;margin:0;
}
.wt-p-foot b{color:var(--wt-accent-deep)}

@media (max-width:1060px){
  .wt-scope{--wt-colw:88px}
  .wt-wrap{grid-template-columns:1fr}
  .wt-poster{max-width:460px;margin:0 auto;width:100%}
}
@media (max-width:560px){
  .wt-scope{--wt-colw:64px}
  .wt-mark svg{width:20px;height:20px}
  .wt-yes.wt-strong i{width:26px;height:26px}
  .wt-feat{font-size:.84rem}
  .wt-crow.wt-head .wt-col-h{font-size:.7rem}
  .wt-crow.wt-head .wt-col-h.wt-tg{font-size:.82rem}
}
@media (prefers-reduced-motion: reduce){
  .wt-scope *{animation:none !important}
}
`;
