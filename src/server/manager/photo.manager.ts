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
      console.log(`📸 [${new Date().toISOString()}] Photo request already in progress, skipping duplicate request`);
      return;
    }

    if (this.session.capabilities?.hasCamera) {
      // Clear any existing photo first - we always want a fresh one
      this.activePhotos.delete(this.sessionId);

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
        this.isRequestingPhoto = false;
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
