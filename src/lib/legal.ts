// Facts the legal pages need about who runs Locke. A missing value renders as a visible
// [placeholder] so it can't slip through unnoticed.

import { configuredSiteUrl } from "./ui/site";

export const LEGAL = {
  /** Date the current versions took effect. */
  updated: "5 November 2026",
  /** The site the terms cover: the configured public address (a preview has its own), else Locke's main domain. */
  site: configuredSiteUrl()?.host ?? "trylocke.online",
  /** Legal name of the person or company that runs Locke, e.g. "Locke Technologies Ltd". */
  operator: "Alem Denis (Lino)" as string | null,
  /** Where people write about their data, the terms or a complaint. */
  contactEmail: "alemzdelight@gmail.com" as string | null,
  /** Telegram handle for quick questions. */
  telegram: "@martins_0x" as string | null,
  /** Country whose law governs the terms and whose courts hear disputes, e.g. "Nigeria". */
  // England and Wales: a common, well-tested choice for agreements with customers in many countries.
  governingLaw: "England and Wales" as string | null,
};

export const operatorName = () => LEGAL.operator ?? "[legal name of Locke's operator]";
export const contactEmail = () => LEGAL.contactEmail ?? "[contact email]";
export const governingLaw = () => LEGAL.governingLaw ?? "[country]";

export const LEGAL_DOCS = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/cookies", label: "Cookie Policy" },
  { href: "/legal/risk", label: "Risk Disclosure" },
] as const;
