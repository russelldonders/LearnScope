export default function PersonAvatar({ name, avatarUrl, size = 8 }) {
  const dimension = `${size * 4}px`
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        style={{ width: dimension, height: dimension }}
        className="rounded-full object-cover border border-hairline shrink-0"
      />
    )
  }
  return (
    <span
      style={{ width: dimension, height: dimension }}
      className="rounded-full border border-hairline bg-paper text-secondary font-mono text-xs flex items-center justify-center shrink-0 uppercase"
    >
      {name?.[0] || '?'}
    </span>
  )
}
