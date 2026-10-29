/** Base's mark: a blue square with rounded corners. */
export function BaseMark({ size = 16 }: { size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-[3px] bg-[#0000ff]" style={{ width: size, height: size }} />;
}
