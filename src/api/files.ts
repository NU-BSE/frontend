/**
 * File upload adapter for the remote agent backend.
 *
 * The device holds a `file://`/`content://` URI that a remote server can never
 * open. Before a remote model can consume an attachment, the bytes must be
 * uploaded and replaced by a stable backend reference. This adapter does that
 * upload and returns the server-side file id.
 *
 * Backend contract this adapter expects (must be implemented server-side):
 *
 *   POST /files
 *   Content-Type: multipart/form-data   (field name: "file")
 *   Authorization: Bearer <access token>
 *
 *   → 200 { "id": "file_xxx", "name": "report.pdf",
 *           "mimeType": "application/pdf", "size": 2451023 }
 *
 * The returned `id` is what `POST /agent/step` later receives inside a user
 * message's `attachments`, never the local URI. If the backend exposes a
 * different route, this file is the single place to change it.
 *
 * Uploads are bounded: a timeout aborts them, and a failed upload surfaces as
 * an error so the caller can offer a retry instead of silently proceeding
 * without the file.
 */
import {
  ApiError,
  baseUrl,
  getToken,
  NETWORK_ERROR_STATUS,
  refreshAccessTokenOnce,
} from './client';

/** Longer than the JSON request timeout: files are bigger than control calls. */
const UPLOAD_TIMEOUT_MS = 60_000;

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface LocalFileSource {
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Uploads one local file as multipart/form-data and returns the backend
 * reference. Never sets `Content-Type` manually — React Native fills the
 * multipart boundary, and a hand-written value breaks the request.
 */
export async function uploadFile(file: LocalFileSource): Promise<UploadedFile> {
  const token = await getToken();

  const formData = new FormData();
  // RN's fetch accepts a `{ uri, name, type }` descriptor as a form part.
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || 'application/octet-stream',
  } as unknown as Blob);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  const post = (bearer: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    return fetch(`${baseUrl()}/files`, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
  };

  let response: Response;
  try {
    response = await post(token);
    /*
     * This posts with a bare fetch rather than through `request`, because the
     * multipart body has to reach RN's fetch untouched — so it does not get
     * the client's refresh-on-401 for free. Without this retry an attachment
     * sent more than about fifteen minutes after sign-in fails as an auth
     * error while a usable refresh token sits in storage.
     *
     * Retried only when a token was sent and the refresh produced a new one;
     * otherwise the 401 is a genuine sign-out and must surface. FormData is
     * re-sent as-is: it is a description of the file, not a consumed stream.
     */
    if (response.status === 401 && token) {
      const refreshed = await refreshAccessTokenOnce();
      if (refreshed) response = await post(refreshed);
    }
  } catch {
    const aborted = controller.signal.aborted;
    throw new ApiError(
      aborted
        ? `Uploading ${file.name} timed out.`
        : `Could not upload ${file.name} to the server.`,
      NETWORK_ERROR_STATUS,
      aborted ? 'timeout' : 'network_error',
    );
  } finally {
    clearTimeout(timer);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body; fall through to the status check.
  }

  if (!response.ok) {
    const message =
      typeof body.message === 'string' ? body.message : response.statusText;
    throw new ApiError(
      message,
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
    );
  }

  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new ApiError(
      'The server did not return a file id for the upload.',
      response.status,
      'invalid_response',
    );
  }

  return {
    id: body.id,
    name: typeof body.name === 'string' ? body.name : file.name,
    mimeType:
      typeof body.mimeType === 'string' ? body.mimeType : file.mimeType,
    size: typeof body.size === 'number' ? body.size : 0,
  };
}
