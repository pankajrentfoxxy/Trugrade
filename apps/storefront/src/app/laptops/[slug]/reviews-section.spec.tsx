import { render, screen, within } from '@testing-library/react';
import { ReviewsSection } from './ReviewsSection';

describe('ReviewsSection', () => {
  it('renders the sample comment cards with no star-by-star breakdown', () => {
    render(<ReviewsSection />);
    const section = within(screen.getByTestId('reviews'));
    expect(section.getByText('/ 5')).toBeInTheDocument();
    // No distribution bars: the redesign shows comment cards, not a breakdown.
    expect(section.queryByRole('list', { name: 'Ratings by star' })).toBeNull();
    expect(screen.queryByText(/^5 ★$/)).toBeNull();
    // Every sample review renders as a card with its author.
    expect(section.getAllByText(/Verified buyer/).length).toBeGreaterThan(1);
  });
});
