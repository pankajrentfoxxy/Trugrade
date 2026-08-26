import { BRAND } from '@trugrade/config/brand';
import { Button, Evidence, Logo, ToleranceBand } from '@trugrade/ui';

/**
 * The proof-first home page.
 *
 * Every number carries its denominator, because a headline percentage with no
 * sample size behind it is the exact claim the CP e-Comm rules make us
 * answerable for. The `Evidence` component makes that structural rather than a
 * habit somebody has to remember.
 */
export default function HomePage(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-container px-5 py-9">
      <Logo />

      <h1 className="mt-7 max-w-3xl text-display-1 text-ink">
        Every machine measured, not described.
      </h1>
      <p className="mt-5 max-w-xl text-body-lg text-ink-2">
        {BRAND.name} inspects each laptop with {BRAND.qcProduct} before it is listed, seals it, and
        publishes what the tests actually found — including what they did not measure.
      </p>

      <div className="mt-7 flex flex-wrap gap-3">
        <Button variant="primary" size="lg">
          Browse inspected stock
        </Button>
        <Button variant="secondary" size="lg">
          How we grade
        </Button>
      </div>

      <section className="mt-9 grid gap-7 sm:grid-cols-3">
        <Evidence value={98} pct denominator={412} denominatorLabel="units inspected" />
        <Evidence value={94} pct denominator={1204} denominatorLabel="delivered on promise" />
        <Evidence value={2} pct denominator={412} denominatorLabel="returned" />
      </section>

      <section className="mt-9 max-w-lg">
        <h2 className="text-h2 text-ink">What a grade actually means</h2>
        <p className="mt-3 text-body text-ink-2">
          A grade is a band, not an adjective. Here is a Grade A machine against the band it has to
          sit inside.
        </p>
        <div className="mt-6 flex flex-col gap-8">
          <ToleranceBand
            label="Battery · Grade A band"
            bandMin={75}
            bandMax={100}
            declared={90}
            found={91}
            foundLabel="Found 91%"
          />
          {/* The third state, on the marketing page on purpose: a value we did
              not measure is shown as not measured, not quietly omitted. */}
          <ToleranceBand label="Thermals" bandMin={0} bandMax={100} foundLabel="Not measured" />
        </div>
      </section>
    </main>
  );
}
