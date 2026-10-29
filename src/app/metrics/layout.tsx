import { LegalFooter } from "@/components/legal/LegalFooter";

/** The public metrics page: the app's centred column, readable without signing in. */
export default function MetricsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-24 sm:px-6">{children}</div>
      <LegalFooter />
    </>
  );
}
