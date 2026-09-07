/**
 * Auth screens render without the app shell: no sidebar, no bottom bar,
 * nothing that implies a session the visitor does not yet have.
 *
 * The navy is here rather than on the page because the signed-out design is a
 * fixed landscape composition scaled to fit (see `ScaledCanvas`): on a portrait
 * handset it letterboxes, and the band above and below it has to be the brand
 * colour rather than the app background.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-[#0a2660]">{children}</div>;
}
