import { LegalLink, LegalPage, LegalSection } from '@/components/shell/legal-page';
import { pageMetadata } from '@/lib/seo';
import { isSignedIn } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata = pageMetadata({
  title: 'Privacy Policy · SquadSync',
  description: 'What SquadSync stores, why it stores it, who processes it, and how to have it deleted.',
  path: '/privacy',
});

export default async function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" signedIn={await isSignedIn()}>
      <LegalSection title="Who runs this">
        <p>
          SquadSync, a student project at KLE Institute of Technology, Hubballi. SquadSync is not
          affiliated with Krafton or BGMI.
        </p>
        <p>
          This page describes what the app does. It is not a claim of compliance with any law. It
          follows the approach of India&apos;s Digital Personal Data Protection Act, 2023: a stated
          purpose, your consent, and a way to withdraw it.
        </p>
      </LegalSection>

      <LegalSection title="What we store">
        <ul>
          <li>Account: your email address. Supabase Auth keeps your password as a hash, and the app cannot read it.</li>
          <li>Profile: display name, BGMI in-game name, region, and a short bio and picture link if you add them.</li>
          <li>Preferences: main role, teammate skill range, comms style, languages, ranked preference and ping limit.</li>
          <li>Availability: the weekly time windows you enter, and your time zone offset.</li>
          <li>Skill and match data: skill scores and match statistics, tournaments you register for, squads you are placed in, and ratings and comments from post-match feedback.</li>
          <li>Contact form: the name, email address and message you send.</li>
          <li>Rate limiting: a hash of your IP address, not the address itself. Old entries are removed after about a day.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Why we store it">
        <p>
          To run your account and form tournament squads. Region, role, skill, comms, language and
          availability decide who you are grouped with. Post-match feedback also trains the model
          that scores squads. Contact messages are used to reply to you.
        </p>
      </LegalSection>

      <LegalSection title="Who can see it">
        <ul>
          <li>Other signed-in players can see your profile, in-game name, region and skill statistics.</li>
          <li>Your preferences and availability can only be read by you through the app. The matchmaking system uses them when it forms squads.</li>
          <li>Tournament organisers can read contact form messages.</li>
          <li>Your email address is not shown to other players.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Who processes it">
        <p>
          Supabase stores the database and handles sign-in, in its Mumbai region. Vercel hosts the
          app, and its servers currently run in the United States, so your data passes through that
          country when you use the app. Both keep their own request logs. We do not sell your data.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and analytics">
        <p>
          We set cookies only for sign-in: the session cookies that keep you signed in, and a cookie
          lasting 60 seconds that limits how often a confirmation email can be resent. There are no
          analytics or advertising cookies.
        </p>
      </LegalSection>

      <LegalSection title="Consent, withdrawal and deletion">
        <p>
          You consent by ticking the box when you sign up. The app does not keep a separate record
          of that tick, only the date your account was created. You must be at least 16 to use
          SquadSync.
        </p>
        <p>
          You can correct your profile, preferences and availability in the app. To withdraw consent
          and delete your account, send a request through the <LegalLink href="/contact">contact page</LegalLink>.
          There is no delete button yet. Deleting an account also removes its profile, statistics,
          preferences, availability, match participation and feedback. Contact messages are kept
          until someone deletes them, and are removed on request.
        </p>
      </LegalSection>

      <LegalSection title="Demo data">
        <p>Many player profiles in the app are generated demo data, not real people.</p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions go through the <LegalLink href="/contact">contact page</LegalLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
