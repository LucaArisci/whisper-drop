#!/bin/bash

set -e

cd "$(dirname "$0")"

if ! bash "$PWD/setup.sh"; then
  echo ""
  echo "Setup failed. Please review the messages above."
  read -n 1 -s -r -p "Press any key to close..."
  echo ""
  exit 1
fi

echo ""
read -n 1 -s -r -p "Setup complete. Press any key to close..."
echo ""
