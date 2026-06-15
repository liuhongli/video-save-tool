const form = document.querySelector("#downloadForm");
const urlInput = document.querySelector("#url");
const submitButton = document.querySelector("#submitButton");
const statusPanel = document.querySelector("#statusPanel");
const statusText = document.querySelector("#statusText");
const percentText = document.querySelector("#percentText");
const progressBar = document.querySelector("#progressBar");
const previewPanel = document.querySelector("#previewPanel");
const videoPreview = document.querySelector("#videoPreview");
const saveToAlbumButton = document.querySelector("#saveToAlbumButton");
const downloadLink = document.querySelector("#downloadLink");
const saveHint = document.querySelector("#saveHint");

let pollTimer = null;
let currentVideo = null;

function setProgress(progress, message) {
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  statusPanel.hidden = false;
  progressBar.style.width = `${safeProgress}%`;
  percentText.textContent = `${safeProgress}%`;
  statusText.textContent = message || "正在处理";
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  urlInput.disabled = isBusy;
  submitButton.textContent = isBusy ? "保存中..." : "保存";
}

function setSaveBusy(isBusy) {
  saveToAlbumButton.disabled = isBusy;
  saveToAlbumButton.textContent = isBusy ? "准备保存..." : "保存到相册";
}

async function readError(response) {
  try {
    const data = await response.json();
    return data.detail || "请求失败";
  } catch {
    return "请求失败";
  }
}

async function pollJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const job = await response.json();
  setProgress(job.progress, job.message);

  if (job.status === "ready") {
    clearInterval(pollTimer);
    pollTimer = null;
    setBusy(false);
    currentVideo = job;
    videoPreview.src = job.previewUrl;
    downloadLink.href = job.saveUrl;
    downloadLink.download = job.filename || "video.mp4";
    previewPanel.hidden = false;
    setProgress(100, "下载完成，可以预览或保存");
    return;
  }

  if (job.status === "error") {
    clearInterval(pollTimer);
    pollTimer = null;
    setBusy(false);
    throw new Error(job.error || "下载失败");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearInterval(pollTimer);
  currentVideo = null;
  previewPanel.hidden = true;
  videoPreview.removeAttribute("src");
  videoPreview.load();
  setBusy(true);
  setProgress(0, "正在创建下载任务");

  try {
    const formData = new FormData();
    formData.append("url", urlInput.value.trim());

    const response = await fetch("/api/jobs", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const { id } = await response.json();
    await pollJob(id);
    pollTimer = setInterval(() => {
      pollJob(id).catch((error) => {
        clearInterval(pollTimer);
        pollTimer = null;
        setBusy(false);
        statusText.textContent = error.message;
      });
    }, 1000);
  } catch (error) {
    setBusy(false);
    statusPanel.hidden = false;
    statusText.textContent = error.message;
  }
});

saveToAlbumButton.addEventListener("click", async () => {
  if (!currentVideo?.saveUrl) {
    return;
  }

  setSaveBusy(true);
  saveHint.textContent = "正在准备系统保存面板...";

  try {
    const response = await fetch(currentVideo.saveUrl);
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const blob = await response.blob();
    const file = new File([blob], currentVideo.filename || "video.mp4", {
      type: blob.type || "video/mp4",
    });

    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({
        files: [file],
        title: "保存视频",
      });
      saveHint.textContent = "如果系统面板里有“保存视频”，选择后即可保存到相册。";
      return;
    }

    downloadLink.click();
    saveHint.textContent = "当前浏览器不支持直接打开相册保存面板，已改为下载文件。";
  } catch (error) {
    if (error.name === "AbortError") {
      saveHint.textContent = "已取消保存。";
      return;
    }

    downloadLink.click();
    saveHint.textContent = error.message || "保存面板打开失败，已改为下载文件。";
  } finally {
    setSaveBusy(false);
  }
});
