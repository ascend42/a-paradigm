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

# Install
if [ "$INSTALL_TYPE" = "local" ]; then
    echo -e "${BLUE}Installing locally (current project)...${NC}"
    npm pack --silent
    PACKAGE_FILE=$(ls paradigm-*.tgz)
    cd "$OLDPWD"
    npm install "$TEMP_DIR/$PACKAGE_FILE"
    echo -e "${GREEN}✓ Installed locally${NC}"
else
    echo -e "${BLUE}Installing globally...${NC}"
    cd "$TEMP_DIR/packages/paradigm"
    npm link --silent
    echo -e "${GREEN}✓ Installed globally${NC}"
fi

cd "$OLDPWD"

# Cleanup
echo ""
echo -e "${BLUE}Cleaning up...${NC}"
rm -rf "$TEMP_DIR"
echo -e "${GREEN}✓ Cleanup complete${NC}"

# Verify installation
echo ""
echo -e "${BLUE}Verifying installation...${NC}"
if command -v paradigm &> /dev/null; then
    INSTALLED_VERSION=$(paradigm --version 2>&1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
    echo -e "${GREEN}✓ Paradigm v$INSTALLED_VERSION installed successfully${NC}"
else
    echo -e "${RED}❌ Installation verification failed${NC}"
    echo "You may need to add npm global bin to your PATH:"
    echo "  export PATH=\"\$PATH:\$(npm config get prefix)/bin\""
    exit 1
fi

# Done
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Paradigm installed successfully! 🎉  ║${NC}"
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo ""
echo "Next steps:"
echo "  1. Navigate to your project: cd /path/to/your/project"
echo "  2. Run quick setup:"
echo ""
echo -e "     ${YELLOW}paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon${NC}"
echo ""
echo "Or run individual commands:"
echo "  paradigm init --quick      # Initialize .paradigm/"
echo "  paradigm sync --all        # Generate IDE files"
echo "  paradigm mcp setup --all   # Configure MCP"
echo "  paradigm doctor            # Verify setup"
echo ""
echo "Documentation: https://github.com/ascend42/a-paradigm"
