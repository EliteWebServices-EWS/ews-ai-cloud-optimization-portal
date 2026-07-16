#!/usr/bin/env bash

set -euo pipefail

FRONTEND_DIR="frontend"
DEPLOY_DIR="${FRONTEND_DIR}/deploy-dist"
DASHBOARD_BUILD_DIR="${FRONTEND_DIR}/dashboard-dist"

echo "Preparing frontend deployment package..."

if [[ ! -d "${DASHBOARD_BUILD_DIR}" ]]; then
  echo "Error: ${DASHBOARD_BUILD_DIR} does not exist."
  echo "Run the frontend build before preparing the deployment package."
  exit 1
fi

rm -rf "${DEPLOY_DIR}"
mkdir -p "${DEPLOY_DIR}"
mkdir -p "${DEPLOY_DIR}/dashboard"

copy_directory() {
  local source_directory="$1"

  if [[ -d "${FRONTEND_DIR}/${source_directory}" ]]; then
    cp -R \
      "${FRONTEND_DIR}/${source_directory}" \
      "${DEPLOY_DIR}/"
  fi
}

copy_file() {
  local source_file="$1"

  if [[ -f "${FRONTEND_DIR}/${source_file}" ]]; then
    cp \
      "${FRONTEND_DIR}/${source_file}" \
      "${DEPLOY_DIR}/"
  fi
}

copy_directory "assets"
copy_directory "js"
copy_directory "pages"
copy_directory "styles"
copy_directory "portal"

copy_file "index.html"
copy_file "master-theme.js"
copy_file ".nojekyll"

cp -R \
  "${DASHBOARD_BUILD_DIR}/." \
  "${DEPLOY_DIR}/dashboard/"

echo "Deployment package created at ${DEPLOY_DIR}"

echo "Deployment package contents:"
find "${DEPLOY_DIR}" -maxdepth 3 -type f | sort