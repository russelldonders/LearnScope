import { CAPABILITIES, toggleCapability } from '../../lib/organisationCapabilities'

// Plain-language capability picker for creating/editing an organisation --
// see src/lib/organisationCapabilities.js for what each option really does.
export default function OrganisationCapabilityFields({ idPrefix, value, onChange, initialValue = null }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-secondary">What this organisation does</legend>
      <p className="mb-2 text-xs text-secondary">
        These settings decide which parts of the organisation’s workspace are available.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {CAPABILITIES.map((capability) => {
          const checked = value.includes(capability.value)
          const id = `${idPrefix}-${capability.value}`
          const describedBy = `${id}-description`
          const showOffWarning =
            capability.offWarning && initialValue?.includes(capability.value) && !checked
          return (
            <div
              key={capability.value}
              className={`rounded-md border p-3 ${checked ? 'border-moss/50 bg-moss/5' : 'border-hairline'}`}
            >
              <label htmlFor={id} className="flex items-start gap-2 text-sm font-medium text-ink cursor-pointer">
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  aria-describedby={describedBy}
                  onChange={(event) => onChange(toggleCapability(value, capability.value, event.target.checked))}
                  className="mt-0.5 rounded border-hairline accent-moss"
                />
                {capability.label}
              </label>
              <div id={describedBy} className="mt-1 pl-6 text-xs text-secondary space-y-1">
                <p>{capability.summary}</p>
                {capability.enables.length > 0 && (
                  <>
                    <p className="text-ink">Switches on:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {capability.enables.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </>
                )}
                {capability.note && <p>{capability.note}</p>}
              </div>
              {showOffWarning && (
                <p role="status" className="mt-2 pl-6 text-xs text-gold">{capability.offWarning}</p>
              )}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
