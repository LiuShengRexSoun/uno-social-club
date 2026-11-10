FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY shared ./shared
COPY server ./server
RUN mkdir -p /data/uno && chown node:node /data/uno
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10889 UNO_DATA_DIR=/data/uno
EXPOSE 10889
CMD ["node", "--import", "tsx", "server/index.ts"]
