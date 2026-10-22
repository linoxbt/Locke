"use client";

import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { useWallet } from "./WalletProvider";

export function SignOutButton() {
  const { signOut } = useWallet();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await signOut();
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
