/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The record is the document; its identity is its title, version and date; the
 * evidence is the text; and the side panel holds the contents and the other nine
 * documents rather than actions, because a legal page has no primary action and
 * inventing one would break the single-amber-control rule for nothing.
 *
 * ---------------------------------------------------------------------------
 * RENDERING
 * ---------------------------------------------------------------------------
 * ISR, per `03_UX_SPEC.md` line 630: `/legal/**` is SSR/ISR for SEO, on the same
 * side of that line as `/` and `/laptops/**` and deliberately not on the
 * dynamic, `noindex`, session-guarded side with `/account/**`. `generateStaticParams`
 * enumerates the ten slugs so each is a static page with a five-minute
 * revalidation, which is also the `max-age` on the two endpoints the numbers
 * come from.
 *
 * ---------------------------------------------------------------------------
 * VERSIONING — WHAT LINE 727 ASKS FOR AND WHAT IS BUILT
 * ---------------------------------------------------------------------------
 * Line 727: each page carries a version number and a last-updated date, and
 * changes to `/legal/grading`, `/legal/returns-and-refunds` and `/legal/terms`
 * are versioned in `platform.config` and re-consented at next login.
 *
 * **The version number and the date are built. The re-consent is not**, and
 * neither is a `platform_config` key holding a version.
 *
 * The version lives beside the prose in `documents.tsx` rather than in config,
 * and that is a deliberate choice rather than a shortcut. A version is a fact
 * about a document: a row in `platform_config` cannot know that a paragraph
 * changed, so a config-held version is a number somebody must remember to bump
 * in a second place, and the first time they forget, the published document
 * claims a version it is not. Keeping the two in one edit is the only
 * arrangement in which they cannot come apart.
 *
 * What config *would* legitimately hold is the version each user last accepted,
 * which is a different fact and needs the thing that is missing: a re-consent
 * gate at sign-in, a per-user record of what was accepted, and a screen. None of
 * that exists, so no key was added — `platform_config` has two writers that have
 * already diverged, and adding an unread key to widen that split in order to
 * imply a mechanism that does not run would be the worst of both.
 *
 * The three documents line 727 names are flagged `reconsentOnChange` and say
 * plainly, in their own text, that we will ask and do not yet. Nothing on the
 * page implies a re-consent happens.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { getGrades, getLegalTerms } from '../../../lib/api';
import { CategoryStrip } from '../../CategoryStrip';
import { LEGAL_SLUGS, buildDocuments, type LegalDocument } from '../documents';

export const revalidate = 300;

export function generateStaticParams(): Array<{ doc: string }> {
  return LEGAL_SLUGS.map((doc) => ({ doc }));
}

/**
 * All ten, built once against the live values, plus the one being viewed.
 *
 * The other nine come back too because the side rail lists them, and building
 * the set twice would mean two reads of the config and the grade rows for one
 * page — and, worse, a rail that could disagree with the document beside it.
 */
async function load(
  slug: string,
): Promise<{ doc: LegalDocument | null; all: readonly LegalDocument[] }> {
  const [terms, grades] = await Promise.all([getLegalTerms(), getGrades()]);
  const all = buildDocuments(terms, grades);
  return { doc: all.find((d) => d.slug === slug) ?? null, all };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const { doc: slug } = await params;
  const { doc } = await load(slug);
  if (!doc) return { title: 'Not found' };
  return {
    title: doc.title,
    description: doc.summary,
    alternates: { canonical: `/legal/${doc.slug}` },
  };
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<React.JSX.Element> {
  const { doc: slug } = await params;
  const { doc, all } = await load(slug);
  if (!doc) notFound();

  const others = all.filter((d) => d.slug !== doc.slug);

  return (
    <>
      <CategoryStrip />
      {/*
        Not `.wrap`. That container is 1400px, which is right for a data board
        and wrong for prose: a legal document set across it is 100 characters a
        line and nobody finishes it. 920px puts the article at roughly 74
        characters with the contents rail beside it and no void between them.
      */}
      <main className="mx-auto max-w-[920px] px-5 py-7">
        <nav aria-label="Breadcrumb" className="mb-5 text-body-sm text-ink-3">
          <Link href="/legal" className="hover:text-ink hover:underline hover:underline-offset-4">
            Legal
          </Link>
          <span aria-hidden className="px-2 text-ink-4">
            /
          </span>
          <span className="text-ink-2">{doc.title}</span>
        </nav>

        {/* Identity header — what this document is, which version, and as of when. */}
        <header className="border-b border-rule pb-6">
          <h1 className="text-h1 text-ink">{doc.title}</h1>
          <p className="mt-3 text-body-lg text-ink-2">{doc.summary}</p>
          <dl className="mt-5 flex flex-wrap gap-x-7 gap-y-3">
            <div>
              <dt className="text-label uppercase text-ink-4">Version</dt>
              <dd className="tnum mt-1 text-body text-ink">{doc.version}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-4">Last updated</dt>
              <dd className="tnum mt-1 text-body text-ink">{doc.updated}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-4">Issued by</dt>
              <dd className="mt-1 text-body text-ink-2">{LEGAL_DISCLOSURE.legalName}</dd>
            </div>
          </dl>
          {doc.reconsentOnChange ? (
            <p className="mt-5 border-l-2 border-rule pl-4 text-body-sm text-ink-3">
              This is one of three documents whose changes we intend to put in front of existing
              customers to accept at their next sign-in. That mechanism is not running yet. Until it
              is, the version and date above are how you can tell whether this is the document you
              read last time.
            </p>
          ) : null}
        </header>

        <div className="mt-6 grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_212px]">
          {/*
            The measure is the grid column, not a `max-w` on the article: the
            container above is sized so that this column lands at roughly 74
            characters with the rail beside it. Constraining both would leave a
            band of nothing between the prose and its own contents list.
          */}
          <article>
            {doc.sections.map((section, i) => (
              <section
                key={section.id}
                id={section.id}
                className={i === 0 ? 'scroll-mt-6' : 'mt-8 scroll-mt-6'}
              >
                <h2 className="group text-h2 text-ink">
                  {section.heading}
                  {/* The anchor. A clause somebody needs to cite must have a URL. */}
                  <a
                    href={`#${section.id}`}
                    aria-label={`Link to “${section.heading}”`}
                    className="ml-2 text-ink-4 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    #
                  </a>
                </h2>
                <div className="mt-3">{section.body}</div>
              </section>
            ))}
          </article>

          {/* Contents, and the other nine. Sticky, so a long document keeps them. */}
          <aside aria-labelledby="legal-nav" className="lg:sticky lg:top-5 lg:self-start">
            <h2 id="legal-nav" className="text-label uppercase text-ink-4">
              On this page
            </h2>
            <ul className="mt-3 flex flex-col gap-2 border-l border-rule">
              {doc.sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="-ml-px block border-l border-transparent pl-3 text-body-sm text-ink-3 hover:border-acc hover:text-ink"
                  >
                    {section.heading}
                  </a>
                </li>
              ))}
            </ul>

            <h2 className="mt-6 text-label uppercase text-ink-4">Other documents</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {others.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/legal/${other.slug}`}
                    className="block text-body-sm text-ink-3 hover:text-ink hover:underline hover:underline-offset-4"
                  >
                    {other.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
    </>
  );
}
