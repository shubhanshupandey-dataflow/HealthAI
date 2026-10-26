# Dental AI Receptionist - one image for the backend (API + admin panel) and the voice agent.
# docker-compose.yml runs it twice: as the backend (default command) and as the agent.
# Keys come from the environment (env_file: .env) - .env itself is never copied into the image.

# ---- 1. build the admin panel (React + Vite) -> admin/dist
FROM node:24-slim AS admin
WORKDIR /admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY admin/ ./
RUN npm run build

# ---- 2. Python runtime
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ backend/
COPY agent/ agent/
COPY --from=admin /admin/dist admin/dist

RUN useradd --create-home --uid 1000 sophie \
    && mkdir -p data .cache \
    && chown -R sophie:sophie data .cache
USER sophie

# SQLite database (seeded with the demo clinic on first start when empty) - mounted as a volume.
VOLUME ["/app/data"]
EXPOSE 8000

# Backend by default; the agent service overrides this with: python agent/agent.py start
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
