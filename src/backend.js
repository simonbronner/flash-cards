import * as jose from 'jose';

// Cloudflare Access Config
// Find your Team Domain (e.g., https://your-team.cloudflareaccess.com)
// and AUD tag in the Zero Trust Dashboard.
const TEAM_DOMAIN = 'https://bronner-auth.cloudflareaccess.com'; 
const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const AUD = '5fdb8e98592398f0df40727103bc59dd92f7aa072cd0fcd451ad46c99312fd2e';

async function verifyToken(token) {
  if (!token) return null;
  try {
    const JWKS = jose.createRemoteJWKSet(new URL(CERTS_URL));
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: TEAM_DOMAIN,
      audience: AUD,
    });
    return payload;
  } catch (e) {
    console.error('JWT Verification Error:', e);
    return null;
  }
}

/**
 * Durable Object for Telemetry and Shared State
 */
export class FlashCardsTelemetry {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    
    // Initialize Schema
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        action TEXT,
        details TEXT
      );
      CREATE TABLE IF NOT EXISTS profiles (
        email TEXT PRIMARY KEY,
        firstName TEXT,
        lastName TEXT,
        lastLogin DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname === '/log') {
      const { email, action, details } = await request.json();
      this.sql.exec(`INSERT INTO activity (email, action, details) VALUES (?, ?, ?)`, 
        email, action, JSON.stringify(details));
      return new Response(JSON.stringify({ success: true }));
    }

    if (url.pathname === '/profile') {
      if (method === 'POST') {
        const { email, firstName, lastName } = await request.json();
        this.sql.exec(`
          INSERT INTO profiles (email, firstName, lastName, lastLogin) 
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(email) DO UPDATE SET 
            firstName = excluded.firstName,
            lastName = excluded.lastName,
            lastLogin = CURRENT_TIMESTAMP
        `, email, firstName, lastName);
        return new Response(JSON.stringify({ success: true }));
      }
      
      const email = url.searchParams.get('email');
      const results = [...this.sql.exec(`SELECT * FROM profiles WHERE email = ?`, email)];
      return new Response(JSON.stringify(results[0] || null));
    }

    if (url.pathname === '/history') {
      const results = [...this.sql.exec(`
        SELECT a.*, p.firstName, p.lastName 
        FROM activity a 
        LEFT JOIN profiles p ON a.email = p.email 
        ORDER BY a.timestamp DESC LIMIT 100
      `)];
      return new Response(JSON.stringify(results));
    }

    return new Response('Not Found', { status: 404 });
  }
}

/**
 * Main Worker Entry Point
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 1. Authenticate via CF_Authorization Cookie
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
    const token = cookies['CF_Authorization'];
    
    const payload = await verifyToken(token);
    if (!payload || !payload.email) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 2. Handle API Requests
    if (url.pathname.startsWith('/api/')) {
      const apiPath = url.pathname.replace('/api', '');
      const method = request.method;
      
      // We use a single global Durable Object for the "Shared Room" experience
      const id = env.TELEMETRY.idFromName('global_telemetry');
      const obj = env.TELEMETRY.get(id);

      // Forward to Durable Object
      const newUrl = new URL(request.url);
      newUrl.pathname = apiPath;
      
      if (apiPath === '/profile' && method === 'GET') {
        newUrl.searchParams.set('email', payload.email);
      }

      if (method === 'POST') {
        const body = await request.json();
        return obj.fetch(new Request(newUrl, {
          method: 'POST',
          body: JSON.stringify({ ...body, email: payload.email }),
          headers: { 'Content-Type': 'application/json' }
        }));
      }

      return obj.fetch(new Request(newUrl));
    }

    // Serve static assets (handled by Vite plugin automatically in dev/deploy)
    return env.ASSETS.fetch(request);
  }
};
