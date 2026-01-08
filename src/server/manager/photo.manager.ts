import { AppSession, PhotoData, logger as _logger } from '@mentra/sdk';

const logger = _logger.child({ service: 'PhotoManager' });

interface PhotoCache {
  promise: Promise<PhotoData>;
  photoData: PhotoData | null;
  lastPhotoTime: number;
  requestTime?: number;
}

/**
 * Manages photo capture and caching for sessions
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
   * Request a photo for the current session if one isn't already being requested
   */
  requestPhoto(): void {
    // Only request ONE photo per query - check both activePhotos and isRequestingPhoto flag
    if (!this.activePhotos.has(this.sessionId) && !this.isRequestingPhoto) {
      if (this.session.capabilities?.hasCamera) {
        this.isRequestingPhoto = true;
        const photoRequestTime = Date.now();
        console.log(`📸 [${new Date().toISOString()}] Photo requested at timestamp: ${photoRequestTime}`);

        const getPhotoPromise = this.session.camera.requestPhoto({ size: "small" });

        getPhotoPromise.then(photoData => {
          const photoReceivedTime = Date.now();
          const photoLatency = photoReceivedTime - photoRequestTime;
          console.log(`📸 [${new Date().toISOString()}] ✅ Photo received! Latency: ${photoLatency}ms (requested: ${photoRequestTime}, received: ${photoReceivedTime})`);

          this.activePhotos.set(this.sessionId, {
            promise: getPhotoPromise,
            photoData: photoData,
            lastPhotoTime: Date.now()
          });
        }, error => {
          console.log(`📸 [${new Date().toISOString()}] ❌ Photo request failed after ${Date.now() - photoRequestTime}ms`);
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
  }

  /**
   * Get photo for the session, optionally waiting for it to be available
   */
  async getPhoto(waitForPhoto: boolean = false): Promise<PhotoData | null> {
    const getPhotoStartTime = Date.now();
    console.log(`📸 [${new Date().toISOString()}] getPhoto() called (waitForPhoto: ${waitForPhoto}) at timestamp: ${getPhotoStartTime}`);

    if (this.activePhotos.has(this.sessionId)) {
      const photo = this.activePhotos.get(this.sessionId);
      if (photo && photo.photoData) {
        console.log(`📸 [${new Date().toISOString()}] ✅ Photo already available (cached)`);
        return photo.photoData;
      } else {
        if (photo?.promise) {
          // If waitForPhoto is false, return null immediately (don't block)
          if (!waitForPhoto) {
            console.log(`📸 [${new Date().toISOString()}] ⚡ Not waiting for photo (waitForPhoto=false) - returning null`);
            return null;
          }

          // If waitForPhoto is true, wait up to 5 seconds for promise to resolve
          const waitStartTime = Date.now();
          const requestAge = photo.requestTime ? waitStartTime - photo.requestTime : 'unknown';
          console.log(`📸 [${new Date().toISOString()}] ⏳ Waiting for photo promise (request age: ${requestAge}ms, timeout: 5000ms)`);
          logger.debug("Waiting for photo to resolve");

          const result = await Promise.race([
            photo.promise,
            new Promise<null>(resolve => setTimeout(resolve, 5000))
          ]) as PhotoData | null;

          const waitDuration = Date.now() - waitStartTime;
          if (result) {
            console.log(`📸 [${new Date().toISOString()}] ✅ Photo promise resolved after ${waitDuration}ms wait`);
          } else {
            console.log(`📸 [${new Date().toISOString()}] ⏱️ Photo promise timed out after ${waitDuration}ms`);
          }
          return result;
        } else {
          console.log(`📸 [${new Date().toISOString()}] ❌ No photo promise available`);
          return null;
        }
      }
    }
    console.log(`📸 [${new Date().toISOString()}] ❌ No active photo for session`);
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
