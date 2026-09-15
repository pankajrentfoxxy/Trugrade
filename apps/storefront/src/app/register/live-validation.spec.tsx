/**
 * The profile cards say what is wrong with a field as it is typed.
 *
 * Only fields that hold something are judged between keystrokes; an empty
 * required field still waits for Continue, so a half-filled card is not a
 * wall of red before anyone has reached the second box.
 */
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StepCompany } from './StepCompany';
import { StepContacts } from './StepContacts';

const noop = (): void => undefined;
const never = async (): Promise<null> => null;

describe('the Company card', () => {
  it('judges the legal name as it is typed, and leaves untouched fields alone', () => {
    render(
      <StepCompany
        answers={{}}
        busy={false}
        onSaveDraft={noop}
        onContinue={never}
        onFieldFocus={noop}
      />,
    );
    const name = screen.getByLabelText(/Company legal name/);
    fireEvent.change(name, { target: { value: 'A' } });
    expect(screen.getByText(/too short to be a company name/)).toBeInTheDocument();
    // One field typed into, one refusal: the empty selects say nothing yet.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.change(name, { target: { value: 'Acme Industries' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the Contacts and delivery card', () => {
  it('judges a contact email as it is typed', () => {
    render(
      <StepContacts
        answers={{}}
        gstins={[]}
        accountHolder={{ fullName: 'Priya', email: 'p@acme.example', mobile: '+919876543210' }}
        busy={false}
        onSaveDraft={noop}
        onContinue={never}
        onFieldFocus={noop}
      />,
    );
    const email = screen.getByLabelText(/Procurement email/);
    fireEvent.change(email, { target: { value: 'priya@acme' } });
    expect(screen.getByText(/valid email/)).toBeInTheDocument();
    fireEvent.change(email, { target: { value: 'priya@acme.example' } });
    expect(screen.queryByText(/valid email/)).not.toBeInTheDocument();
  });
});
