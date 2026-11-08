FROM node:26.5.0-alpine3.24

WORKDIR /app

# Production dependencies only, exactly as in package-lock.json
COPY package*.json ./
RUN npm ci --omit=dev

# Amazon RDS CA bundle (public certificates): lets the app verify the database
# server certificate when DB_SSL=verify-full (AWS). Unused locally.
RUN mkdir -p /app/certs     # world-readable dir (ADD would create it without read access for "node")
ARG RDS_CA_BUNDLE_URL=https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
ADD --chmod=0644 ${RDS_CA_BUNDLE_URL} /app/certs/rds-global-bundle.pem

COPY server.js ./
COPY views ./views
COPY public ./public

# Run as the unprivileged "node" user from the base image
USER node

EXPOSE 3000

# Container health check (ECS uses the one in the task definition; same command)
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1

# exec form: node is PID 1 and receives SIGTERM from ECS (npm start would not forward it)
CMD ["node", "server.js"]
