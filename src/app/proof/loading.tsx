import { Spinner } from "@/components/ui";

/** Shown while the page's data (Base, Avantis, the database) loads. */
export default function Loading() {
  return (
    <div className="flex justify-center pb-28 pt-24" role="status" aria-label="Loading">
      <Spinner />
    </div>
  );
}
