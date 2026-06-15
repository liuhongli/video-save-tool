const form = document.querySelector("#downloadForm");
const urlInput = document.querySelector("#url");
const submitButton = document.querySelector("#submitButton");
const statusPanel = document.querySelector("#statusPanel");
const statusText = document.querySelector("#statusText");
const percentText = document.querySelector("#percentText");
const progressBar = document.querySelector("#progressBar");
const previewPanel = document.querySelector("#previewPanel");
const videoPreview = document.querySelector("#videoPreview");
const saveLink = document.querySelector("#saveLink");

let pollTimer = null;

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
    videoPreview.src = job.previewUrl;
    saveLink.href = job.saveUrl;
    saveLink.download = job.filename || "video.mp4";
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
