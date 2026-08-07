const http = require('http');

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

http.createServer(async function (req, res) {
  try {
    const { dispatch } = await import('./src/api/router.js');
    const url = new URL(req.url, `http://${req.headers.host}`);

    const body = await readBody(req);

    const result = await dispatch(
      req.method,
      url.pathname,
      body,
      req.headers,
      API_SECRET,
    );

    res.writeHead(result.status, result.headers);
    res.end(result.body);
  } catch (err) {
    console.error('API error:', err);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ message: 'Internal server error' }));
  }
}).listen(PORT, () => {
  console.log(`Creepy.IM API server → http://localhost:${PORT}`);
  console.log(`  Auth:      POST /auth/email/request-code`);
  console.log(`  Auth:      POST /auth/email/verify-code`);
  console.log(`  Session:   GET|DELETE /auth/session`);
  console.log(`  Profile:   GET|PUT /user/profile`);
  console.log(`  History:   GET|POST /user/history`);
  console.log(`  Prefs:     GET|PUT /user/preferences`);
  console.log(`  Connectors: GET /connectors`);
  console.log(`  Tools:     POST /tools/calendar/list-events`);
  console.log(`  Tools:     POST /tools/calendar/create-event`);
  if (API_SECRET === 'dev-secret-change-in-production') {
    console.log(`  ⚠  Using default JWT secret — set JWT_SECRET env var in production`);
  }
});
