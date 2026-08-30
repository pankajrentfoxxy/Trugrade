/**
 * ARCHETYPE B — Board. The ten documents, as a list you can scan and link into.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Rendering: ISR. `03_UX_SPEC.md` line 630 puts `/legal/**` on the SSR/ISR side
 * with `/` and `/laptops/**`, not on the dynamic, `noindex` side with
 * `/account/**` — these pages are indexed, and they are what a buyer's counsel
 * reads before the buyer signs anything.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { getGrades, getLegalTerms } from '../../lib/api';
import { CategoryStrip } from '../CategoryStrip';
import { buildDocuments } from './documents';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Legal',
  description: `The terms, policies and published standards that govern buying from ${LEGAL_DISCLOSURE.legalName}.`,
};

export default async function LegalIndexPage(): Promise<React.JSX.Element> {
  // Built with the live values so the index can say which documents carry a
  // number that came from configuration — and so a broken read shows up here
  // rather than only on the page that needed it.
  const [terms, grades] = await Promise.all([getLegalTerms(), getGrades()]);
  const documents = buildDocuments(terms, grades);

  return (
    <>
      <CategoryStrip />
      {/* Same reading container as the documents themselves — see `[doc]/page.tsx`. */}
      <main className="mx-auto max-w-[920px] px-5 py-7">
        <header className="border-b border-rule pb-6">
          <p className="text-label uppercase text-ink-3">Legal</p>
          <h1 className="mt-2 text-h1 text-ink">
            The documents that govern buying from {BRAND.name}
          </h1>
          <p className="mt-4 max-w-[74ch] text-body-lg text-ink-2">
            Ten documents. Each carries a version number and the date it was last changed, and every
            figure in them — an inspection window, a warranty term, a grade threshold — is read from
            the system that enforces it rather than typed into the page. Where we have not yet
            decided something, the document says so and leaves the field visibly empty.
          </p>
        </header>

        <ol className="mt-6 flex flex-col">
          {documents.map((doc) => (
            <li key={doc.slug}>
              <Link
                href={`/legal/${doc.slug}`}
                className="group flex flex-col gap-2 border-b border-rule-2 py-5 focus-visible:focus-ring sm:flex-row sm:items-baseline sm:gap-6"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="text-h3 text-ink group-hover:underline group-hover:decoration-acc group-hover:underline-offset-4">
                    {doc.title}
                  </h2>
                  <p className="mt-1 max-w-[76ch] text-body-sm text-ink-2">{doc.summary}</p>
                </div>
                <p className="shrink-0 text-body-sm">
                  <span className="tnum text-ink-2">{doc.version}</span>
                  <span className="text-ink-4"> · updated </span>
                  <span className="tnum text-ink-2">{doc.updated}</span>
                </p>
              </Link>
            </li>
          ))}
        </ol>

        {/*
          Rule 4(2) again, in full, on the page a reader arrives at when they are
          looking for exactly this. The footer carries it on every page; here it
          is the subject rather than the small print.
        */}
        <section className="mt-7 rounded-lg border border-rule bg-sheet p-6">
          <h2 className="text-h3 text-ink">Who we are</h2>
          <dl className="mt-4 grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
            <dt className="text-body-sm text-ink-3">Legal name</dt>
            <dd className="text-body text-ink-2">{LEGAL_DISCLOSURE.legalName}</dd>
            <dt className="text-body-sm text-ink-3">Brand</dt>
            <dd className="text-body text-ink-2">
              {BRAND.name} · {LEGAL_DISCLOSURE.website}
            </dd>
            <dt className="text-body-sm text-ink-3">GSTIN</dt>
            <dd className="tnum text-body text-ink">{LEGAL_DISCLOSURE.gstin}</dd>
            <dt className="text-body-sm text-ink-3">Grievance officer</dt>
            <dd className="text-body text-ink-2">
              <Link
                href="/legal/grievance"
                className="text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
              >
                Named contact and response times
              </Link>
            </dd>
          </dl>
        </section>
      </main>
    </>
  );
}
