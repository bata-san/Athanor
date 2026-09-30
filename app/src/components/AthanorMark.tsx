/** The Athanor mark: two rounded right triangles and a dot. Inherits the text colour (monochrome). */
export function AthanorMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 528 528" aria-hidden="true" focusable="false" data-part="mark">
      <g fill="currentColor" stroke="currentColor" strokeWidth="140" strokeLinejoin="round">
        <path d="M70 70H260L70 260Z" />
        <path d="M268 267H458V457Z" />
      </g>
      <circle cx="71" cy="448" r="71" fill="currentColor" />
    </svg>
  )
}
