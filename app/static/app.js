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
const openVideoLink = document.querySelector("#openVideoLink");
const saveHint = document.querySelector("#saveHint");

let pollTimer = null;
let currentVideo = null;
let currentObjectUrl = null;

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

function resetCurrentVideo() {
  currentVideo = null;
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

async function readError(response) {
  try {
    const data = await response.json();
    return data.detail || "请求失败";
  } catch {
    return "请求失败";
  }
}

async function prepareLocalVideo(job) {
  saveToAlbumButton.disabled = true;
  saveHint.textContent = "正在准备本地预览文件...";

  const response = await fetch(job.previewUrl);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const blob = await response.blob();
  const filename = job.filename || "video.mp4";
  const file = new File([blob], filename, {
    type: blob.type || "video/mp4",
  });

  currentObjectUrl = URL.createObjectURL(blob);
  currentVideo = {
    ...job,
    file,
    objectUrl: currentObjectUrl,
  };

  videoPreview.src = currentObjectUrl;
  openVideoLink.href = job.previewUrl;
  saveToAlbumButton.disabled = false;
  saveHint.textContent = "点击保存会打开系统分享面板；如果没有“保存视频”，点“打开视频原文件”后用 Safari 分享按钮保存。";
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
    previewPanel.hidden = false;
    setProgress(100, "视频已下载，正在准备本地预览...");
    await prepareLocalVideo(job);
    setProgress(100, "下载完成，可以预览或保存到相册");
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
  resetCurrentVideo();
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
  if (!currentVideo?.file) {
    saveHint.textContent = "视频文件还没有准备好，请稍等。";
    return;
  }

  setSaveBusy(true);
  saveHint.textContent = "正在打开系统保存面板...";

  try {
    if (navigator.canShare?.({ files: [currentVideo.file] }) && navigator.share) {
      await navigator.share({
        files: [currentVideo.file],
        title: "保存视频",
      });
      saveHint.textContent = "如果系统面板里有“保存视频”，选择后即可保存到相册。";
      return;
    }

    saveHint.textContent = "当前浏览器不支持网页文件分享。请点“打开视频原文件”，再用 Safari 分享按钮保存视频。";
  } catch (error) {
    if (error.name === "AbortError") {
      saveHint.textContent = "已取消保存。";
      return;
    }

    saveHint.textContent = error.message || "保存面板打开失败。请点“打开视频原文件”，再用 Safari 分享按钮保存视频。";
  } finally {
    setSaveBusy(false);
  }
});
