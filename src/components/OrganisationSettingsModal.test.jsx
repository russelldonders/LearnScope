import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OrganisationSettingsModal from './OrganisationSettingsModal'
import { getOrganisationWebsiteBrandColours, updateOrganisation } from '../lib/admin/organisations'
import { recommendBrandPalette } from '../lib/brandPalette'

vi.mock('../lib/admin/organisations', () => ({
  updateOrganisation: vi.fn(),
  uploadOrganisationLogo: vi.fn(),
  removeOrganisationLogo: vi.fn(),
  getOrganisationWebsiteBrandColours: vi.fn(),
}))

vi.mock('../lib/brandPalette', () => ({
  recommendBrandPalette: vi.fn(),
}))

vi.mock('./AccessibleDialog', () => ({
  default: ({ children }) => <div role="dialog">{children}</div>,
}))

const organisation = {
  id: 'org-1',
  slug: 'acme',
  logo_url: 'https://example.com/logo.png',
  public_profile_enabled: false,
}

const palette = {
  primary: '#234567',
  secondary: '#a05b22',
  hover: '#1d3854',
  background: '#f2f5f7',
  text: '#101820',
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  recommendBrandPalette.mockResolvedValue(palette)
  getOrganisationWebsiteBrandColours.mockResolvedValue([])
  updateOrganisation.mockResolvedValue({})
})

describe('OrganisationSettingsModal logo colour recommendations', () => {
  it('previews recommendations and applies all five colours only after acceptance', async () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <OrganisationSettingsModal organisation={organisation} onClose={onClose} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recommend based on logo' }))

    expect(await screen.findByText('Recommended palette')).toBeInTheDocument()
    expect(screen.getByLabelText('Primary')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'Use these colours' }))

    expect(screen.getByLabelText('Primary')).toHaveValue(palette.primary)
    expect(screen.getByLabelText('Secondary')).toHaveValue(palette.secondary)
    expect(screen.getByLabelText('Hover')).toHaveValue(palette.hover)
    expect(screen.getByLabelText('Background')).toHaveValue(palette.background)
    expect(screen.getByLabelText('Text')).toHaveValue(palette.text)
    expect(screen.getByText('Recommended colours applied. Save to publish them.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateOrganisation).toHaveBeenCalledWith('org-1', expect.objectContaining({
      brandPrimaryColor: palette.primary,
      brandSecondaryColor: palette.secondary,
      brandHoverColor: palette.hover,
      brandBackgroundColor: palette.background,
      brandTextColor: palette.text,
    })))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('uses the entered organisation website as an additional recommendation source', async () => {
    const websiteColours = [
      { hex: '#1d428a', weight: 24 },
      { hex: '#ffcd00', weight: 18 },
    ]
    getOrganisationWebsiteBrandColours.mockResolvedValue(websiteColours)

    render(
      <MemoryRouter>
        <OrganisationSettingsModal
          organisation={{ ...organisation, url: 'https://www.example.com' }}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Recommend from logo + website' }))

    await waitFor(() => expect(getOrganisationWebsiteBrandColours).toHaveBeenCalledWith(
      'org-1',
      'https://www.example.com',
    ))
    expect(recommendBrandPalette).toHaveBeenCalledWith(
      organisation.logo_url,
      { websiteColours },
    )
    expect(await screen.findByText(/strongest colours in your logo and website/i)).toBeInTheDocument()
  })

  it('shows integration destinations as settings tabs', () => {
    render(
      <MemoryRouter>
        <OrganisationSettingsModal organisation={organisation} onClose={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('General')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'LMS connections' }))
      .toHaveAttribute('href', '/provider/organisations/org-1/lms-connections')
    expect(screen.getByRole('link', { name: 'LTI tools' }))
      .toHaveAttribute('href', '/provider/organisations/org-1/lti-tools')
  })

  it('closes after saving when the public provider page is enabled', async () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <OrganisationSettingsModal
          organisation={{ ...organisation, public_profile_enabled: true }}
          onClose={onClose}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateOrganisation).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalledOnce()
  })
})
