/**
 * "Questions and answers" on the product page.
 *
 * **PLACEHOLDER CONTENT — frontend only, not wired to any database.** There is
 * no Q&A table or endpoint yet. This renders a fixed set of sample questions
 * so the layout can be built and reviewed ahead of that backend. When a real
 * endpoint exists, swap `SAMPLE_QA` for its response and delete this notice.
 */

export interface SampleQA {
  id: string;
  question: string;
  askedBy: string;
  answer: string;
  answeredOn: string;
}

/** Placeholder only — see file header. */
const SAMPLE_QA: SampleQA[] = [
  {
    id: 'q1',
    question: 'Does the price include GST, and will I get a proper tax invoice?',
    askedBy: 'Suresh K.',
    answer:
      'The price shown is before GST — tax and freight are added at checkout against your billing address. A GST invoice is generated automatically and emailed once the order is placed.',
    answeredOn: '2026-09-14',
  },
  {
    id: 'q2',
    question: 'What does Grade B actually mean for this laptop?',
    askedBy: 'Meera J.',
    answer:
      'Grade B means light cosmetic wear — small scuffs or scratches visible on close inspection — with no impact on function. Screen, keyboard, ports and battery are all tested and must pass the same checks as Grade A. It is a look grade, not a performance grade.',
    answeredOn: '2026-09-08',
  },
  {
    id: 'q3',
    question: 'How is battery health measured, and is it guaranteed?',
    askedBy: 'Arvind T.',
    answer:
      'Battery health is measured with a diagnostic tool during inspection and shown as a percentage range on the listing. It is a measured fact as of the inspection date, not a guarantee of future health, and is covered under the standard warranty like any other component.',
    answeredOn: '2026-08-30',
  },
  {
    id: 'q4',
    question: 'Can I return the laptop if it does not match the grade described?',
    askedBy: 'Neha P.',
    answer:
      'Yes. If a unit does not match its stated grade or specification on arrival, it qualifies for return under our returns policy. Raise it from your orders page with photos and our team will arrange pickup.',
    answeredOn: '2026-08-19',
  },
  {
    id: 'q5',
    question: 'Do you offer a discount for a bulk order of 10 or more units?',
    askedBy: 'Rajesh D.',
    answer:
      'Bulk requirements are handled separately from the listed unit price — submit your requirement through the Bulk requirement page and our team will get back with a quote for the quantity and configuration you need.',
    answeredOn: '2026-08-05',
  },
];

export function QASection(): React.JSX.Element {
  return (
    <section className="qa" aria-labelledby="qa-h" data-testid="qa">
      <h2 className="sec-t" id="qa-h">
        Questions and answers
      </h2>

      <ul className="qa-list">
        {SAMPLE_QA.map((qa) => (
          <li key={qa.id} className="qa-item">
            <p className="qa-q">
              <span className="qa-tag qa-tag-q">Q</span>
              {qa.question}
            </p>
            <p className="qa-a">
              <span className="qa-tag qa-tag-a">A</span>
              {qa.answer}
            </p>
            <span className="qa-meta">
              Asked by {qa.askedBy} · Answered by Trugrade team
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
