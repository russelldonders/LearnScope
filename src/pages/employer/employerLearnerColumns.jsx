import { requestedDataSummary } from '../../lib/employerDataAccess'
import { DATA_ACCESS_STATUS_LABELS } from '../../lib/employerLearnerTables'
import StatusBadge from '../../components/StatusBadge'

// Customizable data columns only -- the leading selection checkbox stays
// pinned outside this list (EmployerLearnersPanel has no trailing actions
// column). "Training access" only exists at all when attachedProviderOrg is
// truthy, so it's built conditionally into the array itself rather than
// left always-visible-and-toggleable -- mirrors AdminEmployers.jsx's
// employerColumns(organisationById) factory, just with two closed-over
// values (attachedProviderOrg, dataAccessByLearner) instead of one.
export function employerLearnerColumns(attachedProviderOrg, dataAccessByLearner) {
  const trainingAccessColumn = {
    key: 'training_access',
    label: 'Training access',
    sortable: false,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-2 text-xs whitespace-nowrap',
    renderCell: (m) =>
      m.trainingAccess
        ? `${m.trainingAccess.role === 'admin' ? 'Admin' : 'Trainer'}${m.trainingAccess.status === 'pending' ? ' (pending)' : ''}`
        : 'None',
  }
  return [
    {
      key: 'id',
      label: 'ID',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 font-mono text-xs text-secondary whitespace-nowrap',
      renderCell: (m) => m.userCode || '—',
    },
    {
      key: 'email',
      label: 'User',
      sortable: true,
      cellClassName: 'px-4 py-2 text-ink text-xs truncate max-w-[220px]',
      renderCell: (m) => m.email || m.user_id,
    },
    {
      key: 'role',
      label: 'Role',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 whitespace-nowrap',
      renderCell: (m) => (
        <StatusBadge label={!m.employerMember ? 'Training team' : m.role === 'admin' ? 'Admin' : 'Member'} tone="neutral" />
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 whitespace-nowrap',
      renderCell: (m) => (
        <StatusBadge
          label={m.status === 'pending' ? 'Pending' : m.status === 'inactive' ? 'Inactive' : 'Active'}
          tone={m.status === 'inactive' ? 'danger' : 'neutral'}
        />
      ),
    },
    ...(attachedProviderOrg ? [trainingAccessColumn] : []),
    {
      key: 'data_access',
      label: 'Data access',
      sortable: false,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 text-xs max-w-[220px]',
      renderCell: (m) => {
        const dataAccess = dataAccessByLearner[m.user_id]
        return (
          <div className="flex flex-col gap-1 items-start">
            <StatusBadge
              label={!m.employerMember ? 'Not applicable' : dataAccess ? DATA_ACCESS_STATUS_LABELS[dataAccess.status] : 'No request yet'}
              tone={dataAccess?.status === 'declined' || dataAccess?.status === 'revoked' ? 'danger' : 'neutral'}
            />
            {dataAccess && (
              <p className="text-[10px] text-secondary leading-snug">
                Requested: {requestedDataSummary(dataAccess)}
                {dataAccess.status === 'approved' && (
                  <>. Approved: {(dataAccess.approved_data || ['skills']).join(', ')}</>
                )}
              </p>
            )}
          </div>
        )
      },
    },
  ]
}
