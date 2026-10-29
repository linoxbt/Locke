import { LegalFooter } from "@/components/legal/LegalFooter";

/** Public proof pages: the same centred column as Locke on Base, readable without signing in. */
export default function ProofLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-[860px] px-4 pb-20 pt-24 sm:px-6">{children}</div>
      <LegalFooter />
    </>
  );
}
