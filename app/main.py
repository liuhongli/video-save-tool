import asyncio
import mimetypes
import os
import re
import shutil
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from fastapi import BackgroundTasks, FastAPI, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
MAX_DOWNLOAD_SECONDS = int(os.getenv("MAX_DOWNLOAD_SECONDS", "180"))
FILE_TTL_SECONDS = int(os.getenv("FILE_TTL_SECONDS", "1800"))
PROGRESS_PATTERN = re.compile(r"\[download\]\s+(\d+(?:\.\d+)?)%")
URL_PATTERN = re.compile(r"https?://[^\s]+")

app = FastAPI(title="Video Save Tool")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
jobs: dict[str, "DownloadJob"] = {}


@dataclass
class DownloadJob:
    id: str
    url: str
    work_dir: Path
    status: str = "queued"
    progress: int = 0
    message: str = "等待下载"
    filename: str | None = None
    file_path: Path | None = None
    error: str | None = None


def validate_url(url: str) -> str:
    match = URL_PATTERN.search(url.strip())
    if not match:
        raise HTTPException(status_code=400, detail="请粘贴视频链接或包含链接的分享文案。")

    raw_url = match.group(0).rstrip("，。；;、,)")
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="请粘贴有效的视频链接。")
    return parsed.geturl()


def cleanup_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


async def cleanup_job_later(job_id: str) -> None:
    await asyncio.sleep(FILE_TTL_SECONDS)
    job = jobs.pop(job_id, None)
    if job:
        cleanup_dir(job.work_dir)


async def run_download(job: DownloadJob) -> None:
    output_template = str(job.work_dir / "%(title).180s.%(ext)s")
    command = [
        "yt-dlp",
        "--newline",
        "--no-playlist",
        "--restrict-filenames",
        "--max-filesize",
        os.getenv("MAX_FILESIZE", "250M"),
        "-o",
        output_template,
        job.url,
    ]

    job.status = "downloading"
    job.message = "正在解析视频"

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        output_lines: list[str] = []

        async def read_output() -> None:
            assert process.stdout is not None
            async for raw_line in process.stdout:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line:
                    output_lines.append(line)
                match = PROGRESS_PATTERN.search(line)
                if match:
                    job.progress = min(99, int(float(match.group(1))))
                    job.message = f"正在下载 {job.progress}%"

        output_task = asyncio.create_task(read_output())

        try:
            await asyncio.wait_for(process.wait(), timeout=MAX_DOWNLOAD_SECONDS)
            await output_task
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            job.status = "error"
            job.error = "下载超时，请稍后重试。"
            return

        if process.returncode != 0:
            job.status = "error"
            job.error = "\n".join(output_lines)[-800:] or "下载失败。"
            return

        files = [path for path in job.work_dir.iterdir() if path.is_file()]
        if not files:
            job.status = "error"
            job.error = "没有生成视频文件。"
            return

        video_path = max(files, key=lambda path: path.stat().st_size)
        job.file_path = video_path
        job.filename = video_path.name
        job.progress = 100
        job.status = "ready"
        job.message = "下载完成"
        asyncio.create_task(cleanup_job_later(job.id))
    except Exception as exc:
        job.status = "error"
        job.error = str(exc)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/jobs")
async def create_job(background_tasks: BackgroundTasks, url: str = Form(...)) -> JSONResponse:
    video_url = validate_url(url)

    if shutil.which("yt-dlp") is None:
        raise HTTPException(
            status_code=500,
            detail="yt-dlp is not installed on this server.",
        )

    job_id = uuid.uuid4().hex
    job = DownloadJob(
        id=job_id,
        url=video_url,
        work_dir=Path(tempfile.mkdtemp(prefix="video-save-")),
    )
    jobs[job_id] = job
    background_tasks.add_task(run_download, job)
    return JSONResponse({"id": job_id})


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> JSONResponse:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="下载任务不存在或已过期。")

    return JSONResponse(
        {
            "id": job.id,
            "status": job.status,
            "progress": job.progress,
            "message": job.message,
            "error": job.error,
            "filename": job.filename,
            "previewUrl": f"/api/jobs/{job.id}/file" if job.status == "ready" else None,
            "saveUrl": f"/api/jobs/{job.id}/save" if job.status == "ready" else None,
        }
    )


def get_ready_job(job_id: str) -> DownloadJob:
    job = jobs.get(job_id)
    if not job or job.status != "ready" or not job.file_path or not job.file_path.exists():
        raise HTTPException(status_code=404, detail="视频不存在或已过期。")
    return job


@app.get("/api/jobs/{job_id}/file")
async def preview_file(job_id: str) -> FileResponse:
    job = get_ready_job(job_id)
    media_type = mimetypes.guess_type(job.file_path.name)[0] or "video/mp4"
    return FileResponse(job.file_path, media_type=media_type, filename=job.filename)


@app.get("/api/jobs/{job_id}/save")
async def save_file(job_id: str) -> FileResponse:
    job = get_ready_job(job_id)
    return FileResponse(
        job.file_path,
        media_type="application/octet-stream",
        filename=job.filename,
    )
