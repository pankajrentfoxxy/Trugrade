/**
 * Chip, Checkbox, Uploader.
 *
 * Two of these carry a legal control rather than a preference:
 *   - CP e-Comm Rule 4(9): no pre-ticked checkbox, anywhere. The last test in
 *     the Checkbox block reads the source, because a component test proves only
 *     that *this* checkbox behaves — it says nothing about the `defaultChecked`
 *     someone adds next quarter "so the flow converts better".
 *   - WCAG 2.2 SC 2.5.7: a drop zone is never the only path to uploading a file.
 */

import * as React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Checkbox, Chip, Uploader, formatFileSize, type UploadedFile } from './forms';

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every shipped component in the package — specs and stories excluded. */
function componentSources(dir: string = join(__dirname, '..')): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...componentSources(full));
    else if (/\.tsx$/.test(entry) && !/\.(spec|stories)\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

describe('Chip', () => {
  it('is a toggle button carrying aria-pressed, not a bordered checkbox', async () => {
    const onToggle = jest.fn();
    render(<Chip label="Dell" count={128} onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: /Dell/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows a facet count — how many results, never how many are left to buy', () => {
    render(<Chip label="16 GB" count={42} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /16 GB 42/ })).toBeInTheDocument();
  });

  it('puts the remove control inside the token rather than nesting a button', async () => {
    const onRemove = jest.fn();
    const { container } = render(<Chip label="Dell" onRemove={onRemove} />);
    expect(container.querySelector('button button')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Dell' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <>
        <Chip label="Dell" count={128} selected onToggle={() => {}} />
        <Chip label="Lenovo" count={64} onToggle={() => {}} />
        <Chip label="16 GB" onRemove={() => {}} />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Checkbox — Rule 4(9), no pre-ticked consent', () => {
  it('renders unchecked when the caller says unchecked', () => {
    render(
      <Checkbox
        label="Email me when a saved search finds stock"
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('ties the consequence to the box, so it is read with the label', () => {
    render(
      <Checkbox
        label="Allow my team to raise orders without approval"
        consequence="Anyone with the Procurer role will be able to place orders on credit, up to your account limit."
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(/place orders on credit/);
  });

  it('reports the new value rather than an event the caller has to unwrap', async () => {
    const onChange = jest.fn();
    render(<Checkbox label="I agree" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('puts the mixed state in the accessibility tree, not only in the pixels', () => {
    render(<Checkbox label="Select all" checked={false} indeterminate onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBePartiallyChecked();
  });

  it('announces its error and marks itself invalid', () => {
    render(
      <Checkbox
        label="I accept the terms"
        checked={false}
        onChange={() => {}}
        error="Accept the terms to continue."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Accept the terms to continue.');
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('has no defaultChecked anywhere in the package', () => {
    // The one assertion here that can fail because of code that does not exist
    // yet. An uncontrolled checkbox is how a pre-ticked consent ships: nobody
    // writes `checked={true}` on a consent in a diff, but a default is invisible.
    // Comments are stripped first — this file's own prose says the word.
    const files = componentSources();
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(stripComments(readFileSync(file, 'utf8'))).not.toMatch(/defaultChecked/);
    }
  });

  it('makes `checked` required, so a ticked box is always a line someone wrote', () => {
    const source = readFileSync(join(__dirname, 'forms.tsx'), 'utf8');
    expect(source).toMatch(/\n {2}checked: boolean;/);
    expect(source).not.toMatch(/\n {2}checked\?:/);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Checkbox
        label="Allow my team to raise orders without approval"
        consequence="Anyone with the Procurer role will be able to place orders on credit."
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

const FILES: UploadedFile[] = [
  { id: 'f1', name: 'GST-cert.pdf', sizeBytes: 384_512, status: 'uploading', progressPct: 62 },
  {
    id: 'f2',
    name: 'udyam.pdf',
    sizeBytes: 91_000,
    status: 'rejected',
    rejectionReason: 'The GSTIN on this certificate does not match the one you entered.',
  },
];

describe('Uploader', () => {
  it('always ships a real file input — the drop zone is never the only path', () => {
    const { container } = render(
      <Uploader
        label="GST registration certificate"
        hint="PDF or JPG, up to 10 MB."
        accept="application/pdf"
        maxSizeMb={10}
        files={[]}
        onSelect={() => {}}
      />,
    );
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
    expect(input).not.toBeDisabled();
    expect(screen.getByLabelText(/GST registration certificate/)).toBe(input);
  });

  it('announces progress at the quartiles, not on every tick', () => {
    render(
      <Uploader
        label="GST registration certificate"
        accept="application/pdf"
        maxSizeMb={10}
        files={FILES}
        onSelect={() => {}}
      />,
    );
    // 62% announces as 50: a live region that reads every tick drowns the page.
    expect(screen.getByRole('status')).toHaveTextContent('Uploading GST-cert.pdf, 50 percent.');
  });

  it('keeps a rejected file listed with the actual reason', () => {
    render(
      <Uploader
        label="GST registration certificate"
        accept="application/pdf"
        maxSizeMb={10}
        files={FILES}
        onSelect={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText('udyam.pdf')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The GSTIN on this certificate does not match the one you entered.',
    );
    // A vendor with six documents in flight must not have to remember which failed.
    expect(screen.getByRole('button', { name: 'Remove udyam.pdf' })).toBeInTheDocument();
  });

  it('hands the caller real File objects', async () => {
    const onSelect = jest.fn();
    const { container } = render(
      <Uploader
        label="Requirement list"
        accept="text/csv"
        maxSizeMb={5}
        files={[]}
        onSelect={onSelect}
      />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['a,b'], 'requirement.csv', { type: 'text/csv' }));
    expect(onSelect).toHaveBeenCalledWith([expect.objectContaining({ name: 'requirement.csv' })]);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Uploader
        label="GST registration certificate"
        hint="PDF or JPG, up to 10 MB."
        accept="application/pdf"
        maxSizeMb={10}
        files={FILES}
        onSelect={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('formatFileSize', () => {
  it('reads as a person would say it', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(384_512)).toBe('376 KB');
    expect(formatFileSize(10_485_760)).toBe('10.0 MB');
  });
});
