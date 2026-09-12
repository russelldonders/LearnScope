// Renders one labeled input per roster field definition (20260911130000),
// keyed by field id in `values`/`onChange` -- shared by EmployerMemberFieldsModal
// (editing an existing member's roster record) and EmployerConsole's add-user
// form (capturing the same fields up front, rather than a second "fill this
// in later" step), so the two never drift into rendering fields differently.
export default function EmployerMemberFieldInputs({ fields, values, onChange }) {
  return (
    <>
      {fields.map((field) => (
        <label key={field.id} className="block text-xs text-secondary">
          {field.label}
          {field.required && <span className="text-red-700"> *</span>}
          {field.field_type === 'textarea' ? (
            <textarea
              rows={3}
              required={field.required}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
              className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          ) : field.field_type === 'select' ? (
            <select
              required={field.required}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
              className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Select…</option>
              {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : field.field_type === 'boolean' ? (
            <select
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
              className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Unset</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              type={field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : field.field_type === 'email' ? 'email' : 'text'}
              required={field.required}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
              className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          )}
        </label>
      ))}
    </>
  )
}
