import { AppSession, PhotoData, logger as _logger } from '@mentra/sdk';

const logger = _logger.child({ service: 'PhotoManager' });

interface PhotoCache {
  promise: Promise<PhotoData>;
  photoData: PhotoData | null;
  lastPhotoTime: number;
  requestTime?: number;
}

/**
 * Manages photo capture for sessions
 * Always takes a fresh photo for each query - no photo caching between queries
 */
export class PhotoManager {
  private activePhotos: Map<string, PhotoCache> = new Map();
  private isRequestingPhoto: boolean = false;
  private session: AppSession;
  private sessionId: string;

  constructor(session: AppSession, sessionId: string) {
    this.session = session;
    this.sessionId = sessionId;
  }

  /**
   * Request a fresh photo for the current session
   * Always takes a new photo - no caching of old photos
   */
  requestPhoto(): void {
    // Always clear any existing photo and request a fresh one
    if (this.isRequestingPhoto) {
      return;
    }

    if (this.session.capabilities?.hasCamera) {
      // Clear any existing photo first - we always want a fresh one
      this.activePhotos.delete(this.sessionId);

      this.isRequestingPhoto = true;
      const photoRequestTime = Date.now();

      const getPhotoPromise = this.session.camera.requestPhoto({ size: "small" });

      getPhotoPromise.then(photoData => {

        this.activePhotos.set(this.sessionId, {
          promise: getPhotoPromise,
          photoData: photoData,
          lastPhotoTime: Date.now()
        });
        this.isRequestingPhoto = false;
      }, error => {
        logger.error(error, `[Session ${this.sessionId}]: Error getting photo:`);
        this.activePhotos.delete(this.sessionId);
        this.isRequestingPhoto = false;
      });

      this.activePhotos.set(this.sessionId, {
        promise: getPhotoPromise,
        photoData: null,
        lastPhotoTime: Date.now(),
        requestTime: photoRequestTime
      });
    }
  }

  /**
   * Get photo for the session, optionally waiting for it to be available
   */
  async getPhoto(waitForPhoto: boolean = false): Promise<PhotoData | null> {
    if (this.activePhotos.has(this.sessionId)) {
      const photo = this.activePhotos.get(this.sessionId);
      if (photo && photo.photoData) {
        return photo.photoData;
      } else {
        if (photo?.promise) {
          if (!waitForPhoto) {
            return null;
          }

          const result = await Promise.race([
            photo.promise,
            new Promise<null>(resolve => setTimeout(resolve, 5000))
          ]) as PhotoData | null;

          return result;
        } else {
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Get cached photo data if available
   */
  getCachedPhoto(): PhotoData | null {
    const photo = this.activePhotos.get(this.sessionId);
    return photo?.photoData || null;
  }

  /**
   * Clear photo cache for the session
   */
  clearPhoto(): void {
    this.activePhotos.delete(this.sessionId);
    this.isRequestingPhoto = false;
  }

  /**
   * Check if a photo is currently being requested
   */
  isRequesting(): boolean {
    return this.isRequestingPhoto;
  }

  /**
   * Check if a photo exists in cache
   */
  hasPhoto(): boolean {
    return this.activePhotos.has(this.sessionId);
  }
}
