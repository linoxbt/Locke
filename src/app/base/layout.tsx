/** Locke on Base pages sit in the same centred column as the app, under the floating header. */
export default function BaseLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-24 sm:px-6">{children}</div>;
}
