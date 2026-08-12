FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY dist ./dist

# Needed for drizzle-kit db:push (schema + config)
COPY shared ./shared
COPY drizzle.config.ts ./

RUN mkdir -p uploads/media uploads/scorm logs

EXPOSE 5000
CMD ["node", "dist/index.cjs"]
