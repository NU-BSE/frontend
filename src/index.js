/**
 * Cloudflare Worker entry: static SPA hosting only.
 *
 * The API used to be dispatched here via `./api/router.js`, which no longer
 * exists — the backend moved to the FastAPI service (see EXPO_PUBLIC_API_URL
 * in .env.example). The dead routing code and its hard-coded fallback secret
 * were removed rather than restored; this worker now only serves the
 * exported web app.
 */
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // SPA static asset serving under /app
      if (url.pathname === '/app' || url.pathname === '/app/') {
        url.pathname = '/index.html';
      } else {
        url.pathname = url.pathname.replace(/^\/app/, '');
      }

      const modifiedRequest = new Request(url.toString(), request);
      const assets = env?.ASSETS || globalThis?.ASSETS;

      if (assets && typeof assets.fetch === 'function') {
        let response = await assets.fetch(modifiedRequest);

        if (response.status === 404) {
          const fallbackUrl = new URL(request.url);
          fallbackUrl.pathname = '/index.html';
          response = await assets.fetch(new Request(fallbackUrl.toString(), request));
        }
        return response;
      }

      return await fetch(modifiedRequest);
    } catch {
      return new Response(
        JSON.stringify({ message: 'Internal server error' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
        }
      );
    }
  },
};
