// Facts the legal pages need about who runs Locke. Fill these in before the pages go live: a
// missing value renders as a visible [placeholder] so it can't slip through unnoticed.

export const LEGAL = {
  /** Date the current versions took effect. */
  updated: "29 October 2026",
  site: "trylocke.online",
  /** Legal name of the person or company that runs Locke, e.g. "Locke Technologies Ltd". */
  operator: null as string | null,
  /** Where people write about their data, the terms or a complaint. */
  contactEmail: null as string | null,
  /** Country whose law governs the terms and whose courts hear disputes, e.g. "Nigeria". */
  governingLaw: null as string | null,
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
