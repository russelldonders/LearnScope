import { getProviderProfile } from './providerProfile'

// Shared by ProviderProfile.jsx (the /providers/:slug page itself) and
// Login.jsx/Signup.jsx (reached via a `?org=:slug` link from that page, so
// the whitelabelled look continues into account creation) -- all three need
// the same {name, logoUrl, colours} shape, so this is the one place that
// knows how to turn a slug into it. Deliberately reuses get_provider_profile
// (0090/20260908100000) rather than a second public RPC: it's a bit more
// than a login/signup page needs (skills/courses come along for the ride),
// but that avoids a second anon-safe org-lookup surface with its own
// public_profile_enabled/status gating to keep in sync with the first.
export async function getOrganisationBranding(slug) {
  const data = await getProviderProfile(slug)
  if (!data) return null
  const { name, logoUrl, brandPrimaryColor, brandSecondaryColor, brandHoverColor, brandBackgroundColor, brandTextColor } =
    data.organisation
  return {
    name,
    logoUrl,
    primaryColor: brandPrimaryColor,
    secondaryColor: brandSecondaryColor,
    hoverColor: brandHoverColor,
    backgroundColor: brandBackgroundColor,
    textColor: brandTextColor,
  }
}

// CSS custom properties consumed by the `var(--org-x, var(--color-y))`
// Tailwind arbitrary-value classes on the branded pages -- undefined
// (not set) for any colour the org hasn't picked, so those elements fall
// straight through to the app's own default design tokens.
export function orgBrandStyle(branding) {
  return {
    '--org-primary': branding?.primaryColor || undefined,
    '--org-secondary': branding?.secondaryColor || undefined,
    '--org-hover': branding?.hoverColor || undefined,
    '--org-background': branding?.backgroundColor || undefined,
    '--org-text': branding?.textColor || undefined,
  }
}
