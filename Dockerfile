# Use the official lightweight Node.js active LTS image.
# https://hub.docker.com/_/node
FROM node:22-alpine

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure copying both package.json AND package-lock.json (if available).
COPY package*.json ./

# Install production dependencies.
# If you have a package-lock.json, npm ci will be used instead of npm install.
RUN npm install --only=production --legacy-peer-deps

# Copy local code to the container image.
COPY . .

# Service must listen to $PORT environment variable.
# Cloud Run dynamically injects $PORT. Express server in index.js is already configured to listen on process.env.PORT.
EXPOSE 8080

# Run the web service on container startup.
CMD [ "node", "--experimental-require-module", "index.js" ]
