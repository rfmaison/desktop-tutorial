FROM node:22-alpine
WORKDIR /app
COPY package.json server.js db.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/inventory.db
VOLUME /data
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
