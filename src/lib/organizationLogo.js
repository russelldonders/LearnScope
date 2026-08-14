export function getOrganizationDomain(url) {
  if (!url) return null
  try {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`
    return new URL(withProtocol).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Google's favicon service resolves a bare domain to that site's favicon
// (falling back to a generic globe icon if it has none) -- no key needed.
// Used as a lightweight stand-in for a proper organization logo.
export function getOrganizationLogoUrl(url) {
  const domain = getOrganizationDomain(url)
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null
}
