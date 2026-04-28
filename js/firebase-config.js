// ============================================================
// 【設定が必要】ここにFirebaseの設定を貼り付けてください
// Firebase Console → プロジェクト設定 → マイアプリ → Firebase SDK snippet
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDeYSNaN3faQ58wCDiEoU3ZTGXBH3hj4Mk",
  authDomain: "meeting-7a9cc.firebaseapp.com",
  projectId: "meeting-7a9cc",
  storageBucket: "meeting-7a9cc.firebasestorage.app",
  messagingSenderId: "921547907122",
  appId: "1:921547907122:web:6f7b0e44e142b4b2925c2b"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
