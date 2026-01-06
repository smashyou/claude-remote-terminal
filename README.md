# Claude Remote Terminal

Access your home Mac's terminal from anywhere — designed for continuing Claude Code CLI sessions remotely.

![Terminal Interface](https://via.placeholder.com/800x450/09090b/22d3ee?text=Claude+Remote+Terminal)

## Features

- **tmux Session Management** — Create, attach to, and manage tmux sessions
- **Session Continuity** — Continue Claude Code conversations from anywhere
- **Full Terminal** — Complete terminal access with streaming output
- **Dev Server Proxy** — View your running localhost apps remotely
- **Mobile Friendly** — Works on phone browsers
- **Simple Auth** — Password protection (designed for VPN use)

---

## Quick Start

### 1. Install Prerequisites

```bash
# Install tmux (if not already installed)
brew install tmux

# Install Node.js (if not already installed)
brew install node
```

### 2. Setup the Project

```bash
# Clone/copy the project to your home Mac
cd ~/claude-remote-terminal

# Install dependencies
npm install

# Create your config
cp .env.example .env

# Edit .env and set a strong password
nano .env
```

### 3. Start the Server

```bash
npm start
```

You should see:
```
╔════════════════════════════════════════════════════════════════╗
║           Claude Remote Terminal Server                        ║
╠════════════════════════════════════════════════════════════════╣
║   Server running at: http://localhost:8080                     ║
║   Default password: your-password                              ║
║   tmux status: ✓ installed                                     ║
╚════════════════════════════════════════════════════════════════╝
```

### 4. Access Remotely

1. Connect to your home network via VPN
2. Open `http://your-mac-ip:8080` in any browser
3. Enter your password
4. You're in!

---

## How to Use with Claude Code

### Your New Workflow

**Instead of:**
```bash
cd ~/projects/my-app
claude -c --dangerously-skip-permissions
```

**Do this:**
```bash
cd ~/projects/my-app
tmux new -s myapp
claude -c --dangerously-skip-permissions
```

That's it! Now you can:
- Close your laptop and leave home
- Open the web interface on your phone/work laptop
- Click on `myapp` session
- Continue exactly where you left off

### Key Concept

`tmux` keeps your terminal session alive even when you disconnect. Multiple devices can attach to the same session and see the same thing in real-time.

---

## tmux Cheat Sheet

Don't worry, you only need to know a few commands:

### Essential Commands

| Command | What it does |
|---------|--------------|
| `tmux new -s name` | Create a new session called "name" |
| `tmux attach -t name` | Attach to existing session |
| `tmux ls` | List all sessions |
| `tmux kill-session -t name` | Kill a session |

### Inside tmux (Keyboard Shortcuts)

All tmux shortcuts start with `Ctrl+B`, then another key:

| Shortcut | What it does |
|----------|--------------|
| `Ctrl+B` then `D` | **Detach** (leave session running, go back to normal shell) |
| `Ctrl+B` then `C` | Create new window (tab) |
| `Ctrl+B` then `N` | Next window |
| `Ctrl+B` then `P` | Previous window |
| `Ctrl+B` then `0-9` | Go to window by number |
| `Ctrl+B` then `[` | Scroll mode (use arrows, `q` to exit) |

### Pro Tips

1. **Name sessions by project:**
   ```bash
   tmux new -s webapp
   tmux new -s api-server
   tmux new -s scripts
   ```

2. **Quick attach if only one session:**
   ```bash
   tmux a  # short for "tmux attach"
   ```

3. **Start in specific directory:**
   ```bash
   tmux new -s myapp -c ~/projects/myapp
   ```

---

## Running as a Background Service

### Option 1: Keep Terminal Open

Just run `npm start` in a terminal window and leave it.

### Option 2: Use tmux (meta, I know)

```bash
tmux new -s server
npm start
# Press Ctrl+B then D to detach
```

### Option 3: launchd (Auto-start on boot)

Create `~/Library/LaunchAgents/com.claude-remote.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-remote</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/YOUR_USERNAME/claude-remote-terminal/src/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/claude-remote-terminal</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/claude-remote.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/claude-remote.error.log</string>
</dict>
</plist>
```

Then:
```bash
launchctl load ~/Library/LaunchAgents/com.claude-remote.plist
```

---

## VPN Setup Tips

Since you're accessing via VPN, here are some options:

### Tailscale (Recommended - Free & Easy)

1. Install Tailscale on your Mac: `brew install tailscale`
2. Install Tailscale on your phone/other devices
3. Access via `http://your-mac-tailscale-ip:8080`

### WireGuard

If you already have WireGuard set up, just use your Mac's WireGuard IP.

### Router Port Forwarding (Not Recommended)

You *could* forward port 8080, but this exposes your machine to the internet. If you do this:
- Use HTTPS (see below)
- Use a very strong password
- Consider fail2ban or similar

---

## HTTPS Setup (Optional)

For local network/VPN use, HTTP is fine. For anything else, add HTTPS:

### Self-Signed Certificate

```bash
# Generate certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Update server.js to use HTTPS (or use nginx as reverse proxy)
```

### Using Caddy as Reverse Proxy

```bash
brew install caddy

# Caddyfile
:443 {
    reverse_proxy localhost:8080
}
```

---

## Troubleshooting

### "tmux not installed"

```bash
brew install tmux
```

### "Cannot connect to localhost:XXXX" in proxy

The dev server might be bound to `127.0.0.1` only. Try starting your dev server with:

```bash
npm run dev -- --host 0.0.0.0
# or
vite --host 0.0.0.0
```

### Terminal not responding

1. Check if tmux session still exists: `tmux ls`
2. Try refreshing the page
3. Check server logs

### Session shows as "attached" but I'm not connected

Another window might be attached. tmux allows multiple connections, so this is usually fine.

---

## Security Considerations

This tool is designed for **VPN access only**. If you must expose it to the internet:

1. **Always use HTTPS**
2. **Use a strong, unique password**
3. **Consider additional auth** (Cloudflare Access, OAuth, etc.)
4. **Monitor logs** for suspicious activity
5. **Keep Node.js updated**

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/login` | POST | Authenticate with password |
| `/api/logout` | POST | Clear session |
| `/api/auth-status` | GET | Check if authenticated |
| `/api/sessions` | GET | List tmux sessions |
| `/api/sessions` | POST | Create new session |
| `/api/sessions/:name` | DELETE | Kill session |
| `/api/ports` | GET | List listening ports |
| `/proxy/:port/*` | ANY | Proxy to localhost:port |

WebSocket at `/` accepts:
- `?session=name` — Attach to tmux session
- No session param — New standalone shell

---

## License

MIT — Use freely, modify as needed.

---

## Contributing

This is a personal tool, but suggestions welcome! The main areas for improvement:

- [ ] Multiple terminal tabs
- [ ] File browser
- [ ] Session groups
- [ ] Better mobile keyboard support
- [ ] Notification when Claude responds
