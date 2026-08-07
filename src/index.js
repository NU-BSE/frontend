import { dispatch } from './api/router.js';

const API_SECRET = 'dev-secret-change-in-production';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // API routes
      if (url.pathname.startsWith('/auth/') ||
          url.pathname.startsWith('/user/') ||
          url.pathname.startsWith('/connectors') ||
          url.pathname.startsWith('/tools/')) {

        if (request.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
          });
        }

        let body = {};
        try {
          body = await request.json();
        } catch {
          // no body
        }

        const headers = Object.fromEntries(request.headers.entries());
        const secret = env?.JWT_SECRET || API_SECRET;

        const result = await dispatch(
          request.method,
          url.pathname,
          body,
          headers,
          secret,
        );

        return new Response(result.body, {
          status: result.status,
          headers: result.headers,
        });
      }

      // SPA static asset serving
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
    } catch (err) {
      return new Response(
        JSON.stringify({ message: 'Internal server error' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  },
};
