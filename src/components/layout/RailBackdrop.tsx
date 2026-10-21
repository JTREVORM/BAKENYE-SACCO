import Image from 'next/image';

/**
 * The navigation rail's photographic ground, shared by the staff sidebar and
 * the member rail so both read as the same piece of furniture.
 *
 * The SACCO's own landscape, washed into the navy so the rail has depth without
 * competing with the list on top of it. `aria-hidden` and behind everything at
 * `-z-10`: it is texture, never information, and the gradient alone still reads
 * correctly if the file is ever removed.
 */
export function RailBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <Image
        src="/brand/login-community.webp"
        alt=""
        fill
        sizes="320px"
        className="object-cover object-[70%_center] opacity-[0.18]"
      />
      <div className="from-ink-deep/85 via-ink/80 to-ink-deep absolute inset-0 bg-gradient-to-b" />
      {/* A single warm highlight at the top, so the crest sits in light. */}
      <div className="bg-secondary-container/10 absolute -left-16 -top-24 h-56 w-56 rounded-full blur-3xl" />
    </div>
  );
}
