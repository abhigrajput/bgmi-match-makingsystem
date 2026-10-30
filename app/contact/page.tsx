import { PublicShell } from '@/components/shell/public-shell';
import { pageMetadata } from '@/lib/seo';
import { isSignedIn } from '@/lib/supabase/server';

import { ContactForm } from './contact-form';

// Reads CONTACT_EMAIL and CONTACT_PHONE per request, so setting them needs no rebuild.
export const dynamic = 'force-dynamic';

export const metadata = pageMetadata({
  title: 'Contact · SquadSync',
  description: 'Send the SquadSync team a question, a bug report or a data request.',
  path: '/contact',
});

const directLink = 'inline-flex min-h-11 items-center font-medium text-data hover:underline';

export default async function ContactPage() {
  const signedIn = await isSignedIn();
  const email = process.env.CONTACT_EMAIL?.trim();
  const phone = process.env.CONTACT_PHONE?.trim();

  return (
    <PublicShell signedIn={signedIn}>
      <div className="mx-auto max-w-xl px-4 py-12 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Contact</h1>
        <p className="mb-6 mt-2 text-sm text-muted">
          Questions, bug reports and data requests all come here. Leave an email address we can
          reply to.
        </p>

        {email || phone ? (
          <ul className="mb-6 text-sm">
            {email ? (
              <li>
                <a href={`mailto:${email}`} className={directLink}>
                  {email}
                </a>
              </li>
            ) : null}
            {phone ? (
              <li>
                <a href={`tel:${phone.replace(/[^+\d]/g, '')}`} className={directLink}>
                  {phone}
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="rounded-card border border-border bg-surface p-6">
          <ContactForm />
        </div>
      </div>
    </PublicShell>
  );
}
