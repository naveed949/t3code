# Usage

Open **Settings** → **Usage** to switch between two views:

- **Historical** shows transcript-derived token activity, date windows, charts, and API-equivalent cost.
- **Subscription** shows the current allowance windows reported by each enabled Codex or Claude provider.

Subscription allowance is kept separate for each provider and environment. T3 Code displays provider-reported percentages, window scopes, reset times, credits, and spending controls only when the provider supplies them. It does not infer a quota, reset, account status, or combined cross-provider total.

On mobile, use the **Refresh** button or pull down on the Usage screen to request a new observation. Leaving the Subscription view stops its live allowance demand; returning to it starts a fresh snapshot-first subscription. If an environment is offline, its last known reading remains identified by its connection state rather than being presented as current.

When Claude does not provide subscription limits, the Claude section remains visible with this explanation:

> Claude subscription usage is unavailable. Claude did not provide usage limits.

Historical usage remains available independently of subscription allowance reporting.
