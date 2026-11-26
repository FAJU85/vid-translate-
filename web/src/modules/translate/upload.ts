import { ApiError } from '../../shared/api';
import { holdUpdates } from '../../shared/updates';

function putFile(url: string, file: File, onProgress: (fraction: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.send(file);
  });
}

/**
 * Uploads straight to the translation server. A sleeping Hugging Face Space answers the first
 * requests with errors while it boots, so keep retrying for a few minutes.
 */
export async function uploadFile(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  onWaking: () => void,
): Promise<void> {
  // A new version of the app never reloads the page under an upload.
  const release = holdUpdates();
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await putFile(url, file, onProgress);
      if (status === 200) return;
      if (status === 413) throw new ApiError('E_FILE_TOO_LARGE', 'The file is too large.');
      if (status === 403 || status === 409) throw new ApiError('E_UPLOAD', 'The upload link expired. Please try again.');
      onWaking();
      await new Promise((r) => setTimeout(r, 10_000));
    }
    throw new ApiError('E_BACKEND_DOWN', 'The translation server is not responding. Please try again later.');
  } finally {
    release();
  }
}

/** The file's length in seconds as the browser reads it (for the credit estimate), or null. */
export function readDuration(file: File, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
    const done = (value: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      media.removeAttribute('src');
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    media.preload = 'metadata';
    media.onloadedmetadata = () => done(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null);
    media.onerror = () => done(null);
    media.src = url;
  });
}
