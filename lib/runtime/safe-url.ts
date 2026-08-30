export const SAFE_SOURCE_HOSTS = [
  'nasa.gov',
  'noaa.gov',
  'earthdata.nasa.gov',
  'eonet.gsfc.nasa.gov',
  'un.org',
  'imo.org',
  'worldbank.org',
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'delta.com',
  'maersk.com',
  'dhl.com',
  'usace.army.mil',
  'pancanal.com',
  'emirates.com',
  'gov.bc.ca',
  'canada.ca',
  'ilaunion.org',
  'y.uno',
  'aisstream.io',
  'adsb.lol',
  'getnauta.com',
] as const;

function hasNonCanonicalUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f || character === '\\')
      return true;
  }
  return false;
}

/**
 * The single external evidence-link decision shared by validation and rendering.
 * It intentionally accepts only canonical HTTPS URLs on curated hosts.
 */
export function isSafeEvidenceUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2_048 ||
    !value.startsWith('https://') ||
    hasNonCanonicalUrlCharacter(value)
  ) {
    return false;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      !url.username &&
      !url.password &&
      SAFE_SOURCE_HOSTS.some(
        (allowed) => host === allowed || host.endsWith(`.${allowed}`),
      )
    );
  } catch {
    return false;
  }
}
