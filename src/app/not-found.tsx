import { Arrow, Card, Display, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-24 sm:px-6">
    <Card tone="ink" className="mt-6 px-6 py-20 text-center sm:py-28">
      <p className="num text-[13px] text-lime">404</p>
      <Display lead="Nothing here." rest="The page or plan doesn't exist, or isn't yours." restClass="text-paper/45" className="mx-auto mt-6 max-w-[16ch]" />
      <LinkButton href="/portfolio" variant="paper" size="lg" className="mt-10">
        Go to portfolio <Arrow />
      </LinkButton>
    </Card>
    </div>
  );
}
