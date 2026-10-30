"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { Arrow, Button, Card, Display, LinkButton } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);
  // reset() alone re-renders the same failed server output; refresh fetches it again first.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-24 sm:px-6">
      <Card tone="danger" className="mt-6 px-6 py-16 sm:py-24">
        <Display lead="Something broke." rest="It's on our side, not yours." restClass="text-paper/85" className="max-w-[18ch]" />
        <p className="mt-6 max-w-[56ch] text-[15px] text-paper">
          Try again. If it keeps happening, Strike, Avantis, Base or Locke&apos;s database may be unavailable for a moment.
          {error.digest && <span className="num mt-2 block text-[12px] text-paper">Reference {error.digest}</span>}
        </p>
        <div className="mt-10 flex flex-wrap gap-2">
          <Button variant="paper" onClick={retry}>
            Try again
          </Button>
          <LinkButton href="/" variant="ghost">
            Home <Arrow />
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}
