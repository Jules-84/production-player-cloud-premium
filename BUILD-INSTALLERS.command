#!/bin/bash
cd "$(dirname "$0")"
echo "Installing build requirements..."
npm install
echo
echo "Choose an installer:"
echo "1 - Build Mac DMG"
echo "2 - Build Windows installer"
echo "3 - Build both"
read -p "Enter 1, 2 or 3: " choice

case "$choice" in
  1) npm run build-mac-installer ;;
  2) npm run build-windows-installer ;;
  3) npm run build-all ;;
  *) echo "Invalid choice." ;;
esac

echo
echo "Finished. Check the dist folder."
read -p "Press Return to close."
