import { ApiError } from '../../shared/api';

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
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await putFile(url, file, onProgress);
    if (status === 200) return;
    if (status === 413) throw new ApiError('E_FILE_TOO_LARGE', 'The file is too large.');
    if (status === 403 || status === 409) throw new ApiError('E_UPLOAD', 'The upload link expired. Please try again.');
    onWaking();
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new ApiError('E_BACKEND_DOWN', 'The translation server is not responding. Please try again later.');
}
