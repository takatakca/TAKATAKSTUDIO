# TAKATAK Control Room web app. No npm dependency: Node built-ins only.
FROM node:22.23.4-bookworm-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data RECORDINGS_DIR=/recordings NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY package.json server.mjs ./
COPY lib ./lib
COPY bin ./bin
COPY public ./public
RUN mkdir -p /data /recordings && chown -R node:node /data /recordings
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
