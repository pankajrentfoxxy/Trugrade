import type { Metadata } from 'next';

import { SignInForm } from '../AuthForms';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page(): React.JSX.Element {
  return (
    <div className="authwrap">
      <div className="authcard">
        <a className="brand" href="/">
          <span className="wm">
            tru<em>grade</em>
          </span>
        </a>
        <h1>Sign in</h1>
        <p className="authlede">Buyers land on the shop. Vendors and staff land in the console.</p>
        <SignInForm />
      </div>
      <aside className="authside grid-bg">
        <h2>Every machine measured, not described.</h2>
        <p>Opened at the supplier&rsquo;s warehouse, graded on measurements, sealed until it reaches your dock.</p>
      </aside>
    </div>
  );
}
