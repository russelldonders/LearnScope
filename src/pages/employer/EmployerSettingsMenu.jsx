import DropdownNavMenu from '../../components/DropdownNavMenu'

// The organisation workspace's text "Settings" menu (replacing the former cog
// + intermediate settings dialog): each item opens its own settings dialog
// (onSelect) or goes to its own page (to). Not a section tab -- choosing an
// item never changes the selected section -- so it's a plain menu button
// beside the section tablist. `active` underlines it while one of its pages
// (e.g. Linked providers) is open.
export default function EmployerSettingsMenu({ items, active = false }) {
  return <DropdownNavMenu label="Settings" items={items} active={active} align="right" />
}
