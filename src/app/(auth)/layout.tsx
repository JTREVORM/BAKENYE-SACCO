/**
 * Auth screens render without the app shell: no sidebar, no bottom bar,
 * nothing that implies a session the visitor does not yet have.
 *
 * The navy is here rather than on the page so the band behind the brand panel
 * and the footer is the brand colour on every auth route, including while the
 * page is still streaming in.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-[#0a2660]">{children}</div>;
}
