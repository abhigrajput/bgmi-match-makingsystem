import { LegalLink, LegalPage, LegalSection } from '@/components/shell/legal-page';
import { pageMetadata } from '@/lib/seo';
import { isSignedIn } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata = pageMetadata({
  title: 'Terms of Use · SquadSync',
  description: 'The terms for using SquadSync, a student project for BGMI tournament squad matchmaking.',
  path: '/terms',
});

export default async function TermsPage() {
  return (
    <LegalPage title="Terms of Use" signedIn={await isSignedIn()}>
      <LegalSection title="What this is">
        <p>
          SquadSync is a student project at KLE Institute of Technology, Hubballi, that forms BGMI
          tournament squads. It is an academic prototype, it is free, and it may change or stop at
          any time. SquadSync is not affiliated with Krafton or BGMI.
        </p>
      </LegalSection>

      <LegalSection title="Who can use it">
        <p>
          You must be at least 16. By creating an account you agree to these terms and to the{' '}
          <LegalLink href="/privacy">Privacy Policy</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <ul>
          <li>Give accurate details. Your in-game name must be your own.</li>
          <li>Keep your password private. You are responsible for what happens on your account.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <ul>
          <li>Do not harass other players, including in feedback comments.</li>
          <li>Do not impersonate anyone or manipulate ratings.</li>
          <li>Do not try to break, overload or get around the security of the service.</li>
        </ul>
        <p>Accounts that break these rules may be removed.</p>
      </LegalSection>

      <LegalSection title="No guarantees">
        <p>
          Squads, scores and ratings are the output of an experimental system and may be wrong. The
          service is provided as it is, with no promise that it will be available or free of errors.
          To the extent the law allows, the project team is not liable for losses from using it.
        </p>
      </LegalSection>

      <LegalSection title="Changes and ending">
        <p>
          These terms may change, and this page will show the new date. You can stop at any time by
          asking for your account to be deleted through the{' '}
          <LegalLink href="/contact">contact page</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>These terms are governed by the laws of India. The courts at Hubballi, Karnataka have jurisdiction.</p>
      </LegalSection>
    </LegalPage>
  );
}
