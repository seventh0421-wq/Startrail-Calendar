// Firebase browser SDK; public Firebase config is an identifier, NOT an admin secret.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged,getIdToken} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
const firebaseConfig = {
  apiKey: 'AIzaSyCj8F8PAkSccBRtW4PURMm8wWE-1gEPS60',
  authDomain: 'startrail-calendar.firebaseapp.com',
  projectId: 'startrail-calendar',
  storageBucket: 'startrail-calendar.firebasestorage.app',
  messagingSenderId: '883531055589',
  appId: '1:883531055589:web:409781d3d66661b1a5ef0c'
};
const auth=getAuth(initializeApp(firebaseConfig));
// Each interactive request gets a fresh provider, not a cached provider/session hint.
// Google owns its chooser UI: prompt requests a chooser but cannot guarantee it.
function googleProvider(emailHint=''){
  const provider=new GoogleAuthProvider();
  const options=emailHint
    ? {login_hint:emailHint.trim().toLowerCase()}
    : {prompt:'select_account'};
  provider.setCustomParameters(options);
  return provider;
}
window.StartrailAuth={
  login:({emailHint=''}={})=>signInWithPopup(auth,googleProvider(emailHint)),
  logout:()=>signOut(auth),
  token:()=>auth.currentUser?getIdToken(auth.currentUser):Promise.reject(new Error('尚未登入')),
  get currentUser(){return auth.currentUser;}
};
onAuthStateChanged(auth,user=>{
  window.dispatchEvent(new CustomEvent('startrail-auth',{detail:{user}}));
},err=>{
  window.dispatchEvent(new CustomEvent('startrail-auth-error',{detail:{error:err}}));
});
