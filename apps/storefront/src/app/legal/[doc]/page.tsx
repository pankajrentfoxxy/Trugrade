/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The record is the document; its identity is its title, version and date; the
 * evidence is the text; and the side panel holds the contents and the other nine
 * documents rather than actions, because a legal page has no primary action and
 * inventing one would break the single-amber-control rule for nothing.
 *
 * The shell is the supplied legal-page design (`grievance.html`): cream ground,
 * the one yellow, flat — sections separated by rules, no card shells — a mono
 * kicker pill, the version and date as a meta strip, and a sticky contents rail
 * with scrollspy. Its palette is the `--cream-*` block in globals.css, scoped to
 * `.lgbody` in storefront.css; the site header and footer keep their own chrome.
 * All ten documents share it, so a reader moving between them never changes
 * page language.
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
import { LEGAL_SLUGS, buildDocuments, type LegalDocument } from '../documents';
import { Toc } from '../Toc';

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

/** The ISO date the document carries, as the meta strip prints it. */
function formatUpdated(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
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
    <div className="lgbody">
      {/*
        Not `.wrap`. That container is 1400px, which is right for a data board
        and wrong for prose: a legal document set across it is 100 characters a
        line and nobody finishes it. The design's 1160px puts the article at
        roughly 66 characters with the contents rail beside it.
      */}
      <div className="lg-wrap">
        <nav aria-label="Breadcrumb" className="lg-crumb">
          <Link href="/legal">Legal</Link>
          <span aria-hidden>&rsaquo;</span>
          <span>{doc.title}</span>
        </nav>

        {/* Identity header — what this document is, which version, and as of when. */}
        <span className="lg-kicker tnum">Legal &middot; {doc.kicker ?? doc.title}</span>
        <h1 className="lg-h1">{doc.title}</h1>
        <p className="lg-lede">{doc.summary}</p>

        <dl className="lg-meta">
          <div>
            <dt>Version</dt>
            <dd className="tnum">{doc.version}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd className="tnum">{formatUpdated(doc.updated)}</dd>
          </div>
          <div>
            <dt>Issued by</dt>
            <dd>{LEGAL_DISCLOSURE.legalName}</dd>
          </div>
        </dl>
        {doc.reconsentOnChange ? (
          <p className="lg-note lg-reconsent">
            This is one of three documents whose changes we intend to put in front of existing
            customers to accept at their next sign-in. That mechanism is not running yet. Until it
            is, the version and date above are how you can tell whether this is the document you
            read last time.
          </p>
        ) : null}

        <div className="lg-cols">
          <main className="lg-doc">
            {doc.sections.map((section, i) => (
              <section key={section.id} id={section.id}>
                <h2>
                  <span className="lg-no tnum" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {section.heading}
                  {/* The anchor. A clause somebody needs to cite must have a URL. */}
                  <a
                    href={`#${section.id}`}
                    aria-label={`Link to “${section.heading}”`}
                    className="lg-anchor"
                  >
                    #
                  </a>
                </h2>
                {section.body}
              </section>
            ))}
          </main>

          {/* Contents, and the other nine. Sticky, so a long document keeps them. */}
          <aside className="lg-side" aria-labelledby="lg-nav">
            <h3 id="lg-nav">On this page</h3>
            <Toc sections={doc.sections} />

            <h3>Other documents</h3>
            <ul className="lg-docs">
              {others.map((other) => (
                <li key={other.slug}>
                  <Link href={`/legal/${other.slug}`}>{other.title}</Link>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}
