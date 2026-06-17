# Pinned (not :latest) — a floating Bun pulled in 1.3.14, which crashes on
# bson's node:v8 isBuildingSnapshot() call. Bump deliberately after testing.
FROM oven/bun:1.3.10
WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy the entire application code
COPY . .

# Expose the port (Porter uses 80)
EXPOSE 80
