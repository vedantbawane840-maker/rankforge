/**
 * RankForge Firebase Authentication Module
 * Supports Google, GitHub, and Email/Password authentication
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  signOut,
  getIdToken
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

export const firebaseConfig = {
  apiKey: window.__RANKFORGE_FIREBASE_API_KEY || "AIzaSyDemoRankForgeKeyForLocalDev",
  authDomain: window.__RANKFORGE_AUTH_DOMAIN || "rankforge-app.firebaseapp.com",
  projectId: window.__RANKFORGE_PROJECT_ID || "rankforge-app",
  storageBucket: "rankforge-app.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};

let app;
let auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (e) {
  console.warn("Firebase initialization note:", e);
}

const googleProvider = new GoogleAuthProvider();
const githubProvider = new GithubAuthProvider();

export async function loginWithEmail(email, password) {
  if (!auth) throw new Error("Firebase auth not configured.");
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

export async function signupWithEmail(email, password) {
  if (!auth) throw new Error("Firebase auth not configured.");
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

export async function loginWithGoogle() {
  if (!auth) throw new Error("Firebase auth not configured.");
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function loginWithGitHub() {
  if (!auth) throw new Error("Firebase auth not configured.");
  const result = await signInWithPopup(auth, githubProvider);
  return result.user;
}

export async function logoutUser() {
  if (auth) {
    await signOut(auth);
  }
  localStorage.removeItem('rf_dev_session');
  window.location.href = '/login.html';
}

export function subscribeToAuth(callback) {
  if (!auth) {
    const devToken = localStorage.getItem('rf_dev_session');
    if (devToken) {
      callback({
        uid: devToken.replace('rf_dev_', '') || 'dev_user_sandbox',
        email: 'developer@rankforge.app',
        displayName: 'Dev Sandbox User',
        getIdToken: async () => devToken
      });
      return () => {};
    }
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function getUserAuthToken() {
  if (auth && auth.currentUser) {
    return await getIdToken(auth.currentUser);
  }
  return localStorage.getItem('rf_dev_session') || 'rf_dev_sandbox_token';
}
