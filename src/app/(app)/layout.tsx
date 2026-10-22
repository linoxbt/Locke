/** App and content pages sit in a centred column under the floating header. The landing is full-bleed. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-24 sm:px-6">{children}</div>;
}
