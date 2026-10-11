// Wakes the backend and the database ahead of the first real request.
// Uses REACT_APP_GRAPHQL_URL, the same address your Apollo client talks to.
const URL = process.env.REACT_APP_GRAPHQL_URL;
let last = 0;

export function warmUp() {
  if (!URL || Date.now() - last < 4 * 60 * 1000) return; // at most once every 4 minutes
  last = Date.now();
  fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ ping }' }),
    cache: 'no-store',
  }).catch(() => {}); // ignore errors: this is only a wake-up call
}
