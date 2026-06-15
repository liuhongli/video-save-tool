import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import BackgroundTasks, FastAPI, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
MAX_DOWNLOAD_SECONDS = int(os.getenv("MAX_DOWNLOAD_SECONDS", "180"))

app = FastAPI(title="Video Save Tool")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def validate_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Please enter a valid video URL.")
    return parsed.geturl()


def cleanup_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/download")
async def download(background_tasks: BackgroundTasks, url: str = Form(...)) -> FileResponse:
    video_url = validate_url(url)

    if shutil.which("yt-dlp") is None:
        raise HTTPException(
            status_code=500,
            detail="yt-dlp is not installed on this server.",
        )

    work_dir = Path(tempfile.mkdtemp(prefix="video-save-"))
    output_template = str(work_dir / "%(title).180s.%(ext)s")
    command = [
        "yt-dlp",
        "--no-playlist",
        "--restrict-filenames",
        "--max-filesize",
        os.getenv("MAX_FILESIZE", "250M"),
        "-o",
        output_template,
        video_url,
    ]

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=MAX_DOWNLOAD_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        cleanup_dir(work_dir)
        raise HTTPException(status_code=504, detail="Download timed out.") from exc

    if process.returncode != 0:
        cleanup_dir(work_dir)
        message = (stderr or stdout).decode("utf-8", errors="replace")[-800:]
        raise HTTPException(status_code=400, detail=message or "Download failed.")

    files = [path for path in work_dir.iterdir() if path.is_file()]
    if not files:
        cleanup_dir(work_dir)
        raise HTTPException(status_code=400, detail="No video file was created.")

    video_path = max(files, key=lambda path: path.stat().st_size)
    background_tasks.add_task(cleanup_dir, work_dir)

    return FileResponse(
        video_path,
        media_type="application/octet-stream",
        filename=video_path.name,
        background=background_tasks,
    )
