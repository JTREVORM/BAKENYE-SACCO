/**
 * Auth screens render without the app shell: no sidebar, no bottom bar,
 * nothing that implies a session the visitor does not yet have.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-background min-h-[100dvh]">{children}</div>;
}
