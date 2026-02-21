FROM node:20-slim
WORKDIR /app
COPY package.json ./
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services
RUN npm install
EXPOSE 3000
CMD ["npm", "run", "dev:web"]
