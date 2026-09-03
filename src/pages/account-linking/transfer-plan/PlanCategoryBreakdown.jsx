// Read-only per-category record counts for both accounts in the plan. A
// null count means that category couldn't be loaded (partial data), shown
// as "--" rather than "0". Wrapped in its own horizontal-scroll container
// so a narrow viewport scrolls the table instead of the whole page.
export default function PlanCategoryBreakdown({ categories }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Records by category</h3>
      <p className="text-sm text-secondary mb-4">
        What each account currently has in each category. This plan doesn't move or combine any of it by
        itself -- see the conflicts below for what actually needs a decision.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[24rem]">
          <thead>
            <tr className="text-left text-xs text-secondary">
              <th scope="col" className="px-2 py-1 font-medium">
                Category
              </th>
              <th scope="col" className="px-2 py-1 font-medium">
                Source account
              </th>
              <th scope="col" className="px-2 py-1 font-medium">
                Durable account
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {categories.map((category) => (
              <tr key={category.key}>
                <th scope="row" className="px-2 py-2 text-left text-ink font-normal">
                  {category.label}
                </th>
                <td className="px-2 py-2 text-ink">{category.sourceCount ?? '—'}</td>
                <td className="px-2 py-2 text-ink">{category.durableCount ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
