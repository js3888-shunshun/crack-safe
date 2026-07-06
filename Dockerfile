# syntax=docker/dockerfile:1

# --- Stage 1: build the Angular frontend ---------------------------------
FROM node:20-alpine AS frontend
WORKDIR /repo/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# angular.json outputs the build into ../app/static (i.e. /repo/app/static)
RUN npm run build

# --- Stage 2: Python runtime serving API + built frontend ----------------
FROM python:3.12-slim AS runtime
WORKDIR /srv
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY app/ ./app/
COPY --from=frontend /repo/app/static ./app/static

ENV PORT=5000
EXPOSE 5000
WORKDIR /srv/app

# Production WSGI server. Shell form so ${PORT} is expanded (cloud hosts set it).
CMD gunicorn --bind 0.0.0.0:${PORT:-5000} --workers 2 --threads 4 --timeout 120 app:app
