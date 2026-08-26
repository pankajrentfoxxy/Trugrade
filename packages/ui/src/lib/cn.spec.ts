import { createRequire } from 'node:module';
import { cn, TYPE_SCALE } from './cn';

/**
 * `tokens.spec.ts` proves the PALETTE is right by recomputing contrast against
 * globals.css. This file proves the palette still reaches the DOM.
 *
 * Both halves are needed and neither implies the other. For a while the tokens
 * were correct, `tokens.spec.ts` was green, and every amber button in the app
 * rendered `--ink-2` on `--acc` — about 1.7:1 — because `cn()` silently dropped
 * the text colour when a size class followed it. A guard that checks a
 * definition and never the delivery is the shape of defect this repo keeps
 * finding.
 */
describe('cn — size classes must not eat colour classes', () => {
  /**
   * The exact call that was broken, spelled out rather than parameterised: it is
   * the Button primary variant, and it is the most-used control in the product.
   */
  it('keeps the text colour when a size class is merged after it', () => {
    const out = cn('bg-acc text-acc-on', 'h-11 px-5 text-body-sm');
    expect(out).toContain('text-acc-on');
    expect(out).toContain('text-body-sm');
  });

  it.each([
    ['danger', 'bg-fail text-white', 'text-body-sm'],
    ['link', 'text-acc-ink underline', 'text-body-sm'],
    ['pill', 'text-ink-2', 'text-label'],
    ['datum', 'text-ink', 'text-data'],
  ])('keeps the colour on the %s variant', (_name, colour, size) => {
    const out = cn(colour, size);
    const colourClass = colour.split(' ').find((c) => c.startsWith('text-'))!;
    expect(out).toContain(colourClass);
    expect(out).toContain(size);
  });

  /** The half that must still work: two real colours DO conflict. */
  it('still lets a later colour win over an earlier one', () => {
    expect(cn('text-ink', 'text-ink-2')).toBe('text-ink-2');
  });

  /** And two sizes conflict with each other. */
  it('still lets a later size win over an earlier one', () => {
    expect(cn('text-body', 'text-h2')).toBe('text-h2');
  });

  /**
   * The drift guard. A size added to the preset but not to cn.ts is silently
   * treated as a colour again, which is exactly how this arrived — so the list
   * is checked against the preset rather than trusted.
   */
  it('covers every fontSize the Tailwind preset defines', () => {
    const require_ = createRequire(__filename);
    const preset = require_('@trugrade/config/tailwind') as {
      theme?: { extend?: { fontSize?: Record<string, unknown> } };
    };
    const fromPreset = Object.keys(preset.theme?.extend?.fontSize ?? {});

    expect(fromPreset.length).toBeGreaterThan(0);
    expect([...TYPE_SCALE].sort()).toEqual(fromPreset.sort());
  });
});
