// Form actions post back to the current page. A bare `?_action=X` replaces the whole
// query, so career, patient_id and pagination would be lost. This keeps every current
// parameter and replaces only `_action`. `queryString` is `String(actions.X)`, which Astro
// renders as `?_action=X`.
export function receptionActionUrl(currentUrl: URL, actionQueryString: string): string {
	const actionName = new URLSearchParams(actionQueryString).get('_action');
	if (!actionName) throw new Error('Expected an Astro action query string with _action.');
	const query = new URLSearchParams(currentUrl.searchParams);
	query.delete('_action');
	query.append('_action', actionName);
	return `?${query}`;
}
