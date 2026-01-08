import type { Timestamp } from "firebase/firestore";

export type UserProfile = {
  uid: string;
  email: string;
  name: string;
  position?: string;
  employeeId?: string;
  normalRate?: number;
  otRate?: number;
  isDeleted?: boolean;
  phone?: string;
  isAdmin: boolean;
  lastLoginAt?: Timestamp | null;
};

export type SiteItem = {
  id: string;
  name: string;
  nameNormalized: string;
  lat: number;
  lng: number;
  allowedRadiusMeters: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type AttendanceLog = {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  siteId: string;
  siteName: string;
  scanTime: Timestamp;
  dateKey?: string;
  userLat: number | null;
  userLng: number | null;
  distanceMeters: number | null;
  allowedRadiusMeters: number | null;
  status: "success" | "fail";
  scanType?: "check-in" | "check-out";
  failReason?: string;
  isDeleted?: boolean;
  createdBy?: "scanner" | "admin";
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  updatedBy?: string;
  updatedByEmail?: string;
  deletedAt?: Timestamp;
  deletedBy?: string;
  deletedByEmail?: string;
  adminNote?: string;
  searchPrefixes?: string[];
};

export type AttendanceSession = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  siteId?: string;
  siteName?: string;
  siteInId?: string | null;
  siteInName?: string | null;
  siteOutId?: string | null;
  siteOutName?: string | null;
  dateKey: string;
  checkInTime: Timestamp | null;
  checkOutTime: Timestamp | null;
  totalHours: number | null;
  normalHours: number | null;
  otHours: number | null;
  normalRate: number;
  otRate: number;
  amountRM: number | null;
  status: "complete" | "incomplete";
  isLate?: boolean;
  lateReason?: string | null;
  lateNote?: string | null;
  isAbnormal?: boolean;
  abnormalReasons?: string[];
  abnormalNote?: string | null;
  searchPrefixes?: string[];
};
