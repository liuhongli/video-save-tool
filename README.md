# Video Save Tool

A small FastAPI web app that lets users paste a public video URL and download the resulting file through `yt-dlp`.

Use it only for videos you own, have permission to download, or where the platform/creator allows saving.

## Local setup

```bash
brew install yt-dlp
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`.

## Deploy with GitHub + Render

GitHub can host the source code, but GitHub Pages cannot run this app because it needs a server process and `yt-dlp`.

The included `Dockerfile` and `render.yaml` are ready for Render.

1. Create a GitHub repository and push this folder.
2. Open Render and create a new Blueprint or Web Service from that repository.
3. If Render asks for runtime, choose Docker.
4. Deploy.

Render will install Python dependencies, `yt-dlp`, and `ffmpeg` inside the Docker image.

Free hosting may sleep when idle and may have bandwidth/time limits.

## Limits

Optional environment variables:

- `MAX_FILESIZE`: defaults to `250M`
- `MAX_DOWNLOAD_SECONDS`: defaults to `180`
