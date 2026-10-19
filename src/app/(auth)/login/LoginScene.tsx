import Image from 'next/image';
import { Icon } from '@/components/ui/primitives';
import { getBrand } from '@/lib/brand';
import { splitName } from '@/lib/sacco-brand';
import type { IconName } from '@/lib/icons';
import styles from './login.module.css';

const features: { title: string; detail: string; icon: IconName }[] = [
  { title: 'Secure', detail: 'Your data is protected', icon: 'groups' },
  { title: 'Reliable', detail: 'Trusted by our members', icon: 'verified_user' },
  { title: 'Growing Together', detail: 'Stronger communities', icon: 'bar_chart' },
  { title: 'Member Focused', detail: 'Your success is our priority', icon: 'handshake' },
];

/** Login-only presentation; the shared password screens retain their own shell. */
export async function LoginScene({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const [nameTop, nameBottom] = splitName(brand.legalName);

  return (
    <main className={styles.scene}>
      <Image src="/brand/login-community.webp" alt="" fill priority sizes="100vw" className={styles.artwork} />
      <section className={styles.brandPanel} aria-label="About our SACCO">
        <header className={styles.lockup}>
          <Image src="/brand/bnd-logo.png" alt={brand.legalName} width={124} height={124} priority className={styles.brandLogo} />
          <div>
            <p className={styles.organization}>{nameTop}<br />{nameBottom}</p>
            <p className={styles.tagline}>{brand.motto}</p>
          </div>
        </header>

        <div className={styles.promise}>
          <div className={styles.goldLine} aria-hidden="true" />
          <p className={styles.eyebrow}>People <span>|</span> Savings <span>|</span> Loans <span>|</span> Stronger Communities</p>
          <h1>Your Trusted Partner in<br /><em>Savings, Loans</em> and<br />Financial Growth</h1>
          <p className={styles.description}>We empower our members through accessible<br className={styles.desktopBreak} /> financial services, strong communities and<br className={styles.desktopBreak} /> sustainable development.</p>
        </div>

        <ul className={styles.features}>
          {features.map(({ title, detail, icon }) => (
            <li key={title}>
              <span className={styles.featureIcon}><Icon name={icon} size={34} /></span>
              <h2>{title}</h2>
              <p>{detail}</p>
            </li>
          ))}
        </ul>

        <div className={styles.motto}>
          <p>Together We Grow,<br /><span>Prosper and Build</span></p>
          <svg viewBox="0 0 220 38" aria-hidden="true"><path d="M8 32 Q110 -2 210 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>
        </div>
      </section>

      <section className={styles.formPanel} aria-labelledby="login-heading">
        <div className={styles.glass}>
          <header className={styles.cardHeader}>
            <Image src="/brand/bnd-logo.png" alt={brand.legalName} width={128} height={128} priority className={styles.cardLogo} />
            <div className={styles.cardAccent} aria-hidden="true" />
            <h2 id="login-heading">Welcome Back</h2>
            <p>Sign in to access your SACCO account</p>
          </header>
          {children}
          <div className={styles.divider} aria-hidden="true"><span /><span /></div>
          <aside className={styles.security} aria-label="Account security">
            <span className={styles.shield}><Icon name="verified_user" size={38} filled={false} /></span>
            <div><h3>Secure and Confidential</h3><p>Your information is protected with industry-standard security and encryption.</p></div>
          </aside>
        </div>
      </section>
    </main>
  );
}
