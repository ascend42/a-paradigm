#!/bin/bash
# Paradigm Installation Script
# Downloads, builds, and installs Paradigm CLI from source
#
# IMPORTANT: npm install -g creates symlinks back to source files.
# We clone to ~/.paradigm-cli/ (permanent) so symlinks survive.
# Do NOT delete ~/.paradigm-cli/ or the CLIs will break.

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/ascend42/a-paradigm.git"
INSTALL_DIR="$HOME/.paradigm-cli"

echo -e "${BLUE}"
echo "╔═╗┌─┐┬─┐┌─┐┌┬┐┬ ┌─┐┌┬┐"
echo "╠═╝├─┤├┬┘├─┤ │││ ├─┐│││"
echo "╩  ┴ ┴┴└─┴ ┴─┴┘┴ └─┘┴ ┴"
echo -e "${NC}"
echo "Paradigm Installation Script"
echo "=============================="
echo ""

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version 18+ required (found v$NODE_VERSION)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Git $(git --version)${NC}"
echo ""

# Clone or update repository
if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "${BLUE}Updating existing installation...${NC}"
    cd "$INSTALL_DIR"
    git fetch --quiet origin
    git reset --quiet --hard origin/main
    echo -e "${GREEN}✓ Updated to latest${NC}"
else
    if [ -d "$INSTALL_DIR" ]; then
        echo -e "${YELLOW}Removing incomplete installation at $INSTALL_DIR...${NC}"
        rm -rf "$INSTALL_DIR"
    fi
    echo -e "${BLUE}Downloading Paradigm...${NC}"
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    echo -e "${GREEN}✓ Downloaded${NC}"
fi

PARADIGM_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}✓ Paradigm v$PARADIGM_VERSION${NC}"
echo ""

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
if ! npm install --silent; then
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Build all packages
echo -e "${BLUE}Building Paradigm...${NC}"
if ! npm run build --silent; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Capture npm prefix for verification later
NPM_PREFIX="$(npm config get prefix)"

# Install CLIs globally (creates symlinks back to $INSTALL_DIR)
echo -e "${BLUE}Installing CLIs globally...${NC}"

cd "$INSTALL_DIR/packages/paradigm"
if ! npm install -g . --silent; then
    echo -e "${RED}❌ Failed to install paradigm CLI${NC}"
    echo "If you see a permissions error, try: sudo npm install -g ."
    exit 1
fi
echo -e "${GREEN}✓ paradigm CLI installed${NC}"

cd "$INSTALL_DIR/packages/paradigm-mcp"
if ! npm install -g . --silent; then
    echo -e "${RED}❌ Failed to install paradigm-mcp${NC}"
    echo "If you see a permissions error, try: sudo npm install -g ."
    exit 1
fi
echo -e "${GREEN}✓ paradigm-mcp server installed${NC}"
echo ""

# Return to a safe cwd
cd "$HOME"

# Verify installation
echo -e "${BLUE}Verifying installation...${NC}"

PARADIGM_BIN="$NPM_PREFIX/bin/paradigm"
MCP_BIN="$NPM_PREFIX/bin/paradigm-mcp"

VERIFY_OK=true

if [ -f "$PARADIGM_BIN" ] || [ -L "$PARADIGM_BIN" ]; then
    INSTALLED_VERSION=$("$PARADIGM_BIN" --version 2>&1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
    echo -e "${GREEN}✓ paradigm v${INSTALLED_VERSION:-unknown}${NC}"
else
    echo -e "${RED}✗ paradigm CLI not found${NC}"
    VERIFY_OK=false
fi

if [ -f "$MCP_BIN" ] || [ -L "$MCP_BIN" ]; then
    echo -e "${GREEN}✓ paradigm-mcp${NC}"
else
    echo -e "${YELLOW}⚠ paradigm-mcp not found (optional, for AI integration)${NC}"
fi

if [ "$VERIFY_OK" = false ]; then
    echo ""
    echo -e "${RED}❌ Installation failed${NC}"
    echo "You may need to add npm global bin to your PATH:"
    echo "  export PATH=\"\$PATH:$NPM_PREFIX/bin\""
    exit 1
fi

# Check if npm bin is in PATH
if ! command -v paradigm &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Note: Add npm global bin to your PATH:${NC}"
    echo "  export PATH=\"\$PATH:$NPM_PREFIX/bin\""
    echo ""
    echo "Add this to your ~/.zshrc or ~/.bashrc to make it permanent."
fi

# Done
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Paradigm installed successfully! 🎉  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo "Source installed to: $INSTALL_DIR"
echo -e "${YELLOW}⚠ Do not delete $INSTALL_DIR — the CLIs link to it.${NC}"
echo ""
echo "Next steps:"
echo "  1. Navigate to your project: cd /path/to/your/project"
echo "  2. Run the setup command:"
echo ""
echo -e "     ${YELLOW}paradigm shift${NC}"
echo ""
echo "That's it! This single command will:"
echo "  • Initialize .paradigm/ directory"
echo "  • Generate IDE files (CLAUDE.md, .cursor/rules/, etc.)"
echo "  • Configure MCP for AI tools"
echo "  • Set up the auto-documenting protocol"
echo ""
echo "To update:  curl -fsSL https://raw.githubusercontent.com/ascend42/a-paradigm/main/install.sh | bash"
echo "To uninstall: npm uninstall -g @a-company/paradigm @a-company/paradigm-mcp && rm -rf $INSTALL_DIR"
echo ""
echo "Documentation: https://github.com/ascend42/a-paradigm"
