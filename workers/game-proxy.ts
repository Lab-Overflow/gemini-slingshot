const UPSTREAM_HOST = 'gemini-slingshot.pages.dev';
const GAME_PREFIX = '/game';

const mapPath = (pathname: string) => {
  if (pathname === GAME_PREFIX) return '/';
  if (pathname.startsWith(`${GAME_PREFIX}/`)) {
    return pathname.slice(GAME_PREFIX.length) || '/';
  }
  return pathname;
};

export default {
  async fetch(request: Request): Promise<Response> {
    const incomingUrl = new URL(request.url);
    const mappedPath = mapPath(incomingUrl.pathname);

    const upstreamUrl = new URL(`https://${UPSTREAM_HOST}${mappedPath}${incomingUrl.search}`);
    const upstreamRequest = new Request(upstreamUrl.toString(), request);
    const upstreamResponse = await fetch(upstreamRequest);

    const responseHeaders = new Headers(upstreamResponse.headers);

    const location = responseHeaders.get('location');
    if (location) {
      try {
        const rewritten = new URL(location, `https://${UPSTREAM_HOST}`);

        if (rewritten.hostname === UPSTREAM_HOST && rewritten.pathname.startsWith('/')) {
          rewritten.hostname = incomingUrl.hostname;
          rewritten.protocol = incomingUrl.protocol;
          rewritten.pathname = `${GAME_PREFIX}${rewritten.pathname === '/' ? '' : rewritten.pathname}`;
          responseHeaders.set('location', rewritten.toString());
        }
      } catch {
        // Keep original location if parsing fails.
      }
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    });
  }
};
