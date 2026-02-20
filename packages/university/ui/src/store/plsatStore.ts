import { create } from 'zustand';
import type { Certificate } from '../types';

const STORAGE_KEY = 'paradigm-university-plsat';

interface PLSATState {
  /** All certificates earned */
  certificates: Certificate[];
  /** Student name (persisted) */
  studentName: string;

  /** Set student name */
  setStudentName: (name: string) => void;
  /** Record a new certificate */
  addCertificate: (cert: Certificate) => void;
  /** Get latest certificate */
  getLatestCertificate: () => Certificate | null;
  /** Get certificate for a specific PLSAT version */
  getCertificateForVersion: (version: string) => Certificate | null;
  /** Check if passed any version */
  hasPassed: () => boolean;
}

interface StoredData {
  certificates: Certificate[];
  studentName: string;
}

function loadFromStorage(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { certificates: [], studentName: '' };
  } catch {
    return { certificates: [], studentName: '' };
  }
}

function saveToStorage(data: StoredData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // LocalStorage full or unavailable
  }
}

export const usePLSATStore = create<PLSATState>((set, get) => {
  const stored = loadFromStorage();
  return {
    certificates: stored.certificates,
    studentName: stored.studentName,

    setStudentName: (name) => {
      set({ studentName: name });
      const state = get();
      saveToStorage({ certificates: state.certificates, studentName: name });
    },

    addCertificate: (cert) => {
      set((state) => {
        const updated = [...state.certificates, cert];
        saveToStorage({ certificates: updated, studentName: state.studentName });
        return { certificates: updated };
      });
    },

    getLatestCertificate: () => {
      const certs = get().certificates;
      if (certs.length === 0) return null;
      return certs.reduce((latest, c) =>
        new Date(c.date) > new Date(latest.date) ? c : latest
      );
    },

    getCertificateForVersion: (version) => {
      return get().certificates.find(c => c.plsatVersion === version && c.passed) || null;
    },

    hasPassed: () => {
      return get().certificates.some(c => c.passed);
    },
  };
});
