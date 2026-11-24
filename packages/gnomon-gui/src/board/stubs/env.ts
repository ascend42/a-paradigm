/**
 * @symbol #gui-board
 *
 * Replaces Excalidraw's build-env chunk (dist/prod/chunk-ZUYEQ4TG.js), which
 * hardcodes the excalidraw.com json, library, AI and collab backends, a
 * Firebase config and an export public key. Every backend is the empty
 * string here, so no code path can name one; only the package identity and
 * the production flag keep their values.
 */
const env = {
  VITE_APP_BACKEND_V2_GET_URL: '',
  VITE_APP_BACKEND_V2_POST_URL: '',
  VITE_APP_LIBRARY_URL: '',
  VITE_APP_LIBRARY_BACKEND: '',
  VITE_APP_PLUS_LP: '',
  VITE_APP_PLUS_APP: '',
  VITE_APP_AI_BACKEND: '',
  VITE_APP_WS_SERVER_URL: '',
  VITE_APP_FIREBASE_CONFIG: '{}',
  VITE_APP_ENABLE_TRACKING: 'false',
  VITE_APP_PLUS_EXPORT_PUBLIC_KEY: '',
  VITE_APP_DEBUG_ENABLE_TEXT_CONTAINER_BOUNDING_BOX: 'false',
  VITE_APP_COLLAPSE_OVERLAY: 'false',
  VITE_APP_ENABLE_ESLINT: 'false',
  PKG_NAME: '@excalidraw/excalidraw',
  PKG_VERSION: __GNOMON_BOARD_ENGINE_VERSION__,
  PROD: true,
};
declare const __GNOMON_BOARD_ENGINE_VERSION__: string;

export { env as a };
