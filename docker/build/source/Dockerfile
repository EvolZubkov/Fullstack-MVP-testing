FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY dist ./dist
RUN mkdir -p uploads/media uploads/scorm
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
