import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Only initialize if we have the config, else let the UI handle the missing env error
export const app = firebaseConfig.apiKey ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;

export async function signInWithGoogle(allowedDomain?: string) {
  if (!auth) {
    throw new Error('Firebase is not configured. Missing environment variables.');
  }
  const provider = new GoogleAuthProvider();
  const customParams: Record<string, string> = { prompt: 'select_account' };
  if (allowedDomain) {
    customParams.hd = allowedDomain;
  }
  provider.setCustomParameters(customParams);
  
  const result = await signInWithPopup(auth, provider);
  return await result.user.getIdToken();
}
