import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SectionDialog } from './section-dialog';

describe('SectionDialog', () => {
  it('shows step count in mono and calls primary action', () => {
    const onPrimary = jest.fn();
    render(
      <SectionDialog
        open
        onClose={() => undefined}
        title="Business & GST"
        subtitle="How your business is registered."
        stepIndex={2}
        stepCount={3}
        primaryLabel="Save"
        onPrimary={onPrimary}
      >
        <input aria-label="GSTIN" defaultValue="" />
      </SectionDialog>,
    );
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onPrimary).toHaveBeenCalled();
  });

  it('invokes onClose when Later is clicked', () => {
    const onClose = jest.fn();
    render(
      <SectionDialog
        open
        onClose={onClose}
        title="Pickup address"
        stepIndex={1}
        stepCount={2}
        primaryLabel="Continue"
        onPrimary={() => undefined}
      >
        <p>Body</p>
      </SectionDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(onClose).toHaveBeenCalled();
  });
});
