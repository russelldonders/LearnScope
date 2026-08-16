// Splits the stored organization_url into a protocol dropdown (defaulting
// to https://) and a bare domain/path input, so the learner never has to
// type the scheme themselves. The two are recombined into one URL string
// on every change -- value/onChange still deal in a single plain URL, same
// as a normal text field, so callers don't need to know about the split.
export default function OrganizationUrlField({ value, onChange, id = 'organizationUrl' }) {
  const protocol = value.startsWith('http://') ? 'http://' : 'https://'
  const rest = value.replace(/^https?:\/\//i, '')

  function handleProtocolChange(newProtocol) {
    onChange(rest ? newProtocol + rest : '')
  }

  function handleRestChange(newRest) {
    onChange(newRest ? protocol + newRest : '')
  }

  return (
    <div>
      <label className="block text-sm text-secondary mb-1" htmlFor={id}>
        Organization website (optional)
      </label>
      <div className="flex gap-2">
        <select
          aria-label="URL protocol"
          value={protocol}
          onChange={(e) => handleProtocolChange(e.target.value)}
          className="shrink-0 rounded-md border border-hairline bg-paper px-2 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        >
          <option value="https://">https://</option>
          <option value="http://">http://</option>
        </select>
        <input
          id={id}
          type="text"
          placeholder="example.com"
          value={rest}
          onChange={(e) => handleRestChange(e.target.value)}
          className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>
      <p className="text-xs text-secondary/80 mt-1">Used to show the organization's logo.</p>
    </div>
  )
}
