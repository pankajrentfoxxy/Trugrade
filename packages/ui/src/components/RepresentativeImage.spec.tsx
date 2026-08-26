import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { RepresentativeImage } from './primitives';

/**
 * The liability control, in three renderings.
 *
 * We show a buyer a representative photograph while vouching for that specific
 * machine's condition under CP e-Comm Rule 7(5). That is honest only while the
 * caption says exactly what the buyer is looking at — and the interesting cases
 * are the two where the photograph is not of their machine's SKU at all.
 */

const SRC = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

describe('the caption is always there', () => {
  it.each(['SKU', 'MODEL', 'SERIES'] as const)('captions a %s-level image', (match) => {
    render(<RepresentativeImage src={SRC} alt="Grade A lid" grade="A" match={match} />);
    expect(screen.getByText(/Representative image of Grade/)).toBeInTheDocument();
    expect(screen.getByText(/unit passport/)).toBeInTheDocument();
  });

  it('names the grade it is representing', () => {
    render(<RepresentativeImage src={SRC} alt="Grade B lid" grade="B" />);
    expect(screen.getByText(/Grade B condition/)).toBeInTheDocument();
  });

  it('links the passport when there is one, so the real photographs are reachable', () => {
    render(<RepresentativeImage src={SRC} alt="lid" grade="A" passportHref="/unit/5CD1234ABC" />);
    // Rule 7(5) turns on the buyer being able to reach the actual inspection
    // report BEFORE purchase, not after.
    expect(screen.getByRole('link', { name: /unit passport/ })).toHaveAttribute(
      'href',
      '/unit/5CD1234ABC',
    );
  });
});

describe('a broader anchor says whose machine it actually is', () => {
  it('says nothing extra for a SKU-level photograph', () => {
    render(<RepresentativeImage src={SRC} alt="lid" grade="A" match="SKU" />);
    expect(screen.queryByText(/another unit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/another model/)).not.toBeInTheDocument();
  });

  it('admits a model-level photograph is of another unit', () => {
    render(<RepresentativeImage src={SRC} alt="lid" grade="A" match="MODEL" />);
    expect(screen.getByText(/another unit of the same model/)).toBeInTheDocument();
  });

  it('admits a series-level photograph is of a different model', () => {
    // This is the quiet half of the misrepresentation risk: a photograph of a
    // different machine entirely, rendered exactly like a specific one.
    render(<RepresentativeImage src={SRC} alt="lid" grade="A" match="SERIES" />);
    expect(screen.getByText(/another model in the same range/)).toBeInTheDocument();
  });
});

describe('nothing resolved renders a labelled placeholder', () => {
  it('says so in words when src is absent', () => {
    render(<RepresentativeImage alt="none" grade="B" />);
    // Task 4: "a placeholder that is explicitly labelled as such". A bare grey
    // box reads as "loading", which is a different and false claim.
    expect(screen.getByText(/No photograph of Grade B condition yet/)).toBeInTheDocument();
    expect(screen.getByText(/not photographed this grade/)).toBeInTheDocument();
  });

  it('renders no <img> at all, so nothing can 404 into a broken icon', () => {
    const { container } = render(<RepresentativeImage alt="none" grade="B" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('is announced to a screen reader rather than being silently empty', () => {
    render(<RepresentativeImage alt="none" grade="A_PLUS" />);
    expect(
      screen.getByRole('img', { name: /No photograph available for Grade A\+/ }),
    ).toBeInTheDocument();
  });

  it('still points at the unit passport, which does have real photographs', () => {
    render(<RepresentativeImage alt="none" grade="B" passportHref="/unit/ABC" />);
    expect(screen.getByRole('link', { name: /unit passport/ })).toBeInTheDocument();
  });

  it('treats an explicit PLACEHOLDER match as a placeholder even with a src', () => {
    render(<RepresentativeImage src={SRC} alt="x" grade="A" match="PLACEHOLDER" />);
    expect(screen.getByText(/No photograph of Grade A condition yet/)).toBeInTheDocument();
  });
});
