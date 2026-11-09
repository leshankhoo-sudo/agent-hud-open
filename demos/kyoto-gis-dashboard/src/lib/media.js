// Scrubbing a video (setting currentTime) needs HTTP Range support on the server.
// Simple local servers (the Windows launcher, python -m http.server) do not send it, so the
// browser cannot seek and the video sticks on its first frame. Loading the file once into a
// blob URL makes seeking work on any server. Falls back to the plain URL if the fetch fails.
export function loadAsBlob(video, url) {
  let cancelled = false;
  let blobUrl = null;
  fetch(url)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((b) => {
      if (cancelled) return;
      blobUrl = URL.createObjectURL(b);
      const t = video.currentTime;
      video.src = blobUrl;
      if (t) video.currentTime = t;
    })
    .catch(() => { if (!cancelled && !video.src) video.src = url; });
  return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
}
