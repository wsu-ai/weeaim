# WEEAIM API -- production image (deployed on Render; see render.yaml and
# docs/deploy-vercel-render-supabase.md).
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts
COPY docker-entrypoint.sh .

# Run as an unprivileged user; uploads go to UPLOAD_STORAGE_DIR (a mounted
# persistent disk in production), which must be writable by this user.
RUN useradd --create-home --uid 10001 weeaim \
    && mkdir -p /var/data/uploads \
    && chown -R weeaim:weeaim /app /var/data \
    && chmod +x docker-entrypoint.sh
USER weeaim

ENV PORT=8000
EXPOSE 8000

CMD ["./docker-entrypoint.sh"]
