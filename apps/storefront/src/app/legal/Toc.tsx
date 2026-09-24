'use client';

import { useEffect, useState } from 'react';

/**
 * The "On this page" rail, with the current section marked.
 *
 * A client component only because scrollspy needs the scroll position; the
 * list itself is plain anchors and works before hydration. The section nearest
 * the top of the viewport wins, and at the very bottom of the document the last
 * section wins even when it is too short to ever reach the top.
 */
export function Toc({
  sections,
}: {
  sections: ReadonlyArray<{ id: string; heading: string }>;
}): React.JSX.Element {
  const [current, setCurrent] = useState<string>(sections[0]?.id ?? '');

  useEffect(() => {
    const ids = sections.map((s) => s.id);
    const spy = (): void => {
      let cur = ids[0] ?? '';
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) cur = id;
      }
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        cur = ids[ids.length - 1] ?? cur;
      }
      setCurrent(cur);
    };
    spy();
    document.addEventListener('scroll', spy, { passive: true });
    return () => document.removeEventListener('scroll', spy);
  }, [sections]);

  return (
    <ul className="lg-toc">
      {sections.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            className={s.id === current ? 'on' : undefined}
            aria-current={s.id === current ? 'location' : undefined}
          >
            {s.heading}
          </a>
        </li>
      ))}
    </ul>
  );
}
