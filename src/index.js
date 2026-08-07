export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // 1. Изменяем путь
      if (url.pathname === '/app' || url.pathname === '/app/') {
        url.pathname = '/index.html';
      } else {
        url.pathname = url.pathname.replace(/^\/app/, '');
      }

      // 2. Создаем модифицированный запрос
      const modifiedRequest = new Request(url.toString(), request);

      // 3. Достаем объект ассетов из env или globalThis
      const assets = env?.ASSETS || globalThis?.ASSETS;

      if (assets && typeof assets.fetch === 'function') {
        let response = await assets.fetch(modifiedRequest);
        
        // SPA Fallback
        if (response.status === 404) {
          const fallbackUrl = new URL(request.url);
          fallbackUrl.pathname = '/index.html';
          response = await assets.fetch(new Request(fallbackUrl.toString(), request));
        }
        return response;
      }

      // 4. Резервный вариант (если binding ассетов недоступен в рантайме):
      // Запрашиваем через стандартный fetch обратно в рантайм Cloudflare
      return await fetch(modifiedRequest);

    } catch (err) {
      return new Response(`Worker Error: ${err.message}\nStack: ${err.stack}`, { 
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' } 
      });
    }
  }
};