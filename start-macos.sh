#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo
echo "========================================"
echo "GPT Image Playground Launcher"
echo "========================================"
echo

if [ ! -f "package.json" ]; then
    echo "[ERROR] package.json was not found. Please keep this file in the project root."
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js was not found."
    echo "Please install Node.js 22.15.0 or later: https://nodejs.org/"
    exit 1
fi

if ! node -e "import('./scripts/node-version.mjs').then(function(module){process.exit(module.isSupportedNodeVersion()?0:1)})"; then
    echo "[ERROR] Node.js version is too old."
    echo "Current version:"
    node -v
    echo "Required: Node.js 22.15.0 or later. Download: https://nodejs.org/"
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] npm was not found. Please reinstall Node.js 22.15.0 or later."
    exit 1
fi

if ! node -e "const net=require('net'); const s=net.createServer(); s.once('error',()=>process.exit(1)); s.once('listening',()=>s.close(()=>process.exit(0))); s.listen(4783)" >/dev/null 2>&1; then
    echo "[ERROR] Port 4783 is already in use. Please stop the existing service and run this script again."
    exit 1
fi

if [ ! -f ".env.local" ]; then
    if [ -f ".env.example" ]; then
        cp ".env.example" ".env.local"
        echo "[INFO] Created .env.local from .env.example."
        echo "[INFO] You can edit .env.local or use API Settings in the browser."
        echo
    else
        echo "[WARN] .env.example was not found. Skipping env file setup."
        echo
    fi
else
    echo "[INFO] .env.local found."
fi

if node scripts/dependency-installation.mjs; then
    echo "[INFO] Dependencies match package-lock.json. Skipping installation."
else
    echo "[INFO] Dependencies are missing or incomplete. Installing from package-lock.json. This may take a few minutes."
    echo
    if ! npm run install-scripts:check; then
        echo "[ERROR] Dependency install script policy validation failed."
        exit 1
    fi
    if ! node scripts/npm-install-policy.mjs; then
        echo "[ERROR] Current npm does not support --strict-allow-scripts. Upgrade npm before installing dependencies."
        exit 1
    fi
    if ! npm ci --strict-allow-scripts; then
        echo "[ERROR] Dependency installation failed. Please check the network and run again."
        exit 1
    fi
    if ! npm run dependencies:check; then
        echo "[ERROR] Dependency installation completed with an incomplete package tree. Please run the install command again."
        exit 1
    fi
fi

echo
echo "[INFO] Starting local server. Keep this terminal open."
echo "[INFO] Browser URL: http://localhost:4783"
echo "[INFO] If the browser does not open automatically, copy the URL above."
echo

(sleep 5; open "http://localhost:4783" >/dev/null 2>&1 || true) &
PORT=4783 npm run dev
