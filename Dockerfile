# Runs the OmniContext MCP server over stdio. The bundle has no runtime dependencies.
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY dist/omnicontext.mjs ./dist/omnicontext.mjs
ENV OMNICONTEXT_HOME=/data
VOLUME /data
ENTRYPOINT ["node", "dist/omnicontext.mjs", "mcp"]
