ARG GODOT_IMAGE=quay.io/decentraland/godot-explorer:8ed31d84089cba0d4c37243ed48160ad6cd6f6ff

FROM ${GODOT_IMAGE}
ARG GODOT_IMAGE
ENV GODOT_IMAGE_REF=${GODOT_IMAGE}

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /service

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public
COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

ENV PORT=3000 \
    GODOT_BIN=/app/decentraland.godot.client.x86_64 \
    GODOT_WORKDIR=/app \
    DISPLAY=:99

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/start.sh"]
