import api, { route } from '@forge/api';

/** Return the first Confluence space the user can see. */
export async function getFirstSpace() {
  const res = await api.asUser().requestConfluence(route`/wiki/rest/api/space?limit=5`);
  if (!res.ok) {
    throw new Error(`Could not list Confluence spaces (HTTP ${res.status}).`);
  }
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error('No accessible Confluence space found.');
  }
  return data.results[0];
}

/**
 * Create a Confluence page (storage format body).
 * Returns the created page JSON (includes _links.webui for the URL).
 */
export async function createPage(spaceKey, title, storageBody) {
  const res = await api.asUser().requestConfluence(route`/wiki/rest/api/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'page',
      title,
      space: { key: spaceKey },
      body: { storage: { value: storageBody, representation: 'storage' } },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Could not create Confluence page (HTTP ${res.status}). ${detail}`.trim());
  }
  return res.json();
}
