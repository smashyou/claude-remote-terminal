import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import httpProxy from 'http-proxy';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync, exec } from 'child_process';
import os from 'os';
import dotenv from 'dotenv';

// Detect platform
const isWindows = os.platform() === 'win32';
const isMac = os.platform() === 'darwin';
const isLinux = os.platform() === 'linux';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const proxy = httpProxy.createProxyServer({});

// Configuration
const PORT = process.env.PORT || 8080;
const SECRET = process.env.JWT_SECRET || 'change-this-secret-key';
const PASSWORD = process.env.PASSWORD || 'clauderemote';

// Store active terminal sessions
const terminals = new Map();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(join(__dirname, '../public')));

// Auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    const token = jwt.sign({ authenticated: true }, SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Check auth status
app.get('/api/auth-status', (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.json({ authenticated: false });
  }
  try {
    jwt.verify(token, SECRET);
    res.json({ authenticated: true });
  } catch {
    res.json({ authenticated: false });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// ============================================
// TMUX SESSION MANAGEMENT
// ============================================

// Check if tmux is installed (not available on Windows by default)
function checkTmux() {
  if (isWindows) {
    return false;
  }
  try {
    execSync('which tmux', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Get default shell based on platform
function getDefaultShell() {
  if (isWindows) {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

// Get home directory cross-platform
function getHomeDir() {
  return os.homedir();
}

// Get tmux path (handles Homebrew on both Intel and Apple Silicon Macs)
function getTmuxPath() {
  if (isWindows) return null;

  // Try common paths
  const paths = [
    '/opt/homebrew/bin/tmux',  // Apple Silicon Mac (Homebrew)
    '/usr/local/bin/tmux',      // Intel Mac (Homebrew)
    '/usr/bin/tmux',            // Linux system install
    'tmux'                      // Fall back to PATH
  ];

  for (const p of paths) {
    try {
      execSync(`${p} -V`, { stdio: 'pipe' });
      return p;
    } catch {}
  }
  return 'tmux';
}

// List all tmux sessions
app.get('/api/sessions', authMiddleware, (req, res) => {
  if (!checkTmux()) {
    return res.json({ sessions: [], error: 'tmux not installed' });
  }
  
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_created}|#{session_attached}"', {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8'
    });
    
    const sessions = output.trim().split('\n').filter(Boolean).map(line => {
      const [name, windows, created, attached] = line.split('|');
      return {
        name,
        windows: parseInt(windows),
        created: new Date(parseInt(created) * 1000).toISOString(),
        attached: attached === '1'
      };
    });
    
    res.json({ sessions });
  } catch (error) {
    // No sessions exist
    if (error.message.includes('no server running')) {
      return res.json({ sessions: [] });
    }
    res.json({ sessions: [], error: error.message });
  }
});

// Create a new tmux session
app.post('/api/sessions', authMiddleware, (req, res) => {
  const { name, directory } = req.body;
  
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid session name. Use only letters, numbers, underscores, and hyphens.' });
  }
  
  try {
    const dir = directory || process.env.HOME;
    execSync(`tmux new-session -d -s "${name}" -c "${dir}"`, { stdio: 'pipe' });
    res.json({ success: true, name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Kill a tmux session
app.delete('/api/sessions/:name', authMiddleware, (req, res) => {
  const { name } = req.params;
  
  try {
    execSync(`tmux kill-session -t "${name}"`, { stdio: 'pipe' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DEV SERVER PROXY
// ============================================

// Get list of listening ports (cross-platform)
app.get('/api/ports', authMiddleware, (req, res) => {
  try {
    let output;
    let ports = [];

    if (isWindows) {
      // Windows: use netstat
      output = execSync('netstat -ano -p TCP | findstr LISTENING', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      ports = output.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.trim().split(/\s+/);
        const address = parts[1] || '';
        const port = parseInt(address.split(':').pop());
        const pid = parts[4];
        return { port, process: `PID:${pid}`, address };
      });
    } else if (isMac) {
      // macOS: use lsof
      output = execSync(
        `lsof -iTCP -sTCP:LISTEN -n -P | grep -E ":[0-9]+" | awk '{print $9, $1}' | sort -u`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      ports = output.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split(' ');
        const address = parts[0];
        const process = parts[1] || 'unknown';
        const port = address.split(':').pop();
        return { port: parseInt(port), process, address };
      });
    } else {
      // Linux: use ss or netstat
      try {
        output = execSync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: '/bin/bash'
        });
        ports = output.trim().split('\n').slice(1).filter(Boolean).map(line => {
          const parts = line.trim().split(/\s+/);
          const address = parts[3] || parts[4] || '';
          const port = parseInt(address.split(':').pop());
          const process = parts[parts.length - 1] || 'unknown';
          return { port, process, address };
        });
      } catch {
        ports = [];
      }
    }

    // Filter reasonable ports and remove duplicates
    const filteredPorts = ports.filter(p => p.port >= 1024 && p.port <= 65535);
    const uniquePorts = [...new Map(filteredPorts.map(p => [p.port, p])).values()];

    res.json({ ports: uniquePorts });
  } catch (error) {
    res.json({ ports: [], error: error.message });
  }
});

// Proxy requests to local dev servers with HTML rewriting for base URL
app.use('/proxy/:port', authMiddleware, (req, res) => {
  const port = parseInt(req.params.port);

  if (isNaN(port) || port < 1 || port > 65535) {
    return res.status(400).send('Invalid port');
  }

  // Rewrite the URL to remove /proxy/:port prefix
  req.url = req.url.replace(`/proxy/${port}`, '') || '/';

  proxy.web(req, res, {
    target: `http://localhost:${port}`,
    changeOrigin: true,
    selfHandleResponse: true
  }, (error) => {
    res.status(502).send(`Cannot connect to localhost:${port} - ${error.message}`);
  });
});

// Modify HTML responses to inject base tag for proper asset loading
proxy.on('proxyRes', (proxyRes, req, res) => {
  const port = req.originalUrl.match(/^\/proxy\/(\d+)/)?.[1];
  if (!port) {
    proxyRes.pipe(res);
    return;
  }

  const contentType = proxyRes.headers['content-type'] || '';

  // Copy headers
  Object.keys(proxyRes.headers).forEach(key => {
    // Skip content-length as we might modify the body
    if (key.toLowerCase() !== 'content-length') {
      res.setHeader(key, proxyRes.headers[key]);
    }
  });
  res.statusCode = proxyRes.statusCode;

  // Only modify HTML responses
  if (!contentType.includes('text/html')) {
    proxyRes.pipe(res);
    return;
  }

  // Collect the response body
  let body = '';
  proxyRes.on('data', chunk => { body += chunk; });
  proxyRes.on('end', () => {
    // Inject base tag after <head> to fix relative URLs
    const baseTag = `<base href="/proxy/${port}/">`;
    if (body.includes('<head>')) {
      body = body.replace('<head>', `<head>${baseTag}`);
    } else if (body.includes('<HEAD>')) {
      body = body.replace('<HEAD>', `<HEAD>${baseTag}`);
    } else if (body.includes('<html')) {
      body = body.replace(/<html[^>]*>/, `$&<head>${baseTag}</head>`);
    }
    res.end(body);
  });
});

// Handle proxy errors
proxy.on('error', (err, req, res) => {
  if (res && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: ' + err.message);
  }
});

// ============================================
// PTY TEST ENDPOINT
// ============================================

app.get('/api/test-pty', authMiddleware, (req, res) => {
  try {
    const term = pty.spawn('/bin/echo', ['PTY works!'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' }
    });

    let output = '';
    term.onData((data) => { output += data; });
    term.onExit(() => {
      res.json({ success: true, output: output.trim() });
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// ============================================
// WEBSOCKET TERMINAL
// ============================================

wss.on('connection', (ws, req) => {
  // Verify authentication
  const cookies = req.headers.cookie?.split(';').reduce((acc, c) => {
    const [key, val] = c.trim().split('=');
    acc[key] = val;
    return acc;
  }, {}) || {};
  
  const token = cookies.token || new URL(req.url, 'http://localhost').searchParams.get('token');
  
  try {
    jwt.verify(token, SECRET);
  } catch {
    ws.close(1008, 'Unauthorized');
    return;
  }
  
  const url = new URL(req.url, 'http://localhost');
  const sessionName = url.searchParams.get('session');
  const cols = parseInt(url.searchParams.get('cols')) || 80;
  const rows = parseInt(url.searchParams.get('rows')) || 24;
  
  let term;

  try {
    const cwd = getHomeDir();
    const shell = getDefaultShell();

    console.log('Spawning PTY:', { sessionName, shell, cwd, cols, rows, platform: os.platform() });

    if (sessionName && !isWindows) {
      // Attach to existing tmux session (Unix only)
      // Use -d to detach other clients - prevents screen size conflicts
      const tmuxPath = getTmuxPath();
      term = pty.spawn(tmuxPath, ['attach-session', '-d', '-t', sessionName], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });
    } else {
      // Create a new shell (cross-platform)
      const shellArgs = isWindows ? [] : [];
      term = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });
    }
  } catch (error) {
    console.error('PTY spawn failed:', error);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to create terminal: ' + error.message }));
    ws.close(1011, 'PTY spawn failed');
    return;
  }
  
  const termId = Date.now().toString();
  terminals.set(termId, term);
  
  // Send terminal output to WebSocket
  term.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });
  
  term.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    }
    terminals.delete(termId);
  });
  
  // Receive input from WebSocket
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      
      switch (msg.type) {
        case 'input':
          term.write(msg.data);
          break;
        case 'resize':
          term.resize(msg.cols, msg.rows);
          break;
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    term.kill();
    terminals.delete(termId);
  });
  
  // Send ready signal
  ws.send(JSON.stringify({ type: 'ready', termId }));
});

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

// Get tmux install instructions based on platform
function getTmuxInstallHint() {
  if (isWindows) return 'N/A on Windows (use WSL for tmux)';
  if (isMac) return 'run: brew install tmux';
  return 'run: sudo apt install tmux';
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  const tmuxStatus = checkTmux() ? '✓ installed' : `✗ NOT INSTALLED - ${getTmuxInstallHint()}`;
  const platformName = isWindows ? 'Windows' : (isMac ? 'macOS' : 'Linux');

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           Claude Remote Terminal Server                        ║
╠════════════════════════════════════════════════════════════════╣
║   Platform: ${platformName.padEnd(50)}║
║   Server running at: http://localhost:${String(PORT).padEnd(24)}║
║   Default password: ${PASSWORD.padEnd(42)}║
║   tmux status: ${tmuxStatus.substring(0, 47).padEnd(47)}║
╚════════════════════════════════════════════════════════════════╝
  `);
});
