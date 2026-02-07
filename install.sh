#!/bin/bash
# Paradigm Installation Script
# Downloads, builds, and installs Paradigm CLI from source

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/ascend42/a-paradigm.git"
TEMP_DIR="/tmp/paradigm-install-$$"
INSTALL_TYPE="${1:-global}"  # global or local

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

# Clone repository
echo -e "${BLUE}Downloading Paradigm...${NC}"
if [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

git clone --quiet "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"

PARADIGM_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}✓ Downloaded Paradigm v$PARADIGM_VERSION${NC}"
echo ""

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
npm install --silent
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Build
echo -e "${BLUE}Building Paradigm...${NC}"
npm run build --silent
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Pack tarball (avoids cwd issues when temp dir is deleted)
echo -e "${BLUE}Packing...${NC}"
cd "$TEMP_DIR/packages/paradigm"
TARBALL=$(npm pack --silent 2>/dev/null)
cd "$HOME"

# Install
if [ "$INSTALL_TYPE" = "local" ]; then
    echo -e "${BLUE}Installing locally (current project)...${NC}"
    npm install "$TEMP_DIR/packages/paradigm/$TARBALL"
    echo -e "${GREEN}✓ Installed locally${NC}"
else
    echo -e "${BLUE}Installing globally...${NC}"
    npm install -g "$TEMP_DIR/packages/paradigm/$TARBALL" --silent
    echo -e "${GREEN}✓ Installed globally${NC}"
fi

# Cleanup
echo ""
echo -e "${BLUE}Cleaning up...${NC}"
rm -rf "$TEMP_DIR"
echo -e "${GREEN}✓ Cleanup complete${NC}"

# Verify installation
echo ""
echo -e "${BLUE}Verifying installation...${NC}"

# Resolve the npm global bin path directly (command -v won't work in piped shells)
NPM_BIN="$(npm config get prefix)/bin"
PARADIGM_BIN="$NPM_BIN/paradigm"

if [ -f "$PARADIGM_BIN" ] || command -v paradigm &> /dev/null; then
    INSTALLED_VERSION=$("${PARADIGM_BIN:-paradigm}" --version 2>&1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
    echo -e "${GREEN}✓ Paradigm v$INSTALLED_VERSION installed successfully${NC}"

    # Check if npm bin is in PATH
    if ! command -v paradigm &> /dev/null; then
        echo ""
        echo -e "${YELLOW}Note: Add npm global bin to your PATH if not already:${NC}"
        echo "  export PATH=\"\$PATH:$NPM_BIN\""
    fi
else
    echo -e "${RED}❌ Installation verification failed${NC}"
    echo "You may need to add npm global bin to your PATH:"
    echo "  export PATH=\"\$PATH:$NPM_BIN\""
    exit 1
fi

# Done
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Paradigm installed successfully! 🎉  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
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
echo "Options:"
echo "  paradigm shift --quick     # Skip indexing (faster)"
echo "  paradigm shift --verify    # Include health checks"
echo ""
echo "Documentation: https://github.com/ascend42/a-paradigm"
