const SESSION_COOKIE = 'routeshift_session';
const SESSION_PATTERN = /^rs_[a-f0-9-]{36}$/;

function cookieValue(request: Request, name: string) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function runtimeSession(request: Request) {
  const existing = cookieValue(request, SESSION_COOKIE);
  if (existing && SESSION_PATTERN.test(existing)) {
    return { sessionId: existing, setCookie: null };
  }
  const sessionId = `rs_${crypto.randomUUID()}`;
  return {
    sessionId,
    setCookie: `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`,
  };
}

export function attachRuntimeSession(response: Response, setCookie: string | null) {
  if (setCookie) response.headers.append('Set-Cookie', setCookie);
  return response;
}
