import { LegalFooter } from "@/components/legal/LegalFooter";

/** Legal pages sit in the app's centred column under the floating header. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-24 sm:px-6">{children}</div>
      <LegalFooter />
    </>
  );
}
