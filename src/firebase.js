// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyADM0ZCrJzcloPGcTlnaQEtPRkHxy-3mVc",
  authDomain: "roanresare.firebaseapp.com",
  projectId: "roanresare",
  storageBucket: "roanresare.firebasestorage.app",
  messagingSenderId: "51078874827",
  appId: "1:51078874827:web:cd05812e2d7466944dbd4e",
  measurementId: "G-QLG0QE7MTB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);