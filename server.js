// =============================================================================
// AI CO-STAR OVERLAY - LOCAL SERVER (server.js)
// Zero-dependency Node.js static & config server
// =============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const ENV_FILE = path.join(ROOT_DIR, '.env');
const ENV_JS_FILE = path.join(ROOT_DIR, 'env.js');

// Parse .env file into key-value object
function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// Sync .env content to env.js so file:/// usage also works
function syncEnvJs(env) {
  const cleanEnv = {
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || "",
    OPENROUTER_OLD_API_KEY: env.OPENROUTER_OLD_API_KEY || "",
    ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY || "",
    ELEVENLABS_OLD_API_KEY: env.ELEVENLABS_OLD_API_KEY || "",
    NOIZ_API_KEY: env.NOIZ_API_KEY || "",
    NOIZ_OLD_API_KEY: env.NOIZ_OLD_API_KEY || "",
    DEEPGRAM_API_KEY: env.DEEPGRAM_API_KEY || ""
  };

  const code = `// =============================================================================\n// AI CO-STAR OVERLAY - ENVIRONMENT CONFIG (Auto-synced from .env)\n// =============================================================================\n\nwindow.ENV_CONFIG = ${JSON.stringify(cleanEnv, null, 2)};\n`;

  try {
    fs.writeFileSync(ENV_JS_FILE, code, 'utf-8');
  } catch (err) {
    console.error("Warning: Could not auto-sync env.js:", err.message);
  }
}

// Load initial env
let envConfig = parseEnvFile(ENV_FILE);
syncEnvJs(envConfig);

// Watch .env for live changes
if (fs.existsSync(ENV_FILE)) {
  fs.watch(ENV_FILE, () => {
    try {
      envConfig = parseEnvFile(ENV_FILE);
      syncEnvJs(envConfig);
      console.log('🔄 .env updated and synced.');
    } catch (e) {}
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const PORT = parseInt(process.env.PORT || envConfig.PORT || '3000', 10);

const server = http.createServer((req, res) => {
  // CORS headers for local access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = parsedUrl.pathname;

  // Handle favicon.ico cleanly
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API endpoint: return keys to frontend
  if (pathname === '/api/keys') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(envConfig));
    return;
  }

  // Dynamic env.js endpoint
  if (pathname === '/env.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(`window.ENV_CONFIG = ${JSON.stringify(envConfig, null, 2)};`);
    return;
  }

  // Default root to ai-costar-overlay.html
  if (pathname === '/' || pathname === '/index.html') {
    pathname = '/ai-costar-overlay.html';
  }

  // Static file serving
  const safePath = path.normalize(path.join(ROOT_DIR, pathname));
  if (!safePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Do not serve raw .env file directly via web
  if (path.basename(safePath).startsWith('.env')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use by another process.`);
    console.error(`👉 Close any other running server window or change PORT in .env, then try again.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 AI Co-Star Overlay Server running at:`);
  console.log(`   👉 http://localhost:${PORT}/`);
  console.log(`   👉 http://localhost:${PORT}/ai-costar-overlay.html`);
  console.log('====================================================');
  console.log('Key Status from .env:');
  console.log(`- OpenRouter:   ${envConfig.OPENROUTER_API_KEY ? '✅ New Key set' : '❌ None'} | ${envConfig.OPENROUTER_OLD_API_KEY ? '✅ Old Key set' : '❌ No fallback'}`);
  console.log(`- ElevenLabs:   ${envConfig.ELEVENLABS_API_KEY ? '✅ New Key set' : '❌ None'} | ${envConfig.ELEVENLABS_OLD_API_KEY ? '✅ Old Key set' : '❌ No fallback'}`);
  console.log(`- Noiz:         ${envConfig.NOIZ_API_KEY ? '✅ New Key set' : '❌ None'} | ${envConfig.NOIZ_OLD_API_KEY ? '✅ Old Key set' : '❌ No fallback'}`);
  console.log(`- Deepgram:     ${envConfig.DEEPGRAM_API_KEY ? '✅ Set (Live STT enabled)' : '⚠️  Not set (set in .env or overlay UI)'}`);
  console.log('====================================================\n');
});
