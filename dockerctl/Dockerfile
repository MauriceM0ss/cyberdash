# Pinned by digest for reproducible builds. To update: pull the new
# python:3.12-slim, read `docker inspect --format '{{index .RepoDigests 0}}'`,
# and replace the digest below.
FROM python:3.12-slim@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Runs as a non-root user. Socket access comes from the supplementary docker
# group added in docker-compose.yml, not from being root — so a bug in this
# process is not automatically root inside the container.
RUN useradd --system --uid 10001 dockerctl
USER 10001

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4).status==200 else 1)"]

CMD ["python", "app.py"]
