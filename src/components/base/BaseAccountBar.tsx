"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOutOfBase } from "@/lib/base/wallet";
import { shortAddr } from "@/lib/ui/format";
import { BaseMark } from "./SignInWithBase";

/** The signed-in Base account, with a link to it on BaseScan and a sign-out. */
export function BaseAccountBar({ address }: { address: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <a
        href={`https://basescan.org/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="num inline-flex h-8 items-center gap-2 rounded-full bg-paper px-3 text-ink ring-1 ring-line ring-inset hover:ring-ink"
      >
        <BaseMark size={12} />
        {shortAddr(address)}
      </a>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await signOutOfBase().catch(() => {});
          router.replace("/base");
          router.refresh();
        }}
        className="h-8 rounded-full px-3 text-ink-2 hover:text-ink disabled:opacity-50"
      >
        Sign out
      </button>
    </div>
  );
}
