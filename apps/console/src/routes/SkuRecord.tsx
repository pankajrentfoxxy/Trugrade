import * as React from 'react';
import { Link, useParams } from 'react-router';
import { GRADES, type Grade } from '@trugrade/contracts';
import {
  Breadcrumb,
  EmptyState,
  GradeBadge,
  RecordHeader,
  RepresentativeImage,
  SidePanel,
  Skeleton,
  StatusPill,
  cn,
} from '@trugrade/ui';
import { Datum, NotMeasured, Section } from '../lib/controls';
import { useResource } from '../lib/useResource';
import { useUrlState } from '../lib/urlState';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * One SKU, and what a buyer is shown for each of its grades.
 *
 * `03_UX_SPEC.md` §3C.2 gives this route the specification, the images, the live
 * listings and the price band. Two of those four are reachable today and two are
 * not, and the screen says which is which rather than rendering an empty card:
 * `listing.listing` is another module's table with no by-SKU count on its barrel
 * (the catalog tree reads it with its own single-schema query and that count
 * stays there), and there is no `price_book` in the schema at all — see the
 * pricing screen for what does exist.
 *
 * **The image panel is the point of the screen.** The library is a liability
 * control: every photograph a buyer sees is representative of a grade, not of
 * the machine they will receive, and it has to say so. So the preview here runs
 * through the real resolver — `GET /catalog/skus/:id?grade=` is the same call
 * the product page makes — and renders through `RepresentativeImage`, the same
 * component, which bakes the caption in so no caller can drop it. A preview
 * built from a second query and a second layout is a preview of a page we do
 * not ship, and the thing it would be failing to preview is the sentence that
 * keeps a representative photograph from being a misrepresentation.
 */

interface ResolvedImage {
  id: string;
  grade: Grade;
  viewCode: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  url: string;
}

interface ResolvedImages {
  images: ResolvedImage[];
  /** Which level of the catalog the photographs actually came from. */
  match: 'SKU' | 'MODEL' | 'SERIES' | 'PLACEHOLDER';
  isGeneric: boolean;
  placeholderReason?: string;
}

interface SkuRecord {
  skuId: string;
  skuCode: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  cpuBrand: string;
  cpuFamily: string;
  cpuModel: string;
  cpuGeneration: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  gpuType: string;
  gpuModel: string | null;
  screenSizeIn: number;
  resolution: string;
  isTouch: boolean;
  osSupported: string;
  hsnCode: string;
  isActive: boolean;
  images: ResolvedImages | null;
}

const gradeLabel = (g: Grade): string => g.replace('_PLUS', '+');

