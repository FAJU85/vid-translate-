import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, setDoc, getDoc, getDocs, collection, query, where, deleteDoc, updateDoc 
} from 'firebase/firestore';
import { 
  auth, db, googleProvider, isUserAdmin, ADMIN_EMAIL_INTERNAL, 
  testFirestoreConnection, handleFirestoreError, OperationType 
} from '../lib/firebase';
import { Job, UserTranslationRecord } from '../types/pipeline';

interface AuthContextType {
  currentUser: User | null;
  isAdmin: boolean;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  authError: string | null;
  saveUserTranslation: (job: Job) => Promise<UserTranslationRecord | null>;
  fetchUserTranslations: () => Promise<UserTranslationRecord[]>;
  deleteUserTranslation: (translationId: string) => Promise<boolean>;
  toggleShareTranslation: (translationId: string, isShared: boolean) => Promise<boolean>;
  getSharedTranslation: (translationId: string) => Promise<UserTranslationRecord | null>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  isAdmin: false,
  loading: true,
  signInWithGoogle: async () => {},
  logout: async () => {},
  authError: null,
  saveUserTranslation: async () => null,
  fetchUserTranslations: async () => [],
  deleteUserTranslation: async () => false,
  toggleShareTranslation: async () => false,
  getSharedTranslation: async () => null,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    testFirestoreConnection();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const isAdminRole = user.email?.toLowerCase() === ADMIN_EMAIL_INTERNAL.toLowerCase();
          await setDoc(userDocRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || 'User',
            photoURL: user.photoURL || '',
            role: isAdminRole ? 'admin' : 'user',
            lastLoginAt: new Date().toISOString(),
          }, { merge: true });
        } catch (err) {
          console.warn('Failed to sync user profile to Firestore:', err);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setAuthError(err.message || 'Google sign-in encountered an error.');
    }
  };

  const logout = async () => {
    try {
      await fbSignOut(auth);
    } catch (err: any) {
      console.error('Sign out error:', err);
    }
  };

  // Save translated video to current user's profile
  const saveUserTranslation = useCallback(async (job: Job): Promise<UserTranslationRecord | null> => {
    if (!currentUser) return null;
    const path = `user_translations/${job.id}`;
    try {
      const record: UserTranslationRecord = {
        id: job.id,
        userId: currentUser.uid,
        userEmail: currentUser.email || undefined,
        videoUrl: job.video_url || 'uploaded_video.mp4',
        videoTitle: job.video_title || 'Translated Video',
        videoDuration: job.video_duration || 180,
        youtubeId: job.youtube_id,
        thumbnailUrl: job.thumbnail_url,
        srcLang: job.src_lang,
        tgtLang: job.tgt_lang,
        subtitleMode: job.subtitle_mode,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        cues: job.cues || [],
        createdAt: new Date(job.created_at * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        isShared: true, // Allow sharing by default
      };

      await setDoc(doc(db, 'user_translations', job.id), record, { merge: true });
      return record;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      return null;
    }
  }, [currentUser]);

  // Fetch all translations for current authenticated user
  const fetchUserTranslations = useCallback(async (): Promise<UserTranslationRecord[]> => {
    if (!currentUser) return [];
    const path = 'user_translations';
    try {
      const q = query(collection(db, path), where('userId', '==', currentUser.uid));
      const snapshot = await getDocs(q);
      const results: UserTranslationRecord[] = [];
      snapshot.forEach(docSnap => {
        results.push(docSnap.data() as UserTranslationRecord);
      });
      // Sort newest first
      return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      return [];
    }
  }, [currentUser]);

  // Delete translation
  const deleteUserTranslation = useCallback(async (translationId: string): Promise<boolean> => {
    if (!currentUser) return false;
    const path = `user_translations/${translationId}`;
    try {
      await deleteDoc(doc(db, 'user_translations', translationId));
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
      return false;
    }
  }, [currentUser]);

  // Toggle public share link status
  const toggleShareTranslation = useCallback(async (translationId: string, isShared: boolean): Promise<boolean> => {
    if (!currentUser) return false;
    const path = `user_translations/${translationId}`;
    try {
      await updateDoc(doc(db, 'user_translations', translationId), {
        isShared,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
      return false;
    }
  }, [currentUser]);

  // Get a single translation (for public share viewer)
  const getSharedTranslation = useCallback(async (translationId: string): Promise<UserTranslationRecord | null> => {
    const path = `user_translations/${translationId}`;
    try {
      const snap = await getDoc(doc(db, 'user_translations', translationId));
      if (snap.exists()) {
        const data = snap.data() as UserTranslationRecord;
        return data;
      }
      return null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
      return null;
    }
  }, []);

  const adminStatus = isUserAdmin(currentUser);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAdmin: adminStatus,
        loading,
        signInWithGoogle,
        logout,
        authError,
        saveUserTranslation,
        fetchUserTranslations,
        deleteUserTranslation,
        toggleShareTranslation,
        getSharedTranslation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
