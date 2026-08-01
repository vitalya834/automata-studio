const APPROVED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'vitalya834.github.io',
]);

export function trustedExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && APPROVED_EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
