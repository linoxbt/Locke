import { Spinner } from "@/components/ui";

/** Shown while an app page's server data (Strike, the database) loads. */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1240px] justify-center px-4 pb-28 pt-40 sm:px-6">
      <Spinner />
    </div>
  );
}
