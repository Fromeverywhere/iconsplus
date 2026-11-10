FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies without running lifecycle scripts
COPY package*.json ./
RUN npm install --progress=false --ignore-scripts

# sharp ships prebuilt libvips binaries as optional dependencies. This is a soft
# check only: if a binary is missing (e.g. under QEMU multi-arch builds) the image
# still builds and the site silently falls back to serving the original images.
RUN node -e "try{require('sharp');console.log('sharp ready')}catch(e){console.warn('sharp unavailable, thumbnails disabled:',e.message)}"

# Copy required sources
COPY build.js ./build.js
COPY server/ ./server/
COPY static/ ./static/
COPY views/ ./views/

# Build static assets explicitly
RUN node build.js

# Keep bundled icons outside /app/images so bind mounts cannot hide them
COPY images/ /app/default-images/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Git on Windows may check out .sh files with CRLF; a CR after #!/bin/sh makes
# the kernel fail with "no such file or directory". Normalize inside the image
# so the build works regardless of the host's core.autocrlf setting.
RUN tr -d '\r' < /usr/local/bin/docker-entrypoint.sh > /usr/local/bin/docker-entrypoint.lf \
    && mv /usr/local/bin/docker-entrypoint.lf /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

# Thumbnails live in a container-local directory: bind mounts on /app/images can
# neither hide them nor get polluted by generated files. All values below can be
# overridden via `docker run -e` / compose `environment`.
ENV THUMB_DIR=/app/thumbs \
    THUMB_ENABLED=true \
    THUMB_WATCH=true \
    THUMB_SCAN_INTERVAL=300 \
    ADMIN_USERNAME=admin \
    ADMIN_PASSWORD=iconsplus \
    HOTLINK_ENABLED=true \
    HOTLINK_ALLOWLIST=localhost \
    HOTLINK_ALLOW_EMPTY_REFERER=true \
    SUBMISSION_RATE_LIMIT=20

EXPOSE 5000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
