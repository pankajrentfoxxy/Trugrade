import type { Metadata } from 'next';

import { RegisterForm } from '../AuthForms';

export const metadata: Metadata = { title: 'Create an account' };

export default function Page(): React.JSX.Element {
  return (
    <div className="authwrap">
      <div className="authcard">
        <a className="brand" href="/">
          <span className="wm">
            tru<em>grade</em>
          </span>
        </a>
        <h1>Create an account</h1>
        <p className="authlede">One form for both sides of the market. Pick what you are here to do.</p>
        <RegisterForm />
      </div>
      <aside className="authside grid-bg">
        <h2>What happens next</h2>
        <p>Your account is created and you are signed straight in. Onboarding &mdash; GST, PAN, bank and a signed agreement &mdash; comes after, and you can leave and resume it.</p>
      </aside>
    </div>
  );
}
