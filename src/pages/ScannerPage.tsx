import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import {
  buildSearchPrefixes,
  getDateKey,
  getTimeMinutes,
  haversineDistance,
  normalizeSiteName,
} from "../lib/utils";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { PageHeader } from "../components/layout/PageHeader";
import type { SiteItem } from "../types";

type ScanStatus = "idle" | "scanning" | "processing";

const SCAN_TIMEOUT_MS = 15000;

export function ScannerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [scanSession, setScanSession] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const processingRef = useRef(false);

  const returnPath = useMemo(() => {
    if (!location.state || typeof location.state !== "object") return "/user";
    const state = location.state as { from?: string };
    return state.from ?? "/user";
  }, [location.state]);

  const stopScanner = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  };

  const navigateBack = (message: string, status: "success" | "error") => {
    stopScanner();
    navigate(returnPath, { state: { message, status } });
  };

  const logAttendanceFailure = async (
    reason: string,
    locationItem?: SiteItem,
    distanceMeters?: number,
    coords?: { lat: number; lng: number },
  ) => {
    if (!user || !profile) return;
    const dateKey = getDateKey();
    await addDoc(collection(db, "attendance"), {
      userId: user.uid,
      userEmail: profile.email,
      userName: profile.name ?? "User",
      siteId: locationItem?.id ?? "unknown",
      siteName: locationItem?.name ?? "Unknown",
      scanTime: serverTimestamp(),
      dateKey,
      userLat: coords?.lat ?? null,
      userLng: coords?.lng ?? null,
      distanceMeters: distanceMeters ?? null,
      allowedRadiusMeters: locationItem?.allowedRadiusMeters ?? null,
      status: "fail",
      failReason: reason,
      isDeleted: false,
      createdBy: "scanner",
      createdAt: serverTimestamp(),
      searchPrefixes: buildSearchPrefixes([
        profile.name ?? "User",
        profile.email,
        locationItem?.name ?? "Unknown",
      ]),
    });
  };

  const DEFAULT_BUFFER_SETTINGS = {
    lateBufferMinutes: 5,
    earlyCheckoutBufferMinutes: 5,
    otEarlyBufferMinutes: 15,
    otLateBufferMinutes: 60,
  };

  const getBufferSettings = async () => {
    const docRef = doc(db, "settings", "global");
    const snapshot = await getDoc(docRef);
    const data = snapshot.exists() ? snapshot.data() : {};
    const normalize = (value: unknown, fallback: number) =>
      typeof value === "number" && !Number.isNaN(value) ? value : fallback;
    return {
      lateBufferMinutes: normalize(
        data?.lateBufferMinutes,
        DEFAULT_BUFFER_SETTINGS.lateBufferMinutes,
      ),
      earlyCheckoutBufferMinutes: normalize(
        data?.earlyCheckoutBufferMinutes,
        DEFAULT_BUFFER_SETTINGS.earlyCheckoutBufferMinutes,
      ),
      otEarlyBufferMinutes: normalize(
        data?.otEarlyBufferMinutes,
        DEFAULT_BUFFER_SETTINGS.otEarlyBufferMinutes,
      ),
      otLateBufferMinutes: normalize(
        data?.otLateBufferMinutes,
        DEFAULT_BUFFER_SETTINGS.otLateBufferMinutes,
      ),
    };
  };

  const rebuildSessionsForDay = async (dateKey: string) => {
    if (!user || !profile) return;
    const logsQuery = query(
      collection(db, "attendance"),
      where("userId", "==", user.uid),
      where("status", "==", "success"),
      where("dateKey", "==", dateKey),
      orderBy("scanTime", "asc"),
    );
    const logsSnapshot = await getDocs(logsQuery);
    const logs = logsSnapshot.docs
      .map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as {
          scanType?: "check-in" | "check-out";
          scanTime: { toDate: () => Date };
          isDeleted?: boolean;
          siteId: string;
          siteName: string;
        }),
      }))
      .filter((log) => !log.isDeleted);

    const checkIns = logs.filter((log) => log.scanType === "check-in");
    const checkOuts = logs.filter((log) => log.scanType === "check-out");
    const firstCheckIn = checkIns.length
      ? checkIns.reduce((prev, next) =>
          prev.scanTime.toDate() <= next.scanTime.toDate() ? prev : next,
        )
      : null;
    const lastCheckOut = checkOuts.length
      ? checkOuts.reduce((prev, next) =>
          prev.scanTime.toDate() >= next.scanTime.toDate() ? prev : next,
        )
      : null;

    const checkInTime = firstCheckIn?.scanTime.toDate() ?? null;
    const checkOutTime = lastCheckOut?.scanTime.toDate() ?? null;
    const siteInId = firstCheckIn?.siteId ?? null;
    const siteInName = firstCheckIn?.siteName ?? null;
    const siteOutId = lastCheckOut?.siteId ?? null;
    const siteOutName = lastCheckOut?.siteName ?? null;

    const checkInMinutes = checkInTime ? getTimeMinutes(checkInTime) : null;
    const checkOutMinutes = checkOutTime ? getTimeMinutes(checkOutTime) : null;

    const {
      lateBufferMinutes,
      earlyCheckoutBufferMinutes,
      otEarlyBufferMinutes,
      otLateBufferMinutes,
    } = await getBufferSettings();

    const totalHoursRaw =
      checkInTime && checkOutTime
        ? Math.max((checkOutTime.getTime() - checkInTime.getTime()) / 36e5, 0)
        : null;
    let totalHoursAdjusted = totalHoursRaw;
    const isWithinEarlyCheckoutBuffer =
      checkOutMinutes !== null &&
      checkOutMinutes >= 17 * 60 - earlyCheckoutBufferMinutes &&
      checkOutMinutes <= 17 * 60;
    if (
      totalHoursAdjusted !== null &&
      isWithinEarlyCheckoutBuffer &&
      checkOutMinutes !== null
    ) {
      const bufferMinutes = Math.max(17 * 60 - checkOutMinutes, 0);
      totalHoursAdjusted += bufferMinutes / 60;
    }
    const totalHoursRounded =
      totalHoursAdjusted !== null
        ? Number(totalHoursAdjusted.toFixed(2))
        : null;

    const isLate =
      checkInMinutes !== null &&
      checkInMinutes > 8 * 60 + lateBufferMinutes;
    const lateReason = isLate
      ? `Check-in after 8:00 + ${lateBufferMinutes} min`
      : null;

    const abnormalReasons: string[] = [];
    if (!checkInTime) abnormalReasons.push("Missing check-in");
    if (!checkOutTime) abnormalReasons.push("Missing check-out");
    if (totalHoursRounded !== null && totalHoursRounded < 9) {
      abnormalReasons.push("Total hours < 9");
    }

    const otEarlyWindowStart = 22 * 60 - otEarlyBufferMinutes;
    const otLateWindowEnd = 22 * 60 + otLateBufferMinutes;
    let effectiveOtCheckoutMinutes = checkOutMinutes;
    if (
      checkOutMinutes !== null &&
      checkOutMinutes >= otEarlyWindowStart &&
      checkOutMinutes <= otLateWindowEnd
    ) {
      effectiveOtCheckoutMinutes = 22 * 60;
    }

    if (checkOutMinutes !== null && checkOutMinutes > otLateWindowEnd) {
      abnormalReasons.push("Checkout after 10pm");
    }

    let otHours = 0;
    if (
      totalHoursRounded !== null &&
      totalHoursRounded >= 9 &&
      effectiveOtCheckoutMinutes !== null
    ) {
      if (effectiveOtCheckoutMinutes >= 22 * 60) {
        otHours = 4;
      } else if (effectiveOtCheckoutMinutes >= 19 * 60) {
        otHours = 2;
      }
    }

    const isAbnormal = abnormalReasons.length > 0;
    const normalHours =
      !isAbnormal && totalHoursRounded !== null
        ? Number(Math.min(totalHoursRounded, 9).toFixed(2))
        : null;
    const otHoursRounded = !isAbnormal ? otHours : null;
    const status = checkInTime && checkOutTime ? "complete" : "incomplete";
    const normalRate = profile.normalRate ?? 0;
    const otRate = profile.otRate ?? 0;
    const amountRM = isAbnormal
      ? null
      : Number(
          ((normalHours ?? 0) * normalRate + (otHoursRounded ?? 0) * otRate).toFixed(2),
        );

    const sessionQuery = query(
      collection(db, "attendanceSessions"),
      where("userId", "==", user.uid),
      where("dateKey", "==", dateKey),
    );
    const sessionSnapshot = await getDocs(sessionQuery);

    const batch = writeBatch(db);
    sessionSnapshot.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });

    const sessionRef = doc(collection(db, "attendanceSessions"));
    batch.set(sessionRef, {
      userId: user.uid,
      userEmail: profile.email,
      userName: profile.name ?? "User",
      siteId: siteInId ?? siteOutId ?? null,
      siteName: siteInName ?? siteOutName ?? null,
      siteInId,
      siteInName,
      siteOutId,
      siteOutName,
      dateKey,
      checkInTime: checkInTime ?? null,
      checkOutTime: checkOutTime ?? null,
      totalHours: totalHoursRounded,
      normalHours,
      otHours: otHoursRounded,
      normalRate,
      otRate,
      amountRM,
      status,
      isLate,
      lateReason,
      lateNote: null,
      isAbnormal,
      abnormalReasons,
      abnormalNote: null,
      searchPrefixes: buildSearchPrefixes([
        profile.name ?? "User",
        profile.email,
        profile.employeeId ?? "",
      ]),
    });

    await batch.commit();
  };

  const handleScan = async (rawValue: string) => {
    if (!user || !profile) return;
    if (processingRef.current) return;
    processingRef.current = true;
    stopScanner();
    setStatus("processing");
    setError(null);
    let cancelled = false;
    let lastLocation: SiteItem | undefined;

    const finish = (message: string, status: "success" | "error") => {
      if (cancelled) return;
      cancelled = true;
      navigateBack(message, status);
    };

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      finish("Scan timed out. Please try again.", "error");
    }, SCAN_TIMEOUT_MS);

    const getPosition = () =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("GPS not available."));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

    try {
      const normalizedName = normalizeSiteName(rawValue);
      if (!normalizedName) {
        await logAttendanceFailure("Invalid QR code.");
        finish("Invalid QR code.", "error");
        return;
      }

      const locationQuery = query(
        collection(db, "sites"),
        where("nameNormalized", "==", normalizedName),
        limit(1),
      );
      const locationSnapshot = await getDocs(locationQuery);
      if (cancelled) return;
      if (locationSnapshot.empty) {
        await logAttendanceFailure("Site not found.");
        finish("Site not found.", "error");
        return;
      }

      const locationItem = {
        id: locationSnapshot.docs[0].id,
        ...(locationSnapshot.docs[0].data() as Omit<SiteItem, "id">),
      };
      lastLocation = locationItem;

      const pos = await getPosition();
      if (cancelled) return;

      const distance = haversineDistance(
        pos.coords.latitude,
        pos.coords.longitude,
        locationItem.lat,
        locationItem.lng,
      );

      if (distance > locationItem.allowedRadiusMeters) {
        await logAttendanceFailure(
          "Outside allowed radius.",
          locationItem,
          distance,
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
        );
        finish("You are outside the allowed radius.", "error");
        return;
      }

      const dateKey = getDateKey();
      const dailyQuery = query(
        collection(db, "attendance"),
        where("userId", "==", user.uid),
        where("siteId", "==", locationItem.id),
        where("status", "==", "success"),
        where("dateKey", "==", dateKey),
        orderBy("scanTime", "desc"),
        limit(10),
      );
      const dailySnapshot = await getDocs(dailyQuery);
      if (cancelled) return;
      const lastLog = dailySnapshot.docs
        .map((docSnap) => docSnap.data() as { scanType?: "check-in" | "check-out"; isDeleted?: boolean })
        .find((data) => !data.isDeleted);
      const lastType = lastLog ? lastLog.scanType ?? "check-in" : null;
      const scanType = !lastType || lastType === "check-out" ? "check-in" : "check-out";

      await addDoc(collection(db, "attendance"), {
        userId: user.uid,
        userEmail: profile.email,
        userName: profile.name ?? "User",
        siteId: locationItem.id,
        siteName: locationItem.name,
        scanTime: serverTimestamp(),
        dateKey,
        userLat: pos.coords.latitude,
        userLng: pos.coords.longitude,
        distanceMeters: distance,
        allowedRadiusMeters: locationItem.allowedRadiusMeters,
        status: "success",
        scanType,
        isDeleted: false,
        createdBy: "scanner",
        createdAt: serverTimestamp(),
        searchPrefixes: buildSearchPrefixes([
          profile.name ?? "User",
          profile.email,
          locationItem.name,
        ]),
      });

      try {
        await rebuildSessionsForDay(dateKey);
      } catch (err: unknown) {
        // Session rebuild errors should not create a failed scan log.
        // eslint-disable-next-line no-console
        console.warn("Session rebuild failed", err);
      }

      finish(
        scanType === "check-in" ? "Check-in recorded." : "Check-out recorded.",
        "success",
      );
    } catch (err: unknown) {
      if (cancelled) return;
      let message = "Unable to complete scan. Please try again.";
      if (typeof err === "string") {
        message = err;
      } else if (err && typeof err === "object") {
        if ("code" in err) {
          const numericCode = (err as { code?: number }).code;
          if (numericCode === 1) {
            message = "GPS permission denied.";
          } else if (numericCode === 2) {
            message = "GPS position unavailable.";
          } else if (numericCode === 3) {
            message = "GPS request timed out.";
          }
        }

        const maybeMessage = (err as { message?: string }).message;
        if (maybeMessage) {
          message = maybeMessage;
        }

        const stringCode = (err as { code?: string }).code;
        if (stringCode === "permission-denied") {
          message = "Permission denied. Please contact admin.";
        } else if (stringCode === "failed-precondition") {
          message = "Missing Firestore index. Please contact admin.";
        }
      }
      try {
        await logAttendanceFailure(message, lastLocation);
      } catch {
        // Ignore logging failures to avoid blocking feedback.
      }
      finish(message, "error");
    } finally {
      clearTimeout(timeoutId);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const startScanner = async () => {
      if (!videoRef.current || !isMounted) return;
      setStatus("scanning");
      processingRef.current = false;
      const reader = new BrowserMultiFormatReader();
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result) => {
            if (result?.getText()) {
              handleScan(result.getText());
            }
          },
        );
        controlsRef.current = controls;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to start camera.");
      }
    };

    startScanner();
    return () => {
      isMounted = false;
      stopScanner();
    };
  }, [scanSession]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Scan QR Code" onLogout={undefined} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 fade-in-up">
        <Card>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
              <video
                ref={videoRef}
                className="h-80 w-full object-cover"
                muted
                playsInline
              />
            </div>
            <div className="flex flex-col gap-2 text-sm text-slate-600">
              <p>
                Status:{" "}
                {status === "idle"
                  ? "Starting camera..."
                  : status === "scanning"
                    ? "Align QR in frame"
                    : "Processing scan..."}
              </p>
              {error ? <p className="text-red-600">{error}</p> : null}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => navigate(returnPath)}>
                Back
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  stopScanner();
                  processingRef.current = false;
                  setScanSession((prev) => prev + 1);
                }}
              >
                Restart Scanner
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

