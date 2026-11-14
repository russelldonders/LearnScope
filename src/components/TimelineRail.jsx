// The left-hand column of a skill's history timeline for an entry shown as a
// box: its icon sits level with the middle of the box, with the line running
// into it from above and on below. The box below the icon is followed by a
// gap (mb-6) the line has to cross, hence the fixed piece at the end: the two
// flexible pieces then split only the box's own height, centring the icon.
// isFirst: nothing above to connect to. isLast: nothing below.
export default function TimelineRail({ isFirst = false, isLast = false, children }) {
  const line = 'w-px bg-hairline'
  return (
    <div aria-hidden="true" className="flex flex-col items-center w-12 shrink-0">
      <span className={`flex-1 ${isFirst ? '' : line}`} />
      <span className="flex items-center justify-center py-1">{children}</span>
      <span className={`flex-1 ${isLast ? '' : line}`} />
      <span className={`h-6 ${isLast ? '' : line}`} />
    </div>
  )
}
