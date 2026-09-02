// Shared mutation-feedback primitive for the platform-admin/provider-admin
// consoles. Every mutation handler across these consoles already renders an
// inline pending/success/error message as a plain paragraph next to its
// trigger button -- this just standardizes that markup instead of adding a
// new floating-toast system. Two of these paragraphs (AdminUsers.jsx,
// AdminSkills.jsx) already use role="alert" for errors and role="status"
// text-moss for success; this component matches that exact styling so
// adopting it elsewhere doesn't change how anything looks, only which pages
// get the announcement.
//
// status: 'idle' | 'pending' | 'success' | 'error'. Renders nothing for
// 'idle' or when message is empty. Error is assertive (role="alert" --
// interrupts, for a failure the user must notice); pending/success are
// polite (role="status" -- announced without interrupting whatever the
// screen reader is already saying).
const ROLE_BY_STATUS = {
  error: 'alert',
  success: 'status',
  pending: 'status',
}

const CLASS_BY_STATUS = {
  error: 'text-red-700',
  success: 'text-moss',
  pending: 'text-secondary',
}

// `size` defaults to 'sm' (text-sm), matching AdminUsers.jsx/AdminSkills.jsx
// and the four newly-adopting pages; pass 'xs' for a tighter inline spot
// like OrganisationStaffPanel's nested per-organisation panel, which already
// used text-xs for the same message before this component existed.
export default function MutationFeedback({ status, message, className = '', size = 'sm' }) {
  const role = ROLE_BY_STATUS[status]
  if (!role || !message) return null
  const sizeClass = size === 'xs' ? 'text-xs' : 'text-sm'
  return (
    <p role={role} className={`${sizeClass} ${CLASS_BY_STATUS[status]} ${className}`}>
      {message}
    </p>
  )
}
