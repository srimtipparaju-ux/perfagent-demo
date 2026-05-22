#!/bin/bash
# ─────────────────────────────────────────────────────────────
# PerfAgent Demo — Setup Script
# Run once: bash setup.sh
# ─────────────────────────────────────────────────────────────

set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       PerfAgent Demo Setup               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check Node ────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found.${NC}"
  echo "  Install from: https://nodejs.org  (LTS version)"
  echo "  Or with Homebrew: brew install node"
  exit 1
fi

NODE_VER=$(node -v)
echo -e "${GREEN}✓ Node.js ${NODE_VER}${NC}"

# ── Check npm ─────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  echo -e "${RED}✗ npm not found. Reinstall Node.js from nodejs.org${NC}"
  exit 1
fi

echo -e "${GREEN}✓ npm $(npm -v)${NC}"

# ── Verify project structure ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "server.js" ]; then
  echo -e "${RED}✗ server.js not found. Run this script from the perf-demo folder.${NC}"
  exit 1
fi

if [ ! -f "public/index.html" ]; then
  echo -e "${RED}✗ public/index.html not found.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Project files present${NC}"

# ── Create sample-files dir if missing ───────────────────────
mkdir -p sample-files
echo -e "${GREEN}✓ sample-files/ folder ready${NC}"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup complete! No dependencies to install.${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  To start the demo:"
echo -e "  ${YELLOW}node server.js${NC}"
echo ""
echo "  Then open: http://localhost:3737"
echo ""
echo "  Sample files are in:  ./sample-files/"
echo "  Add your own files:   copy .html .txt .log .sql .har .json"
echo ""
echo "  You will need an Anthropic API key:"
echo "  https://console.anthropic.com → API Keys"
echo ""
