#!/bin/bash
# Fix script to use Node 20 with node-pty

echo "=== Node.js Version Fix for node-pty ==="
echo ""

# Check current node version
echo "Current Node version: $(node --version)"

# Check if node@20 is available via brew
if [ -f "/usr/local/opt/node@20/bin/node" ]; then
    echo "Node 20 is installed via brew"
    NODE20_PATH="/usr/local/opt/node@20/bin"
    echo "Node 20 version: $($NODE20_PATH/node --version)"
else
    echo "Node 20 not found. Installing via brew..."
    brew install node@20
    NODE20_PATH="/usr/local/opt/node@20/bin"
fi

echo ""
echo "=== To use Node 20 for this project, run: ==="
echo ""
echo "export PATH=\"/usr/local/opt/node@20/bin:\$PATH\""
echo "rm -rf node_modules"
echo "npm install"
echo "npm start"
echo ""
echo "Or add this to your ~/.bashrc or ~/.zshrc for permanent fix:"
echo "export PATH=\"/usr/local/opt/node@20/bin:\$PATH\""
