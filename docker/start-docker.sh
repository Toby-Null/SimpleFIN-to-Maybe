#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Default to true if not set
USE_DOCKER_DB=${USE_DOCKER_DB:-true}

# Start the appropriate Docker Compose configuration
if [ "$USE_DOCKER_DB" = "true" ]; then
  echo "Starting with Docker PostgreSQL..."
  docker-compose up -d
else
  echo "Starting with external PostgreSQL..."
  docker-compose -f docker-compose.external.yml up -d
fi