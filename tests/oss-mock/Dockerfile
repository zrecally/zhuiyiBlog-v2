FROM node:22-alpine

WORKDIR /app
COPY server.mjs ./server.mjs
COPY ui.html ./ui.html

ENV OSS_MOCK_PORT=9000 \
    OSS_MOCK_DATA_DIR=/data
EXPOSE 9000
VOLUME ["/data"]

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:9000/healthz | grep -qx ok

CMD ["node", "server.mjs"]
