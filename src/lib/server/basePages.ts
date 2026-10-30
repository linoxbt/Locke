import { redirect } from "next/navigation";
import { factoryAbi } from "../base/contracts";
import { builderSuffix } from "../base/builderCode";
import { basePublicClient } from "./baseChain";
import { currentBaseSession } from "./baseSession";
import { config, ConfigError } from "./config";
import type { Session } from "./session";

/** The Base session for a page, or null when signed out (or the database isn't configured). */
export async function optionalBaseSession(): Promise<Session | null> {
  try {
    return await currentBaseSession();
  } catch (e) {
    if (e instanceof ConfigError) return null;
    throw e;
  }
}

export async function requireBasePage(returnTo: string): Promise<Session> {
  const s = await optionalBaseSession();
  if (!s) redirect(`/base?next=${encodeURIComponent(returnTo)}`);
  return s;
}

/** What client components need to send transactions: the factory and the Builder Code suffix. */
export function baseClientSettings() {
  return { factory: config.baseFactoryAddress, dataSuffix: builderSuffix(config.baseBuilderCode) };
}

/** Locke's fee (basis points of the hedge) for vaults created now, read from the factory. Null if it can't be read. */
export async function factoryFeeBps(): Promise<number | null> {
  const factory = config.baseFactoryAddress;
  if (!factory) return null;
  try {
    return Number(await basePublicClient().readContract({ address: factory, abi: factoryAbi, functionName: "feeBps" }));
  } catch {
    return null;
  }
}

/** The keeper new vaults get, so an owner who removed it can add it back. */
export async function factoryKeeper(): Promise<string | null> {
  const factory = config.baseFactoryAddress;
  if (!factory) return null;
  try {
    return ((await basePublicClient().readContract({ address: factory, abi: factoryAbi, functionName: "keeper" })) as string).toLowerCase();
  } catch {
    return null;
  }
}
