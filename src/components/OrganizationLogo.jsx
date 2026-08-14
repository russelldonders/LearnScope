import { useState } from 'react'
import { getOrganizationLogoUrl } from '../lib/organizationLogo'

export default function OrganizationLogo({ organizationUrl, size = 24 }) {
  const [failed, setFailed] = useState(false)
  const logoUrl = getOrganizationLogoUrl(organizationUrl)

  if (!logoUrl || failed) {
    return (
      <span
        className="flex items-center justify-center rounded-md border border-hairline bg-paper shrink-0"
        style={{ width: size, height: size }}
      >
        <svg
          width={size * 0.55}
          height={size * 0.55}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-secondary"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 21V9h6v12" />
        </svg>
      </span>
    )
  }

  return (
    <img
      src={logoUrl}
      alt=""
      onError={() => setFailed(true)}
      className="rounded-md border border-hairline object-contain bg-paper shrink-0"
      style={{ width: size, height: size }}
    />
  )
}
