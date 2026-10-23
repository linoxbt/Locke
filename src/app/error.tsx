"use client";

import { useEffect } from "react";
import { Arrow, Button, Card, Display, LinkButton } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-24 sm:px-6">
      <Card tone="danger" className="mt-6 px-6 py-16 sm:py-24">
        <Display lead="Something broke." rest="It's on our side, not yours." restClass="text-paper/70" className="max-w-[18ch]" />
        <p className="mt-6 max-w-[56ch] text-[15px] text-paper/80">
          Try again. If it keeps happening, the Strike API or the database may be unavailable.
          {error.digest && <span className="num mt-2 block text-[12px] text-paper/60">Reference {error.digest}</span>}
        </p>
        <div className="mt-10 flex flex-wrap gap-2">
          <Button variant="paper" onClick={reset}>
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
