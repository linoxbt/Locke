import { Arrow, Card, Display, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-24 sm:px-6">
    <Card tone="ink" className="mt-6 px-6 py-20 text-center sm:py-28">
      <p className="num text-[13px] text-lime">404</p>
      <Display lead="Nothing here." rest="This page, plan, vault or proof doesn't exist, or isn't yours." restClass="text-paper/45" className="mx-auto mt-6 max-w-[18ch]" />
      <div className="mt-10 flex flex-wrap justify-center gap-2">
        <LinkButton href="/" variant="paper" size="lg">
          Home <Arrow />
        </LinkButton>
        <LinkButton href="/connect" variant="ghost" size="lg">
          Sign in
        </LinkButton>
      </div>
    </Card>
    </div>
  );
}
