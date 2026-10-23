"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote } from "./ui";
import { useWallet } from "./WalletProvider";
import { errorMessage } from "@/lib/ui/api";

export function SignOutButton() {
  const { signOut } = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await signOut();
            router.push("/");
            router.refresh();
          } catch (e) {
            setError(`Couldn't sign out: ${errorMessage(e)}`);
            setBusy(false);
          }
        }}
      >
        Sign out
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}