/** A number, so mono and tabular. Every one of these is read against another row. */
function Num({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="font-mono text-data tnum text-ink">{children}</span>;
}

/**
 * What the resolver actually found, said before the photographs rather than
 * under them.
 *
 * A SERIES-anchored set is a photograph of a *different model*. That is legal
 * and it is what we do, but somebody deciding whether this SKU is ready to
 * publish has to see it as a sentence, not infer it from a caption they have
 * read four hundred times.
 */
function MatchNote({ resolved, grade }: { resolved: ResolvedImages; grade: Grade }): React.JSX.Element {
  const words: Record<ResolvedImages['match'], string> = {
    SKU: 'Photographed against this exact configuration.',
    MODEL: 'Photographed against this model, not this configuration — a buyer is shown another machine of the same model.',
    SERIES: 'Photographed against the range only — a buyer is shown a different model in the same family.',
    PLACEHOLDER: 'Nothing is catalogued for this grade. A buyer is shown a labelled placeholder, not a photograph.',
  };
  return (
    <p className="mt-3 max-w-prose text-body-sm text-ink-2">
      <Num>{resolved.images.length}</Num>{' '}
      {resolved.images.length === 1 ? 'frame' : 'frames'} for Grade {gradeLabel(grade)}.{' '}
      {words[resolved.match]}
      {resolved.placeholderReason ? ` ${resolved.placeholderReason}` : ''}
    </p>
  );
}

export function SkuRecordRoute(): React.JSX.Element {
  const { id } = useParams();
  // In the URL: "the Grade B gallery for this SKU" is a link an operator sends
  // to whoever is holding the camera, and it is the only state this record has.
  const [gradeParam, setGrade] = useUrlState('grade', 'B');
  const grade = (GRADES as readonly string[]).includes(gradeParam)
    ? (gradeParam as Grade)
    : 'B';

  const { data, error } = useResource<SkuRecord>(
    id ? `/api/catalog/skus/${id}?grade=${grade}` : '',
    'This SKU did not load',
  );

  if (error) {
    return (
      <EmptyState
        title="This SKU did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={10} />;

  const resolved = data.images;

  return (
    <div className="tg-stack">
      <Breadcrumb items={[{ label: 'Catalog', href: '/catalog' }, { label: data.skuCode }]} />

      <RecordHeader
        title={data.modelName}
        subtitle={`${data.brandName} · ${data.seriesName}`}
        // Deprecated is a state, not a verdict — neutral in both cases, and the
        // word carries the difference.
        status={
          <StatusPill tone="neutral" label={data.isActive ? 'In the catalog' : 'Deprecated'} />
        }
        identifiers={[
          { label: 'SKU code', value: data.skuCode },
          { label: 'HSN', value: data.hsnCode },
        ]}
      />

      <div className="grid [&>*]:min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <Section
            title="What a buyer sees"
            subtitle="The gallery on the product page for this configuration, at the grade selected — resolved by the same call the storefront makes."
          >
            <div
              role="group"
              aria-label="Grade"
              className="flex flex-wrap gap-2"
            >
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={g === grade}
                  onClick={() => setGrade(g)}
                  className={cn(
                    'flex min-h-11 items-center rounded border px-4 transition-colors',
                    // Amber as an active state — the third legitimate use of the
                    // accent, and the only one on this screen.
                    g === grade
                      ? 'border-acc bg-acc-wash'
                      : 'border-rule bg-sheet hover:bg-sheet-2',
                  )}
                >
                  <GradeBadge grade={g} />
                </button>
              ))}
            </div>

            {resolved === null ? (
              <p className="mt-4 text-body-sm text-ink-2">
                Choose a grade to see what is published for it.
              </p>
            ) : (
              <>
                <MatchNote resolved={resolved} grade={grade} />
                {resolved.images.length === 0 ? (
                  <div className="mt-4 max-w-sm">
                    {/* Not a grey box and not an empty grid: the component's own
                        placeholder says, in words, that we have not photographed
                        this grade — which is the honest reading of a missing
                        value, and the reading a grey box does not get. */}
                    <RepresentativeImage
                      grade={grade}
                      alt={`No photograph catalogued for Grade ${gradeLabel(grade)}`}
                      match="PLACEHOLDER"
                    />
                  </div>
                ) : (
                  <div className="mt-4 grid gap-6 sm:grid-cols-2">
                    {resolved.images.map((image) => (
                      <RepresentativeImage
                        key={image.id}
                        src={image.url}
                        alt={image.altText}
                        grade={image.grade}
                        match={resolved.match}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </Section>

          <Section
            title="Declared specification"
            subtitle="What the catalog says this machine is. A vendor lists against it and QC verifies against it, so a change here changes every listing's claim."
          >
            <div className="grid gap-x-7 sm:grid-cols-2">
              <Datum label="Processor">
                {data.cpuBrand} {data.cpuFamily} <Num>{data.cpuModel}</Num>
                {data.cpuGeneration ? <> · {data.cpuGeneration} generation</> : null}
              </Datum>
              <Datum label="Memory">
                <Num>{data.ramGb}</Num> GB
              </Datum>
              <Datum label="Storage">
                <Num>{data.storageGb}</Num> GB {data.storageType.replaceAll('_', ' ')}
              </Datum>
              <Datum label="Graphics">
                {data.gpuModel === null ? (
                  <NotMeasured
                    why="No GPU model is recorded on this SKU"
                    label={`${data.gpuType.replaceAll('_', ' ')} · model not recorded`}
                  />
                ) : (
                  <>
                    {data.gpuType.replaceAll('_', ' ')} · {data.gpuModel}
                  </>
                )}
              </Datum>
              <Datum label="Display">
                <Num>{data.screenSizeIn}</Num>&Prime; {data.resolution} ·{' '}
                {data.isTouch ? 'touch' : 'non-touch'}
              </Datum>
              <Datum label="Operating system">{data.osSupported}</Datum>
              <Datum label="HSN code">
                <Num>{data.hsnCode}</Num>
              </Datum>
              <Datum label="SKU code">
                <Num>{data.skuCode}</Num>
              </Datum>
            </div>
          </Section>
        </div>

        <SidePanel
          title="Changing this record"
          description="What can be edited, where, and what it costs."
          footnote="The SKU code is generated when the SKU is created and never changes. It is the key every listing, purchase order and invoice line quotes, so it cannot be corrected — a wrong one is deprecated and superseded."
        >
          {/* The two links here are `--ink`, not `--acc-ink`. T28's colour sweep
              dropped row-action links off the accent for the same reason: the
              screen's one amber control is the active grade tab, and navigation
              that reads as a primary action is navigation competing with it. */}
          <ul className="flex flex-col gap-4 text-body-sm text-ink-2">
            <li>
              <span className="block text-ink">Photographs</span>
              The library is edited per model, not per SKU — a shoot covers the whole model and
              falls back to it.{' '}
              <Link to="/catalog/condition-images" className="text-ink underline underline-offset-4">
                Open the coverage grid
              </Link>
              . It opens on {data.modelName} once you filter to it — the grid keys on the model id,
              which this response deliberately does not carry.
            </li>
            <li>
              <span className="block text-ink">Specification</span>
              There is no edit route in the console yet. A correction goes through a fresh CSV
              import, which matches on the normalised key and updates the row it finds.
            </li>
            <li>
              <span className="block text-ink">Live listings and price history</span>
              Not shown here. The listing count sits on the{' '}
              <Link to="/catalog" className="text-ink underline underline-offset-4">
                catalog tree
              </Link>
              , which is what blocks a deprecation, and price history is a listing-module screen.
            </li>
          </ul>
        </SidePanel>
      </div>
    </div>
  );
}
