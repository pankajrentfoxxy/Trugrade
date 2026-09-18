import * as React from 'react';

/**
 * The panel beside the sign-in form.
 *
 * A supplied artwork rather than a drawn one: `public/auth/signin.png`, shown
 * edge to edge behind the dialog's own rounded corner. It is decoration, so its
 * `alt` is empty and the wrapper stays `aria-hidden` — every claim it makes in
 * print is made properly, in text, on the pages that can back it.
 *
 * The file is portrait (941×1672) and the slot beside a four-control form is
 * not, so it is cropped from the top: the headline survives, the footer strip
 * is what goes. A landscape crop of the same artwork would need no cropping at
 * all — see the note in the dialog's CSS.
 */
export function AuthArt(): React.JSX.Element {
  return (
    <div className="authart" aria-hidden="true">
      <img className="authart__img" src="/auth/signin.png" alt="" width={941} height={1672} />
    </div>
  );
}
