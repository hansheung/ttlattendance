import { useEffect, useMemo, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  FieldValue,
  Timestamp,
  deleteField,
  getDoc,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  writeBatch,
  where,
  type DocumentSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { format, formatISO, subDays } from "date-fns";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Trash2 } from "lucide-react";
import { auth, db, functions } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import {
  buildSearchPrefixes,
  formatCurrencyRM,
  formatHoursMinutes,
  getDateKey,
  getTimeMinutes,
  normalizeSiteName,
} from "../lib/utils";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import type { AttendanceLog, AttendanceSession, SiteItem, UserProfile } from "../types";

type LocationFormState = {
  id?: string;
  name: string;
  lat: string;
  lng: string;
  allowedRadiusMeters: string;
};

type LogFormState = {
  id?: string;
  userId: string;
  siteId: string;
  scanType: "check-in" | "check-out";
  status: "success" | "fail";
  scanTime: string;
  adminNote: string;
  userLat: string;
  userLng: string;
  distanceMeters: string;
};

const emptyLocationForm: LocationFormState = {
  name: "",
  lat: "",
  lng: "",
  allowedRadiusMeters: "",
};

const emptyLogForm: LogFormState = {
  userId: "",
  siteId: "",
  scanType: "check-in",
  status: "success",
  scanTime: "",
  adminNote: "",
  userLat: "",
  userLng: "",
  distanceMeters: "",
};

const LOG_PAGE_SIZES = [10, 30, 50] as const;
const SESSION_PAGE_SIZES = [10, 30, 50] as const;
const TIME_ZONE = "Asia/Kuala_Lumpur";
const KL_OFFSET = "+08:00";

const formatDateTimeLocalValue = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  });
  const hour = values.hour === "24" ? "00" : values.hour;
  return `${values.year}-${values.month}-${values.day}T${hour}:${values.minute}`;
};

const parseDateTimeLocalValue = (value: string) => {
  if (!value) return null;
  return new Date(`${value}:00${KL_OFFSET}`);
};

const parseDateInputValue = (value: string, endOfDay = false) => {
  if (!value) return null;
  const time = endOfDay ? "23:59:59" : "00:00:00";
  return new Date(`${value}T${time}${KL_OFFSET}`);
};

const formatDateKeyLabel = (dateKey?: string | null) => {
  if (!dateKey) return "-";
  const date = new Date(`${dateKey}T00:00:00${KL_OFFSET}`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return format(date, "dd-MMM-yyyy");
};

type AttendanceLogAuditInput = Omit<
  Partial<AttendanceLog>,
  "createdAt" | "updatedAt" | "scanTime"
> & {
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  scanTime?: Timestamp | Date | FieldValue | null;
};

const buildAuditSnapshot = (log: AttendanceLogAuditInput | null) => {
  if (!log) return null;
  return {
    userId: log.userId,
    userEmail: log.userEmail,
    siteId: log.siteId,
    siteName: log.siteName,
    scanTime: log.scanTime,
    status: log.status,
    scanType: log.scanType ?? null,
    adminNote: log.adminNote ?? null,
    failReason: log.failReason ?? null,
    isDeleted: log.isDeleted ?? false,
    dateKey: log.dateKey ?? null,
  };
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

const recomputeSessionsForRange = async ({
  startDate,
  endDate,
  users,
}: {
  startDate: Date;
  endDate: Date;
  users: UserProfile[];
}) => {
  const {
    lateBufferMinutes,
    earlyCheckoutBufferMinutes,
    otEarlyBufferMinutes,
    otLateBufferMinutes,
  } = await getBufferSettings();
  const userMap = users.reduce<Record<string, UserProfile>>((acc, userItem) => {
    acc[userItem.uid] = userItem;
    return acc;
  }, {});

  const logsQuery = query(
    collection(db, "attendance"),
    where("status", "==", "success"),
    where("scanTime", ">=", startDate),
    where("scanTime", "<=", endDate),
    orderBy("scanTime", "asc"),
  );
  const logsSnapshot = await getDocs(logsQuery);

  const grouped = new Map<
    string,
    Array<{
      scanType?: "check-in" | "check-out";
      scanTime: Date;
      userId: string;
      userEmail: string;
      siteId: string;
      siteName: string;
      dateKey: string;
    }>
  >();

  logsSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() as AttendanceLog;
    if (data.isDeleted) return;
    const scanTime = data.scanTime.toDate();
    const dateKey = data.dateKey ?? getDateKey(scanTime, TIME_ZONE);
    const key = `${data.userId}|${dateKey}`;
    const list = grouped.get(key) ?? [];
    list.push({
      scanType: data.scanType ?? "check-in",
      scanTime,
      userId: data.userId,
      userEmail: data.userEmail,
      siteId: data.siteId,
      siteName: data.siteName,
      dateKey,
    });
    grouped.set(key, list);
  });

  for (const [key, list] of grouped.entries()) {
    const [userId, dateKey] = key.split("|");
    list.sort((a, b) => a.scanTime.getTime() - b.scanTime.getTime());

    const checkIns = list.filter((log) => log.scanType === "check-in");
    const checkOuts = list.filter((log) => log.scanType === "check-out");

    const firstCheckIn = checkIns.length
      ? checkIns.reduce((prev, next) =>
          prev.scanTime <= next.scanTime ? prev : next,
        )
      : null;
    const lastCheckOut = checkOuts.length
      ? checkOuts.reduce((prev, next) =>
          prev.scanTime >= next.scanTime ? prev : next,
        )
      : null;

    const checkInTime = firstCheckIn?.scanTime ?? null;
    const checkOutTime = lastCheckOut?.scanTime ?? null;
    const siteInId = firstCheckIn?.siteId ?? null;
    const siteInName = firstCheckIn?.siteName ?? null;
    const siteOutId = lastCheckOut?.siteId ?? null;
    const siteOutName = lastCheckOut?.siteName ?? null;
    const checkInMinutes = checkInTime
      ? getTimeMinutes(checkInTime, TIME_ZONE)
      : null;
    const checkOutMinutes = checkOutTime
      ? getTimeMinutes(checkOutTime, TIME_ZONE)
      : null;
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

    const isLate =
      checkInMinutes !== null &&
      checkInMinutes > 8 * 60 + lateBufferMinutes;
    const lateReason = isLate
      ? `Check-in after 8:00 + ${lateBufferMinutes} min`
      : null;

    const isAbnormal = abnormalReasons.length > 0;
    const normalHours =
      !isAbnormal && totalHoursRounded !== null
        ? Number(Math.min(totalHoursRounded, 9).toFixed(2))
        : null;
    const otHoursRounded = !isAbnormal ? otHours : null;
    const status = checkInTime && checkOutTime ? "complete" : "incomplete";

    const userItem = userMap[userId];
    const userName = userItem?.name ?? "User";
    const userEmail = userItem?.email ?? list[0].userEmail;
    const normalRate = userItem?.normalRate ?? 0;
    const otRate = userItem?.otRate ?? 0;
    const amountRM = isAbnormal
      ? null
      : Number(
          ((normalHours ?? 0) * normalRate + (otHoursRounded ?? 0) * otRate).toFixed(2),
        );

    const sessionQuery = query(
      collection(db, "attendanceSessions"),
      where("userId", "==", userId),
      where("dateKey", "==", dateKey),
    );
    const sessionSnapshot = await getDocs(sessionQuery);
    const batch = writeBatch(db);

    sessionSnapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));

    const sessionRef = doc(collection(db, "attendanceSessions"));
    batch.set(sessionRef, {
      userId,
      userEmail,
      userName,
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
        userName,
        userEmail,
        userItem?.employeeId ?? "",
      ]),
    });

    await batch.commit();
  }
};

export function AdminDashboard() {
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState("logs");
  const [locations, setLocations] = useState<SiteItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [locationForm, setLocationForm] = useState<LocationFormState>(emptyLocationForm);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [siteSearch, setSiteSearch] = useState("");
  const [sitePageSize, setSitePageSize] = useState<number>(30);
  const [sitePageIndex, setSitePageIndex] = useState(0);

  useEffect(() => {
    const fetchLocations = async () => {
      setLoadingLocations(true);
      const snapshot = await getDocs(query(collection(db, "sites"), orderBy("createdAt", "desc")));
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<SiteItem, "id">),
      }));
      setLocations(items);
      setLoadingLocations(false);
    };
    fetchLocations();
  }, []);

  const refreshUsers = async () => {
    const snapshot = await getDocs(
      query(collection(db, "users"), orderBy("email", "asc")),
    );
    const items = snapshot.docs.map((docSnap) => ({
      uid: docSnap.id,
      ...(docSnap.data() as Omit<UserProfile, "uid">),
    }));
    setUsers(items);
  };

  useEffect(() => {
    refreshUsers();
  }, []);

  const handleOpenCreate = () => {
    setLocationForm(emptyLocationForm);
    setLocationError(null);
    setLocationDialogOpen(true);
  };

  const handleEdit = (item: SiteItem) => {
    setLocationForm({
      id: item.id,
      name: item.name,
      lat: item.lat.toString(),
      lng: item.lng.toString(),
      allowedRadiusMeters: item.allowedRadiusMeters.toString(),
    });
    setLocationError(null);
    setLocationDialogOpen(true);
  };

  const validateLocationForm = async () => {
    if (!locationForm.name.trim()) {
      return "Name is required.";
    }
    const lat = Number(locationForm.lat);
    const lng = Number(locationForm.lng);
    const radius = Number(locationForm.allowedRadiusMeters);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return "Latitude and longitude must be numeric.";
    }
    if (Number.isNaN(radius) || radius <= 0) {
      return "Radius must be a positive number.";
    }

    const normalized = normalizeSiteName(locationForm.name);
    const existingQuery = query(
      collection(db, "sites"),
      where("nameNormalized", "==", normalized),
      limit(1),
    );
    const existingSnapshot = await getDocs(existingQuery);
    if (!existingSnapshot.empty) {
      const existingId = existingSnapshot.docs[0].id;
      if (!locationForm.id || existingId !== locationForm.id) {
        return "Site name must be unique.";
      }
    }
    return null;
  };

  const handleSaveLocation = async () => {
    setLocationError(null);
    const validationError = await validateLocationForm();
    if (validationError) {
      setLocationError(validationError);
      return;
    }

    const updatePayload = {
      name: locationForm.name.trim(),
      nameNormalized: normalizeSiteName(locationForm.name),
      lat: Number(locationForm.lat),
      lng: Number(locationForm.lng),
      allowedRadiusMeters: Number(locationForm.allowedRadiusMeters),
      updatedAt: serverTimestamp(),
    };
    const statePayload = {
      name: locationForm.name.trim(),
      nameNormalized: normalizeSiteName(locationForm.name),
      lat: Number(locationForm.lat),
      lng: Number(locationForm.lng),
      allowedRadiusMeters: Number(locationForm.allowedRadiusMeters),
    };

    if (locationForm.id) {
      await updateDoc(doc(db, "sites", locationForm.id), updatePayload);
      setLocations((prev) =>
        prev.map((item) =>
          item.id === locationForm.id ? { ...item, ...statePayload } : item,
        ),
      );
    } else {
      const docRef = await addDoc(collection(db, "sites"), {
        ...updatePayload,
        createdAt: serverTimestamp(),
      });
      setLocations((prev) => [
        { id: docRef.id, ...statePayload },
        ...prev,
      ]);
    }

    setLocationDialogOpen(false);
    setLocationForm(emptyLocationForm);
  };

  const handleDeleteLocation = async (id: string) => {
    await deleteDoc(doc(db, "sites", id));
    setLocations((prev) => prev.filter((item) => item.id !== id));
  };

  const normalizedSiteSearch = siteSearch.trim().toLowerCase();
  const filteredSites = useMemo(() => {
    if (!normalizedSiteSearch) return locations;
    return locations.filter((site) =>
      site.name.toLowerCase().includes(normalizedSiteSearch),
    );
  }, [locations, normalizedSiteSearch]);

  const sitePageCount = Math.max(
    1,
    Math.ceil(filteredSites.length / sitePageSize),
  );
  const pagedSites = useMemo(() => {
    const start = sitePageIndex * sitePageSize;
    return filteredSites.slice(start, start + sitePageSize);
  }, [filteredSites, sitePageIndex, sitePageSize]);

  useEffect(() => {
    setSitePageIndex(0);
  }, [siteSearch, sitePageSize]);

  useEffect(() => {
    if (sitePageIndex >= sitePageCount) {
      setSitePageIndex(Math.max(0, sitePageCount - 1));
    }
  }, [sitePageCount, sitePageIndex]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Admin Dashboard" onLogout={logout} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 fade-in-up">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="logs">Attendance Logs</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="locations">Sites</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="late">Late</TabsTrigger>
            <TabsTrigger value="abnormal">Abnormal</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          </TabsList>

            <TabsContent value="locations">
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle>Sites</CardTitle>
                  <Button onClick={handleOpenCreate}>+ Add Site</Button>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex flex-col gap-3">
                    <div className="w-full">
                      <Label>Search site</Label>
                      <Input
                        value={siteSearch}
                        onChange={(event) => setSiteSearch(event.target.value)}
                        placeholder="Search by site name"
                      />
                    </div>
                  </div>
                  {loadingLocations ? (
                    <p className="text-sm text-slate-500">Loading sites...</p>
                  ) : locations.length === 0 ? (
                    <p className="text-sm text-slate-500">No sites yet.</p>
                  ) : filteredSites.length === 0 ? (
                    <p className="text-sm text-slate-500">No sites found.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                        <TableHead>Lat</TableHead>
                        <TableHead>Lng</TableHead>
                        <TableHead>Radius (m)</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedSites.map((locationItem) => (
                          <TableRow key={locationItem.id}>
                            <TableCell>{locationItem.name}</TableCell>
                            <TableCell>{locationItem.lat}</TableCell>
                            <TableCell>{locationItem.lng}</TableCell>
                          <TableCell>{locationItem.allowedRadiusMeters}</TableCell>
                          <TableCell className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(locationItem)}
                            >
                              Edit
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm">
                                  Delete
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Delete {locationItem.name}?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will remove the site and prevent future check-ins.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteLocation(locationItem.id)}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {filteredSites.length > 0 ? (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm text-slate-500">
                        Page {sitePageIndex + 1} of {sitePageCount}
                      </span>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="text-sm text-slate-500">Rows</span>
                        <Select
                          value={String(sitePageSize)}
                          onValueChange={(value) => {
                            const next = Number(value);
                            setSitePageSize(Number.isNaN(next) ? 30 : next);
                          }}
                        >
                          <SelectTrigger className="h-9 w-[88px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LOG_PAGE_SIZES.map((size) => (
                              <SelectItem key={size} value={String(size)}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setSitePageIndex((prev) => Math.max(prev - 1, 0))
                          }
                          disabled={sitePageIndex === 0}
                        >
                          Prev
                        </Button>
                        <span className="text-sm text-slate-500">
                          Page {sitePageIndex + 1}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setSitePageIndex((prev) =>
                              Math.min(prev + 1, sitePageCount - 1),
                            )
                          }
                          disabled={sitePageIndex + 1 >= sitePageCount}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

          <TabsContent value="logs">
            <AttendanceLogsPanel locations={locations} users={users} />
          </TabsContent>

          <TabsContent value="sessions">
            <SessionsPanel locations={locations} users={users} />
          </TabsContent>

          <TabsContent value="users">
            <UsersPanel users={users} onRefresh={refreshUsers} />
          </TabsContent>

          <TabsContent value="late">
            <LatePanel />
          </TabsContent>

          <TabsContent value="abnormal">
            <AbnormalPanel />
          </TabsContent>

          <TabsContent value="maintenance">
            <MaintenancePanel />
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locationForm.id ? "Edit Site" : "Add Site"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={locationForm.name}
                onChange={(event) =>
                  setLocationForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Latitude</Label>
                <Input
                  value={locationForm.lat}
                  onChange={(event) =>
                    setLocationForm((prev) => ({
                      ...prev,
                      lat: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Longitude</Label>
                <Input
                  value={locationForm.lng}
                  onChange={(event) =>
                    setLocationForm((prev) => ({
                      ...prev,
                      lng: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Allowed Radius (meters)</Label>
              <Input
                value={locationForm.allowedRadiusMeters}
                onChange={(event) =>
                  setLocationForm((prev) => ({
                    ...prev,
                    allowedRadiusMeters: event.target.value,
                  }))
                }
              />
            </div>
            {locationError ? (
              <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {locationError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setLocationDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveLocation}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttendanceLogsPanel({
  locations,
  users,
}: {
  locations: SiteItem[];
  users: UserProfile[];
}) {
  const { user: adminUser, profile: adminProfile } = useAuth();
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [logPageSize, setLogPageSize] = useState<number>(30);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<DocumentSnapshot[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<AttendanceLog | null>(null);
  const [logForm, setLogForm] = useState<LogFormState>(emptyLogForm);
  const [logFormError, setLogFormError] = useState<string | null>(null);
  const [savingLog, setSavingLog] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceLog | null>(null);
  const [recomputePrompt, setRecomputePrompt] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [recomputeRunning, setRecomputeRunning] = useState(false);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  const searchToken = useMemo(() => search.trim().toLowerCase(), [search]);
  const resetPagination = () => {
    setPageIndex(0);
    setPageCursors([]);
  };
  const visibleLogs = useMemo(
    () => logs.filter((log) => !log.isDeleted),
    [logs],
  );
  const canManageLogs = users.length > 0 && locations.length > 0;
  const userMap = useMemo(() => {
    return users.reduce<Record<string, UserProfile>>((acc, userItem) => {
      acc[userItem.uid] = userItem;
      return acc;
    }, {});
  }, [users]);

  const buildDefaultLogForm = (overrides?: Partial<LogFormState>) => ({
    ...emptyLogForm,
    userId: overrides?.userId ?? users[0]?.uid ?? "",
    siteId: overrides?.siteId ?? locations[0]?.id ?? "",
    scanType: overrides?.scanType ?? "check-in",
    status: overrides?.status ?? "success",
    scanTime: overrides?.scanTime ?? formatDateTimeLocalValue(new Date()),
    adminNote: overrides?.adminNote ?? "",
    userLat: overrides?.userLat ?? "",
    userLng: overrides?.userLng ?? "",
    distanceMeters: overrides?.distanceMeters ?? "",
  });

  const openCreateLog = () => {
    setEditingLog(null);
    setLogForm(buildDefaultLogForm());
    setLogFormError(null);
    setLogDialogOpen(true);
  };

  const openEditLog = (log: AttendanceLog) => {
    setEditingLog(log);
    setLogForm(
      buildDefaultLogForm({
        id: log.id,
        userId: log.userId,
        siteId: log.siteId,
        scanType: log.scanType ?? "check-in",
        status: log.status,
        scanTime: formatDateTimeLocalValue(log.scanTime.toDate()),
        adminNote: log.adminNote ?? "",
        userLat: log.userLat !== null && log.userLat !== undefined ? log.userLat.toString() : "",
        userLng: log.userLng !== null && log.userLng !== undefined ? log.userLng.toString() : "",
        distanceMeters:
          log.distanceMeters !== null && log.distanceMeters !== undefined
            ? log.distanceMeters.toFixed(1)
            : "",
      }),
    );
    setLogFormError(null);
    setLogDialogOpen(true);
  };

  const openDeleteLog = (log: AttendanceLog) => {
    setDeleteTarget(log);
    setDeleteDialogOpen(true);
  };

  const writeAuditEntries = (
    batch: ReturnType<typeof writeBatch>,
    logId: string,
    action: "create" | "update" | "delete",
    before: AttendanceLogAuditInput | null,
    after: AttendanceLogAuditInput | null,
  ) => {
    if (!adminUser || !adminProfile) return;
    const auditPayload = {
      logId,
      action,
      adminId: adminUser.uid,
      adminEmail: adminProfile.email,
      createdAt: serverTimestamp(),
      before: buildAuditSnapshot(before),
      after: buildAuditSnapshot(after),
    };
    const auditRef = doc(collection(db, "attendanceAudit"));
    const auditSubRef = doc(collection(db, "attendance", logId, "audit"));
    batch.set(auditRef, auditPayload);
    batch.set(auditSubRef, auditPayload);
  };

  const handleSaveLog = async () => {
    if (savingLog) return;
    if (!adminUser || !adminProfile) {
      setLogFormError("Admin profile not available.");
      return;
    }
    if (!logForm.userId || !logForm.siteId || !logForm.scanTime) {
      setLogFormError("User, site, and time are required.");
      return;
    }

    const userItem = users.find((item) => item.uid === logForm.userId);
    const locationItem = locations.find(
      (item) => item.id === logForm.siteId,
    );
    if (!userItem || !locationItem) {
      setLogFormError("Select a valid user and site.");
      return;
    }
    const scanDate = parseDateTimeLocalValue(logForm.scanTime);
    if (!scanDate) {
      setLogFormError("Invalid date/time value.");
      return;
    }

    setSavingLog(true);
    setLogFormError(null);
    setLogsError(null);
    try {
      const scanTimestamp = Timestamp.fromDate(scanDate);
      const dateKey = getDateKey(scanDate, TIME_ZONE);
      const searchPrefixes = buildSearchPrefixes([
        userItem.name ?? "",
        userItem.email,
        locationItem.name,
      ]);
      const latValue = logForm.userLat.trim();
      const lngValue = logForm.userLng.trim();
      const distanceValue = logForm.distanceMeters.trim();
      const userLat =
        latValue === "" ? null : Number.isNaN(Number(latValue)) ? null : Number(latValue);
      const userLng =
        lngValue === "" ? null : Number.isNaN(Number(lngValue)) ? null : Number(lngValue);
      const distanceMeters =
        distanceValue === ""
          ? null
          : Number.isNaN(Number(distanceValue))
            ? null
            : Number((Number(distanceValue)).toFixed(1));

      const commonPayload = {
        userId: userItem.uid,
        userEmail: userItem.email,
        siteId: locationItem.id,
        siteName: locationItem.name,
        scanTime: scanTimestamp,
        dateKey,
        status: logForm.status,
        scanType: logForm.scanType,
        searchPrefixes,
        adminNote: logForm.adminNote.trim(),
        allowedRadiusMeters: locationItem.allowedRadiusMeters,
        userLat,
        userLng,
        distanceMeters,
      };

      if (!editingLog) {
        const logRef = doc(collection(db, "attendance"));
        const batch = writeBatch(db);
        const newLog = {
          ...commonPayload,
          ...(logForm.status === "success" ? {} : { failReason: "Manual entry" }),
          isDeleted: false,
          createdBy: "admin" as const,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: adminUser.uid,
          updatedByEmail: adminProfile.email,
        };
        batch.set(logRef, newLog);
        writeAuditEntries(batch, logRef.id, "create", null, newLog);
        await batch.commit();
      } else {
        const logRef = doc(db, "attendance", editingLog.id);
        const batch = writeBatch(db);
        const updatePayload = {
          ...commonPayload,
          failReason:
            logForm.status === "success"
              ? deleteField()
              : editingLog.failReason ?? "Manual entry",
          updatedAt: serverTimestamp(),
          updatedBy: adminUser.uid,
          updatedByEmail: adminProfile.email,
        };
        batch.update(logRef, updatePayload);
        writeAuditEntries(batch, logRef.id, "update", editingLog, {
          ...editingLog,
          ...commonPayload,
          failReason:
            logForm.status === "success"
              ? undefined
              : editingLog.failReason ?? "Manual entry",
        });
        await batch.commit();
      }

      setLogDialogOpen(false);
      setEditingLog(null);
      resetPagination();
      await loadLogs();
      setRecomputePrompt({ start: dateKey, end: dateKey });
    } catch (err: unknown) {
      setLogFormError(
        err instanceof Error ? err.message : "Unable to save attendance log.",
      );
    } finally {
      setSavingLog(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !adminUser || !adminProfile) return;
    setLogsError(null);
    setRecomputeError(null);
    try {
      const logRef = doc(db, "attendance", deleteTarget.id);
      const batch = writeBatch(db);
      writeAuditEntries(batch, logRef.id, "delete", deleteTarget, null);
      batch.delete(logRef);
      await batch.commit();
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      await loadLogs();
      const logDate = deleteTarget.scanTime.toDate();
      const dateKey = getDateKey(logDate, TIME_ZONE);
      setRecomputePrompt({ start: dateKey, end: dateKey });
    } catch (err: unknown) {
      setLogsError(
        err instanceof Error ? err.message : "Unable to delete attendance log.",
      );
    }
  };

  const handleRecomputePrompt = async () => {
    if (!recomputePrompt || recomputeRunning) return;
    setRecomputeError(null);
    setRecomputeRunning(true);
    const startDate = parseDateInputValue(recomputePrompt.start, false);
    const endDate = parseDateInputValue(recomputePrompt.end, true);
    if (!startDate || !endDate) {
      setRecomputeError("Invalid date range.");
      setRecomputeRunning(false);
      return;
    }
    try {
      await recomputeSessionsForRange({ startDate, endDate, users });
      setRecomputePrompt(null);
    } catch (err: unknown) {
      setRecomputeError(
        err instanceof Error ? err.message : "Unable to recompute sessions.",
      );
    } finally {
      setRecomputeRunning(false);
    }
  };

  const buildBaseQuery = () => {
    const constraints: any[] = [orderBy("scanTime", "desc")];

    if (searchToken) {
      constraints.push(where("searchPrefixes", "array-contains", searchToken));
    }
    if (statusFilter !== "all") {
      constraints.push(where("status", "==", statusFilter));
    }
    if (typeFilter !== "all") {
      constraints.push(where("scanType", "==", typeFilter));
    }
    if (locationFilter !== "all") {
      constraints.push(where("siteId", "==", locationFilter));
    }
    if (userFilter !== "all") {
      constraints.push(where("userEmail", "==", userFilter));
    }

    if (dateStart) {
      const startDate = new Date(dateStart);
      startDate.setHours(0, 0, 0, 0);
      constraints.push(where("scanTime", ">=", startDate));
    }
    if (dateEnd) {
      const endDate = new Date(dateEnd);
      endDate.setHours(23, 59, 59, 999);
      constraints.push(where("scanTime", "<=", endDate));
    }

    return query(collection(db, "attendance"), ...constraints);
  };

  const loadLogs = async () => {
    if (searchToken.includes(" ")) {
      setSearchError("Search supports a single term only.");
      setLogs([]);
      setLoading(false);
      setTotalCount(null);
      return;
    }

    setSearchError(null);
    setLogsError(null);
    setLoading(true);

    try {
      let logsQuery = buildBaseQuery();
      if (pageIndex > 0 && pageCursors[pageIndex - 1]) {
        logsQuery = query(logsQuery, startAfter(pageCursors[pageIndex - 1]));
      }
      logsQuery = query(logsQuery, limit(logPageSize));

      const snapshot = await getDocs(logsQuery);
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<AttendanceLog, "id">),
      }));
      setLogs(items);
      setHasNext(items.length === logPageSize);
      setLoading(false);

      if (snapshot.docs.length > 0) {
        setPageCursors((prev) => {
          const next = [...prev];
          next[pageIndex] = snapshot.docs[snapshot.docs.length - 1];
          return next;
        });
      }

      const countSnapshot = await getCountFromServer(buildBaseQuery());
      setTotalCount(countSnapshot.data().count);
    } catch (err: unknown) {
      setLoading(false);
      setLogs([]);
      setLogsError(
        err instanceof Error ? err.message : "Unable to load attendance logs.",
      );
    }
  };

  useEffect(() => {
    loadLogs();
  }, [
    pageIndex,
    searchToken,
    statusFilter,
    typeFilter,
    locationFilter,
    userFilter,
    dateStart,
    dateEnd,
    logPageSize,
  ]);

  const handlePreset = (days: number) => {
    const endDate = new Date();
    const startDate = subDays(endDate, days);
    setDateStart(formatISO(startDate, { representation: "date" }));
    setDateEnd(formatISO(endDate, { representation: "date" }));
    resetPagination();
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Attendance Logs</CardTitle>
        <Button onClick={openCreateLog} disabled={!canManageLogs}>
          + Add Log
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-2">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPagination();
              }}
              placeholder="name or email"
            />
            {searchError ? (
              <p className="text-xs text-red-600">{searchError}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Site</Label>
            <Select
              value={locationFilter}
              onValueChange={(value) => {
                setLocationFilter(value);
                resetPagination();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {locations.map((locationItem) => (
                  <SelectItem key={locationItem.id} value={locationItem.id}>
                    {locationItem.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                resetPagination();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                setTypeFilter(value);
                resetPagination();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="check-in">In</SelectItem>
                <SelectItem value="check-out">Out</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Select
              value={userFilter}
              onValueChange={(value) => {
                setUserFilter(value);
                resetPagination();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {users.map((userItem) => (
                  <SelectItem key={userItem.uid} value={userItem.email}>
                    {userItem.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-2">
              <Label>Start date</Label>
              <Input
                type="date"
                value={dateStart}
                onChange={(event) => {
                  setDateStart(event.target.value);
                  resetPagination();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>End date</Label>
              <Input
                type="date"
                value={dateEnd}
                onChange={(event) => {
                  setDateEnd(event.target.value);
                  resetPagination();
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => handlePreset(0)}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePreset(7)}>
              7d
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePreset(30)}>
              30d
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setTypeFilter("all");
                setLocationFilter("all");
                setUserFilter("all");
                setDateStart("");
                setDateEnd("");
                resetPagination();
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>

        {recomputePrompt ? (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-slate-700">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Edits made. Recompute sessions for{" "}
                {recomputePrompt.start === recomputePrompt.end
                  ? formatDateKeyLabel(recomputePrompt.start)
                  : `${formatDateKeyLabel(recomputePrompt.start)} to ${formatDateKeyLabel(
                      recomputePrompt.end,
                    )}`}
                ?
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleRecomputePrompt}
                  disabled={recomputeRunning}
                >
                  {recomputeRunning ? "Recomputing..." : "Recompute"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRecomputePrompt(null);
                    setRecomputeError(null);
                  }}
                >
                  Dismiss
                </Button>
              </div>
            </div>
            {recomputeError ? (
              <p className="mt-2 text-sm text-red-600">{recomputeError}</p>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading logs...</p>
        ) : logsError ? (
          <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {logsError}
          </p>
        ) : visibleLogs.length === 0 ? (
          <p className="text-sm text-slate-500">No logs match your filters.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{format(log.scanTime.toDate(), "dd-MMM-yyyy")}</TableCell>
                  <TableCell>{format(log.scanTime.toDate(), "p")}</TableCell>
                  <TableCell>{userMap[log.userId]?.name ?? "-"}</TableCell>
                  <TableCell>{log.userEmail}</TableCell>
                  <TableCell>{log.siteName}</TableCell>
                  <TableCell>
                    {log.status === "success" ? (
                      <Badge variant="success">Success</Badge>
                    ) : (
                      <Badge variant="destructive">Fail</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {log.scanType ? (
                      log.scanType === "check-in" ? (
                        <Badge variant="success">In</Badge>
                      ) : (
                        <Badge variant="secondary">Out</Badge>
                      )
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>{log.failReason ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openEditLog(log)}
                        aria-label="Edit attendance log"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => openDeleteLog(log)}
                        aria-label="Delete attendance log"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            {totalCount !== null
              ? `Total matches: ${totalCount}`
              : "Calculating total..."}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Rows</span>
              <Select
                value={String(logPageSize)}
                onValueChange={(value) => {
                  const numeric = Number(value);
                  setLogPageSize(Number.isNaN(numeric) ? 30 : numeric);
                  resetPagination();
                }}
              >
                <SelectTrigger className="h-9 w-[88px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
              disabled={pageIndex === 0}
            >
              Prev
            </Button>
            <span className="text-sm text-slate-500">Page {pageIndex + 1}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((prev) => prev + 1)}
              disabled={!hasNext}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>

      <Dialog
        open={logDialogOpen}
        onOpenChange={(open) => {
          setLogDialogOpen(open);
          if (!open) {
            setEditingLog(null);
            setLogFormError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingLog ? "Edit Attendance Log" : "Add Attendance Log"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editingLog ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={userMap[logForm.userId]?.name ?? "-"}
                    readOnly
                    className="bg-slate-50"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    value={userMap[logForm.userId]?.email ?? ""}
                    readOnly
                    className="bg-slate-50"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>User</Label>
                <Select
                  value={logForm.userId}
                  onValueChange={(value) =>
                    setLogForm((prev) => ({ ...prev, userId: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((userItem) => (
                      <SelectItem key={userItem.uid} value={userItem.uid}>
                        {userItem.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Site</Label>
              <Select
                value={logForm.siteId}
                onValueChange={(value) =>
                  setLogForm((prev) => ({ ...prev, siteId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((locationItem) => (
                    <SelectItem key={locationItem.id} value={locationItem.id}>
                      {locationItem.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={logForm.scanType}
                  onValueChange={(value) =>
                    setLogForm((prev) => ({
                      ...prev,
                      scanType: value as "check-in" | "check-out",
                    }))
                  }
                >
                  <SelectTrigger>
                  <SelectValue placeholder="In" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check-in">In</SelectItem>
                    <SelectItem value="check-out">Out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={logForm.status}
                  onValueChange={(value) =>
                    setLogForm((prev) => ({
                      ...prev,
                      status: value as "success" | "fail",
                    }))
                  }
                >
                  <SelectTrigger
                    className={
                      logForm.status === "fail"
                        ? "border-red-200 text-red-600"
                        : undefined
                    }
                  >
                    <SelectValue placeholder="Success" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="fail">Fail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editingLog ? (
              <div className="space-y-2">
                <Label>Reason</Label>
                <Input
                  value={editingLog.failReason ?? "-"}
                  readOnly
                  className="bg-slate-50"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Time (Asia/Kuala_Lumpur)</Label>
              <Input
                type="datetime-local"
                value={logForm.scanTime}
                onChange={(event) =>
                  setLogForm((prev) => ({
                    ...prev,
                    scanTime: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Admin Note (optional)</Label>
              <Input
                value={logForm.adminNote}
                onChange={(event) =>
                  setLogForm((prev) => ({
                    ...prev,
                    adminNote: event.target.value,
                  }))
                }
                placeholder="Reason for manual adjustment"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>User Lat</Label>
                <Input
                  value={logForm.userLat}
                  onChange={(event) =>
                    setLogForm((prev) => ({
                      ...prev,
                      userLat: event.target.value,
                    }))
                  }
                  readOnly={Boolean(editingLog)}
                  className={editingLog ? "bg-slate-50" : undefined}
                  placeholder="e.g. 3.12345"
                />
              </div>
              <div className="space-y-2">
                <Label>User Lng</Label>
                <Input
                  value={logForm.userLng}
                  onChange={(event) =>
                    setLogForm((prev) => ({
                      ...prev,
                      userLng: event.target.value,
                    }))
                  }
                  readOnly={Boolean(editingLog)}
                  className={editingLog ? "bg-slate-50" : undefined}
                  placeholder="e.g. 101.67890"
                />
              </div>
              <div className="space-y-2">
                <Label>Distance (m)</Label>
                <Input
                  value={logForm.distanceMeters}
                  onChange={(event) =>
                    setLogForm((prev) => ({
                      ...prev,
                      distanceMeters: event.target.value,
                    }))
                  }
                  readOnly={Boolean(editingLog)}
                  className={editingLog ? "bg-slate-50" : undefined}
                  placeholder="e.g. 25"
                />
              </div>
            </div>
            {logFormError ? (
              <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {logFormError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setLogDialogOpen(false);
                setEditingLog(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveLog} disabled={savingLog || !canManageLogs}>
              {savingLog ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attendance log?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the log and remove it from user history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SessionsPanel({
  locations,
  users,
}: {
  locations: SiteItem[];
  users: UserProfile[];
}) {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [locationInFilter, setLocationInFilter] = useState("all");
  const [locationOutFilter, setLocationOutFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<DocumentSnapshot[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [recomputeStart, setRecomputeStart] = useState("");
  const [recomputeEnd, setRecomputeEnd] = useState("");
  const [recomputeStatus, setRecomputeStatus] = useState<string | null>(null);
  const [recomputeDialogOpen, setRecomputeDialogOpen] = useState(false);
  const [sessionPageSize, setSessionPageSize] = useState<number>(30);

  const searchToken = useMemo(() => search.trim().toLowerCase(), [search]);
  const resetPagination = () => {
    setPageIndex(0);
    setPageCursors([]);
  };

  const buildBaseQuery = () => {
    const constraints: any[] = [orderBy("checkInTime", "desc")];

    if (searchToken) {
      constraints.push(where("searchPrefixes", "array-contains", searchToken));
    }
    if (locationInFilter !== "all") {
      constraints.push(where("siteInId", "==", locationInFilter));
    }
    if (locationOutFilter !== "all") {
      constraints.push(where("siteOutId", "==", locationOutFilter));
    }
    if (statusFilter === "abnormal") {
      constraints.push(where("isAbnormal", "==", true));
    } else if (statusFilter !== "all") {
      constraints.push(where("status", "==", statusFilter));
    }
    if (dateStart) {
      const startDate = new Date(dateStart);
      startDate.setHours(0, 0, 0, 0);
      constraints.push(where("checkInTime", ">=", startDate));
    }
    if (dateEnd) {
      const endDate = new Date(dateEnd);
      endDate.setHours(23, 59, 59, 999);
      constraints.push(where("checkInTime", "<=", endDate));
    }

    return query(collection(db, "attendanceSessions"), ...constraints);
  };

  const loadSessions = async () => {
    if (searchToken.includes(" ")) {
      setSearchError("Search supports a single term only.");
      setSessions([]);
      setLoading(false);
      setTotalCount(null);
      return;
    }

    setSearchError(null);
    setSessionsError(null);
    setLoading(true);

    try {
      let sessionsQuery = buildBaseQuery();
      if (pageIndex > 0 && pageCursors[pageIndex - 1]) {
        sessionsQuery = query(
          sessionsQuery,
          startAfter(pageCursors[pageIndex - 1]),
        );
      }
      sessionsQuery = query(sessionsQuery, limit(sessionPageSize));

      const snapshot = await getDocs(sessionsQuery);
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<AttendanceSession, "id">),
      }));
      setSessions(items);
      setHasNext(items.length === sessionPageSize);
      setLoading(false);

      if (snapshot.docs.length > 0) {
        setPageCursors((prev) => {
          const next = [...prev];
          next[pageIndex] = snapshot.docs[snapshot.docs.length - 1];
          return next;
        });
      }

      const countSnapshot = await getCountFromServer(buildBaseQuery());
      setTotalCount(countSnapshot.data().count);
    } catch (err: unknown) {
      setLoading(false);
      setSessions([]);
      setSessionsError(
        err instanceof Error ? err.message : "Unable to load sessions.",
      );
    }
  };

  useEffect(() => {
    loadSessions();
  }, [
    pageIndex,
    searchToken,
    locationInFilter,
    locationOutFilter,
    statusFilter,
    dateStart,
    dateEnd,
    sessionPageSize,
  ]);

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    setSessionsError(null);

    try {
      const snapshot = await getDocs(buildBaseQuery());
      const rows = snapshot.docs.map((docSnap) => ({
        ...(docSnap.data() as Omit<AttendanceSession, "id">),
      }));
      const headers = [
        "Name",
        "Email",
        "Date",
        "Site In",
        "In",
        "Site Out",
        "Out",
        "Total Hours",
        "Normal",
        "OT",
        "Amount",
        "Status",
      ];
      const csvRows = [
        headers.join(","),
        ...rows.map((row) => {
          const checkIn = row.checkInTime?.toDate
            ? format(row.checkInTime.toDate(), "p")
            : "";
          const checkOut = row.checkOutTime?.toDate
            ? format(row.checkOutTime.toDate(), "p")
            : "";
          const values = [
            row.userName,
            row.userEmail,
            formatDateKeyLabel(row.dateKey),
            row.siteInName ?? row.siteName ?? "",
            checkIn,
            row.siteOutName ?? row.siteName ?? "",
            checkOut,
            formatHoursMinutes(row.totalHours ?? null),
            formatHoursMinutes(row.normalHours ?? null),
            formatHoursMinutes(row.otHours ?? null),
            row.amountRM !== null ? row.amountRM.toFixed(2) : "",
            row.isAbnormal ? "Abnormal" : row.status,
          ];
          return values
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
            .join(",");
        }),
      ];

      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "attendance-sessions.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setSessionsError(
        err instanceof Error ? err.message : "Unable to export CSV.",
      );
    } finally {
      setExporting(false);
    }
  };

  const recomputeSessions = async () => {
    if (!recomputeStart || !recomputeEnd) {
      setRecomputeStatus("Select a start and end date to recompute.");
      return;
    }
    setRecomputeStatus("Recomputing sessions...");
    const startDate = parseDateInputValue(recomputeStart, false);
    const endDate = parseDateInputValue(recomputeEnd, true);
    if (!startDate || !endDate) {
      setRecomputeStatus("Invalid date range.");
      return;
    }

    try {
      await recomputeSessionsForRange({ startDate, endDate, users });
      setRecomputeStatus("Recompute complete.");
      loadSessions();
      setRecomputeDialogOpen(false);
    } catch (err: unknown) {
      setRecomputeStatus(
        err instanceof Error ? err.message : "Recompute failed.",
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Sessions</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setRecomputeDialogOpen(true)}>
              Recompute
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={exporting}>
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="space-y-2 lg:col-span-4">
              <Label>Search Name or Email</Label>
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  resetPagination();
                }}
                placeholder="name or email"
              />
              {searchError ? (
                <p className="text-xs text-red-600">{searchError}</p>
              ) : null}
            </div>
            <div className="space-y-2 lg:col-span-3">
              <Label>Site-in</Label>
              <Select
                value={locationInFilter}
                onValueChange={(value) => {
                  setLocationInFilter(value);
                  resetPagination();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {locations.map((locationItem) => (
                    <SelectItem key={locationItem.id} value={locationItem.id}>
                      {locationItem.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 lg:col-span-3">
              <Label>Site-out</Label>
              <Select
                value={locationOutFilter}
                onValueChange={(value) => {
                  setLocationOutFilter(value);
                  resetPagination();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {locations.map((locationItem) => (
                    <SelectItem key={locationItem.id} value={locationItem.id}>
                      {locationItem.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  resetPagination();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                  <SelectItem value="incomplete">Incomplete</SelectItem>
                  <SelectItem value="abnormal">Abnormal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <Label>Date Range</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={dateStart}
                  onChange={(event) => {
                    setDateStart(event.target.value);
                    resetPagination();
                  }}
                />
                <Input
                  type="date"
                  value={dateEnd}
                  onChange={(event) => {
                    setDateEnd(event.target.value);
                    resetPagination();
                  }}
                />
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="lg:self-auto"
              onClick={() => {
                setSearch("");
                setLocationInFilter("all");
                setLocationOutFilter("all");
                setStatusFilter("all");
                setDateStart("");
                setDateEnd("");
                resetPagination();
              }}
            >
              Clear filters
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading sessions...</p>
          ) : sessionsError ? (
            <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
              {sessionsError}
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-slate-500">No sessions found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Site-in</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Site-out</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Normal</TableHead>
                  <TableHead>OT</TableHead>
                  <TableHead>Amount (RM)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>{session.userName}</TableCell>
                    <TableCell>{session.userEmail}</TableCell>
                    <TableCell>{formatDateKeyLabel(session.dateKey)}</TableCell>
                    <TableCell>{session.siteInName ?? "-"}</TableCell>
                      <TableCell>
                        {session.checkInTime ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={
                                session.isLate ? "font-medium text-red-600" : undefined
                              }
                            >
                              {format(session.checkInTime.toDate(), "p")}
                            </span>
                            {session.isLate ? (
                              <Badge variant="destructive" className="h-5 px-2">
                                Late
                              </Badge>
                            ) : null}
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    <TableCell>{session.siteOutName ?? "-"}</TableCell>
                    <TableCell>
                      {session.checkOutTime
                        ? format(session.checkOutTime.toDate(), "p")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {formatHoursMinutes(session.totalHours ?? null)}
                    </TableCell>
                    <TableCell>
                      {formatHoursMinutes(session.normalHours ?? null)}
                    </TableCell>
                    <TableCell>
                      {formatHoursMinutes(session.otHours ?? null)}
                    </TableCell>
                    <TableCell>
                      {session.amountRM !== null
                        ? formatCurrencyRM(session.amountRM)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {session.isAbnormal ? (
                        <Badge variant="destructive">Abnormal</Badge>
                      ) : session.status === "complete" ? (
                        <Badge variant="success">Complete</Badge>
                      ) : (
                        <Badge variant="secondary">Incomplete</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {totalCount !== null
                ? `Total matches: ${totalCount}`
                : "Calculating total..."}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">Rows</span>
                <Select
                  value={String(sessionPageSize)}
                  onValueChange={(value) => {
                    const numeric = Number(value);
                    setSessionPageSize(Number.isNaN(numeric) ? 30 : numeric);
                    resetPagination();
                  }}
                >
                  <SelectTrigger className="h-9 w-[88px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
              >
                Prev
              </Button>
              <span className="text-sm text-slate-500">Page {pageIndex + 1}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((prev) => prev + 1)}
                disabled={!hasNext}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={recomputeDialogOpen}
        onOpenChange={(open) => {
          setRecomputeDialogOpen(open);
          if (!open) {
            setRecomputeStatus(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recompute Sessions</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={recomputeStart}
                  onChange={(event) => setRecomputeStart(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={recomputeEnd}
                  onChange={(event) => setRecomputeEnd(event.target.value)}
                />
              </div>
            </div>
            {recomputeStatus ? (
              <p className="text-sm text-slate-500">{recomputeStatus}</p>
            ) : null}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setRecomputeDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={recomputeSessions}>Recompute</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type UserFormState = {
  name: string;
  email: string;
  position: string;
  employeeId: string;
  normalRate: string;
  otRate: string;
  tempPassword: string;
};

const emptyUserForm: UserFormState = {
  name: "",
  email: "",
  position: "",
  employeeId: "",
  normalRate: "",
  otRate: "",
  tempPassword: "",
};

function UsersPanel({
  users,
  onRefresh,
}: {
  users: UserProfile[];
  onRefresh: () => Promise<void>;
  }) {
    const [search, setSearch] = useState("");
    const [pageSize, setPageSize] = useState<number>(30);
    const [pageIndex, setPageIndex] = useState(0);
    const [sortKey, setSortKey] = useState<keyof Pick<
      UserProfile,
      "name" | "email" | "position" | "employeeId" | "normalRate" | "otRate"
    >>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyUserForm);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  const activeUsers = useMemo(
    () => users.filter((user) => !user.isDeleted),
    [users],
  );

  const searchToken = search.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!searchToken) return activeUsers;
    return activeUsers.filter((user) => {
      const name = user.name?.toLowerCase() ?? "";
      const email = user.email?.toLowerCase() ?? "";
      const employeeId = user.employeeId?.toLowerCase() ?? "";
      return (
        name.includes(searchToken) ||
        email.includes(searchToken) ||
        employeeId.includes(searchToken)
      );
    });
  }, [activeUsers, searchToken]);

    const sortedUsers = useMemo(() => {
      const sorted = [...filteredUsers];
      sorted.sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (typeof aValue === "number" || typeof bValue === "number") {
        const aNum = typeof aValue === "number" ? aValue : 0;
        const bNum = typeof bValue === "number" ? bValue : 0;
        return sortDir === "asc" ? aNum - bNum : bNum - aNum;
      }
      const aStr = String(aValue ?? "").toLowerCase();
      const bStr = String(bValue ?? "").toLowerCase();
      return sortDir === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
      return sorted;
    }, [filteredUsers, sortKey, sortDir]);

    const pageCount = Math.max(1, Math.ceil(sortedUsers.length / pageSize));
    const pagedUsers = useMemo(() => {
      const start = pageIndex * pageSize;
      return sortedUsers.slice(start, start + pageSize);
    }, [sortedUsers, pageIndex, pageSize]);

    useEffect(() => {
      setPageIndex(0);
    }, [searchToken, sortKey, sortDir, pageSize]);

    useEffect(() => {
      if (pageIndex >= pageCount) {
        setPageIndex(Math.max(0, pageCount - 1));
      }
    }, [pageCount, pageIndex]);

  const toggleSort = (
    key: keyof Pick<
      UserProfile,
      "name" | "email" | "position" | "employeeId" | "normalRate" | "otRate"
    >,
  ) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyUserForm);
    setStatus(null);
    setDialogOpen(true);
  };

  const openEdit = (user: UserProfile) => {
    setEditingUser(user);
    setForm({
      name: user.name ?? "",
      email: user.email ?? "",
      position: user.position ?? "",
      employeeId: user.employeeId ?? "",
      normalRate:
        typeof user.normalRate === "number" ? user.normalRate.toString() : "",
      otRate: typeof user.otRate === "number" ? user.otRate.toString() : "",
      tempPassword: "",
    });
    setStatus(null);
    setResetStatus(null);
    setDialogOpen(true);
  };

  const openDelete = (user: UserProfile) => {
    setDeleteTarget(user);
    setDeleteOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    setStatus(null);
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const employeeId = form.employeeId.trim();
    const normalRate = Number(form.normalRate);
    const otRate = Number(form.otRate);

    if (!name || !email || !employeeId) {
      setStatus("Name, email, and employee ID are required.");
      return;
    }
    if (Number.isNaN(normalRate) || normalRate < 0) {
      setStatus("Normal rate must be a valid number.");
      return;
    }
    if (Number.isNaN(otRate) || otRate < 0) {
      setStatus("OT rate must be a valid number.");
      return;
    }
    const duplicateEmployeeId = activeUsers.find(
      (user) =>
        user.employeeId?.toLowerCase() === employeeId.toLowerCase() &&
        user.uid !== editingUser?.uid,
    );
    if (duplicateEmployeeId) {
      setStatus("Employee ID must be unique.");
      return;
    }

    setSaving(true);
    try {
      if (!editingUser) {
        const createUser = httpsCallable(functions, "adminCreateUser");
        await createUser({
          name,
          email,
          position: form.position.trim(),
          employeeId,
          normalRate,
          otRate,
          tempPassword: form.tempPassword.trim(),
        });
      } else {
        await updateDoc(doc(db, "users", editingUser.uid), {
          name,
          position: form.position.trim(),
          employeeId,
          normalRate,
          otRate,
          updatedAt: serverTimestamp(),
        });
      }
      setDialogOpen(false);
      setResetStatus(null);
      await onRefresh();
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        const code = (err as { code?: string }).code;
        const message = (err as { message?: string }).message ?? "";
        if (
          code === "already-exists" ||
          code === "auth/email-already-exists" ||
          /email.*already/i.test(message) ||
          /auth\/email-already-exists/i.test(message)
        ) {
          setStatus("Email already exists.");
          return;
        }
      }
      setStatus(err instanceof Error ? err.message : "Unable to save user.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setStatus(null);
    try {
      const deleteUser = httpsCallable(functions, "adminDeleteUser");
      await deleteUser({ uid: deleteTarget.uid, email: deleteTarget.email });
      await updateDoc(doc(db, "users", deleteTarget.uid), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
      });
      setDeleteOpen(false);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: unknown) {
      setStatus(
        err instanceof Error ? err.message : "Unable to delete user.",
      );
    }
  };

  const handleResetPassword = async (email: string) => {
    setResetStatus(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetStatus(`Password reset email sent to ${email}.`);
    } catch (err: unknown) {
      setResetStatus(
        err instanceof Error ? err.message : "Unable to send reset email.",
      );
    }
  };

  const sortIndicator = (key: typeof sortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Users</CardTitle>
        <Button onClick={openCreate}>+ Add User</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Search</Label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="name, email, or employee ID"
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button type="button" onClick={() => toggleSort("name")}>
                  <span className="inline-flex items-center gap-1">
                    Name {sortIndicator("name")}
                  </span>
                </button>
              </TableHead>
              <TableHead>
                <button type="button" onClick={() => toggleSort("email")}>
                  <span className="inline-flex items-center gap-1">
                    Email {sortIndicator("email")}
                  </span>
                </button>
              </TableHead>
              <TableHead>
                <button type="button" onClick={() => toggleSort("position")}>
                  <span className="inline-flex items-center gap-1">
                    Position {sortIndicator("position")}
                  </span>
                </button>
              </TableHead>
              <TableHead>
                <button type="button" onClick={() => toggleSort("employeeId")}>
                  <span className="inline-flex items-center gap-1">
                    Employee ID {sortIndicator("employeeId")}
                  </span>
                </button>
              </TableHead>
              <TableHead>
                <button type="button" onClick={() => toggleSort("normalRate")}>
                  <span className="inline-flex items-center gap-1">
                    Normal {sortIndicator("normalRate")}
                  </span>
                </button>
              </TableHead>
              <TableHead>
                <button type="button" onClick={() => toggleSort("otRate")}>
                  <span className="inline-flex items-center gap-1">
                    OT {sortIndicator("otRate")}
                  </span>
                </button>
              </TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>No users found.</TableCell>
              </TableRow>
            ) : (
              pagedUsers.map((user) => (
                <TableRow key={user.uid}>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.position ?? "-"}</TableCell>
                  <TableCell>{user.employeeId ?? "-"}</TableCell>
                  <TableCell>
                    {typeof user.normalRate === "number"
                      ? user.normalRate.toFixed(2)
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {typeof user.otRate === "number"
                      ? user.otRate.toFixed(2)
                      : "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(user)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => openDelete(user)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {sortedUsers.length > 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">Total users: {sortedUsers.length}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-sm text-slate-500">Rows</span>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  const next = Number(value);
                  setPageSize(Number.isNaN(next) ? 30 : next);
                }}
              >
                <SelectTrigger className="h-9 w-[88px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
              >
                Prev
              </Button>
              <span className="text-sm text-slate-500">Page {pageIndex + 1}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPageIndex((prev) => Math.min(prev + 1, pageCount - 1))
                }
                disabled={pageIndex + 1 >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {resetStatus ? (
              <p className="text-sm text-slate-500">{resetStatus}</p>
            ) : null}
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={form.email}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
                readOnly={Boolean(editingUser)}
                className={editingUser ? "bg-slate-50" : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label>Position</Label>
              <Input
                value={form.position}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, position: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Employee ID</Label>
              <Input
                value={form.employeeId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    employeeId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Normal Rate (RM)</Label>
                <Input
                  value={form.normalRate}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      normalRate: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>OT Rate (RM)</Label>
                <Input
                  value={form.otRate}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      otRate: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {!editingUser ? (
              <div className="space-y-2">
                <Label>Temp Password</Label>
                <Input
                  value={form.tempPassword}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      tempPassword: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
            {status ? (
              <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {status}
              </p>
            ) : null}
          </div>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setResetStatus(null);
              }}
            >
              Cancel
            </Button>
            {editingUser ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">Reset Password</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Send password reset?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Send a reset link to {editingUser.email}?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>No</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleResetPassword(editingUser.email)}
                    >
                      Yes
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the user account and hide the profile from the list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

  function LatePanel() {
    const [sessions, setSessions] = useState<AttendanceSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [dateFilter, setDateFilter] = useState("");
    const [pageSize, setPageSize] = useState<number>(30);
    const [pageIndex, setPageIndex] = useState(0);
    const [editing, setEditing] = useState<AttendanceSession | null>(null);
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [lateBuffer, setLateBuffer] = useState<number | null>(null);

  useEffect(() => {
    const loadLateBuffer = async () => {
      const { lateBufferMinutes } = await getBufferSettings();
      setLateBuffer(lateBufferMinutes);
    };
    loadLateBuffer();
  }, []);

  useEffect(() => {
    const loadLate = async () => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await getDocs(
          query(
            collection(db, "attendanceSessions"),
            where("isLate", "==", true),
            orderBy("checkInTime", "desc"),
          ),
        );
        const items = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<AttendanceSession, "id">),
        }));
        setSessions(items);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to load late sessions.");
        setSessions([]);
      } finally {
        setLoading(false);
      }
    };
    loadLate();
  }, []);

  const filtered = useMemo(() => {
    const token = search.trim().toLowerCase();
    return sessions.filter((session) => {
      if (dateFilter && session.dateKey !== dateFilter) return false;
      if (!token) return true;
      return (
        session.userName.toLowerCase().includes(token) ||
        session.userEmail.toLowerCase().includes(token)
      );
    });
  }, [sessions, search, dateFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedSessions = useMemo(() => {
    const start = pageIndex * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, pageIndex, pageSize]);

  useEffect(() => {
    setPageIndex(0);
  }, [search, dateFilter, pageSize]);

  useEffect(() => {
    if (pageIndex >= pageCount) {
      setPageIndex(Math.max(0, pageCount - 1));
    }
  }, [pageCount, pageIndex]);

  const openEdit = (session: AttendanceSession) => {
    setEditing(session);
    setReason(session.lateNote ?? "");
  };

  const handleSaveReason = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "attendanceSessions", editing.id), {
        lateNote: reason.trim(),
      });
      setSessions((prev) =>
        prev.map((item) =>
          item.id === editing.id ? { ...item, lateNote: reason.trim() } : item,
        ),
      );
      setEditing(null);
      setReason("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to save reason.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Late</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="name or email"
            />
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
            />
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading late sessions...</p>
        ) : error ? (
          <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500">No late records found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Buffer</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
              </TableHeader>
              <TableBody>
                {pagedSessions.map((session) => (
                  <TableRow key={session.id}>
                  <TableCell>{session.userName}</TableCell>
                  <TableCell>{session.userEmail}</TableCell>
                  <TableCell>{formatDateKeyLabel(session.dateKey)}</TableCell>
                  <TableCell>
                    {session.checkInTime
                      ? format(session.checkInTime.toDate(), "p")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {lateBuffer !== null ? `${lateBuffer} min` : "-"}
                  </TableCell>
                  <TableCell>
                    {session.lateNote ?? session.lateReason ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => openEdit(session)}
                      aria-label="Edit reason"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {filtered.length > 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">Total matches: {filtered.length}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-sm text-slate-500">Rows</span>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  const next = Number(value);
                  setPageSize(Number.isNaN(next) ? 30 : next);
                }}
              >
                <SelectTrigger className="h-9 w-[88px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
              >
                Prev
              </Button>
              <span className="text-sm text-slate-500">Page {pageIndex + 1}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPageIndex((prev) => Math.min(prev + 1, pageCount - 1))
                }
                disabled={pageIndex + 1 >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Late Reason</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveReason} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AbnormalPanel() {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [pageSize, setPageSize] = useState<number>(30);
  const [pageIndex, setPageIndex] = useState(0);
  const [editing, setEditing] = useState<AttendanceSession | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadAbnormal = async () => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await getDocs(
          query(
            collection(db, "attendanceSessions"),
            where("isAbnormal", "==", true),
            orderBy("checkInTime", "desc"),
          ),
        );
        const items = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<AttendanceSession, "id">),
        }));
        setSessions(items);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Unable to load abnormal sessions.",
        );
        setSessions([]);
      } finally {
        setLoading(false);
      }
    };
    loadAbnormal();
  }, []);

  const filtered = useMemo(() => {
    const token = search.trim().toLowerCase();
    return sessions.filter((session) => {
      if (dateFilter && session.dateKey !== dateFilter) return false;
      if (!token) return true;
      return (
        session.userName.toLowerCase().includes(token) ||
        session.userEmail.toLowerCase().includes(token)
      );
    });
  }, [sessions, search, dateFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedSessions = useMemo(() => {
    const start = pageIndex * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, pageIndex, pageSize]);

  useEffect(() => {
    setPageIndex(0);
  }, [search, dateFilter, pageSize]);

  useEffect(() => {
    if (pageIndex >= pageCount) {
      setPageIndex(Math.max(0, pageCount - 1));
    }
  }, [pageCount, pageIndex]);

  const openEdit = (session: AttendanceSession) => {
    setEditing(session);
    setReason(session.abnormalNote ?? "");
  };

  const handleSaveReason = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "attendanceSessions", editing.id), {
        abnormalNote: reason.trim(),
      });
      setSessions((prev) =>
        prev.map((item) =>
          item.id === editing.id
            ? { ...item, abnormalNote: reason.trim() }
            : item,
        ),
      );
      setEditing(null);
      setReason("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to save reason.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Abnormal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="name or email"
            />
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
            />
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading abnormal sessions...</p>
        ) : error ? (
          <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500">No abnormal records found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Check-out</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
              </TableHeader>
              <TableBody>
                {pagedSessions.map((session) => (
                  <TableRow key={session.id}>
                  <TableCell>{session.userName}</TableCell>
                  <TableCell>{session.userEmail}</TableCell>
                  <TableCell>{formatDateKeyLabel(session.dateKey)}</TableCell>
                  <TableCell>
                    {session.checkInTime
                      ? format(session.checkInTime.toDate(), "p")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {session.checkOutTime
                      ? format(session.checkOutTime.toDate(), "p")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {session.abnormalNote ??
                      (session.abnormalReasons?.length
                        ? session.abnormalReasons.join(", ")
                        : "-")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => openEdit(session)}
                      aria-label="Edit reason"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {filtered.length > 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">Total matches: {filtered.length}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-sm text-slate-500">Rows</span>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  const next = Number(value);
                  setPageSize(Number.isNaN(next) ? 30 : next);
                }}
              >
                <SelectTrigger className="h-9 w-[88px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
              >
                Prev
              </Button>
              <span className="text-sm text-slate-500">Page {pageIndex + 1}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPageIndex((prev) => Math.min(prev + 1, pageCount - 1))
                }
                disabled={pageIndex + 1 >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Abnormal Reason</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveReason} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function MaintenancePanel() {
  const [lateBuffer, setLateBuffer] = useState("");
  const [earlyCheckoutBuffer, setEarlyCheckoutBuffer] = useState("");
  const [otEarlyBuffer, setOtEarlyBuffer] = useState("");
  const [otLateBuffer, setOtLateBuffer] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      const docRef = doc(db, "settings", "global");
      const snapshot = await getDoc(docRef);
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (typeof data?.lateBufferMinutes === "number") {
          setLateBuffer(data.lateBufferMinutes.toString());
        } else {
          setLateBuffer(DEFAULT_BUFFER_SETTINGS.lateBufferMinutes.toString());
        }
        if (typeof data?.earlyCheckoutBufferMinutes === "number") {
          setEarlyCheckoutBuffer(data.earlyCheckoutBufferMinutes.toString());
        } else {
          setEarlyCheckoutBuffer(
            DEFAULT_BUFFER_SETTINGS.earlyCheckoutBufferMinutes.toString(),
          );
        }
        if (typeof data?.otEarlyBufferMinutes === "number") {
          setOtEarlyBuffer(data.otEarlyBufferMinutes.toString());
        } else {
          setOtEarlyBuffer(DEFAULT_BUFFER_SETTINGS.otEarlyBufferMinutes.toString());
        }
        if (typeof data?.otLateBufferMinutes === "number") {
          setOtLateBuffer(data.otLateBufferMinutes.toString());
        } else {
          setOtLateBuffer(DEFAULT_BUFFER_SETTINGS.otLateBufferMinutes.toString());
        }
      } else {
        setLateBuffer(DEFAULT_BUFFER_SETTINGS.lateBufferMinutes.toString());
        setEarlyCheckoutBuffer(
          DEFAULT_BUFFER_SETTINGS.earlyCheckoutBufferMinutes.toString(),
        );
        setOtEarlyBuffer(DEFAULT_BUFFER_SETTINGS.otEarlyBufferMinutes.toString());
        setOtLateBuffer(DEFAULT_BUFFER_SETTINGS.otLateBufferMinutes.toString());
      }
      setLoading(false);
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    const lateValue = Number(lateBuffer);
    const earlyValue = Number(earlyCheckoutBuffer);
    const otEarlyValue = Number(otEarlyBuffer);
    const otLateValue = Number(otLateBuffer);
    if (
      [lateValue, earlyValue, otEarlyValue, otLateValue].some(
        (value) => Number.isNaN(value) || value < 0,
      )
    ) {
      setStatus("All buffer values must be 0 or a positive number.");
      return;
    }
    setSaving(true);
    setStatus(null);
    await setDoc(
      doc(db, "settings", "global"),
      {
        lateBufferMinutes: lateValue,
        earlyCheckoutBufferMinutes: earlyValue,
        otEarlyBufferMinutes: otEarlyValue,
        otLateBufferMinutes: otLateValue,
      },
      { merge: true },
    );
    setSaving(false);
    setStatus("Buffers saved.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-slate-500">Loading settings...</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Late Buffer Minutes</Label>
              <Input
                value={lateBuffer}
                onChange={(event) => setLateBuffer(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Early Check-out Buffer (5pm)</Label>
              <Input
                value={earlyCheckoutBuffer}
                onChange={(event) => setEarlyCheckoutBuffer(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>OT Early Check-out Buffer Minutes (10pm)</Label>
              <Input
                value={otEarlyBuffer}
                onChange={(event) => setOtEarlyBuffer(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>OT Late Check-out Buffer Minutes (10pm)</Label>
              <Input
                value={otLateBuffer}
                onChange={(event) => setOtLateBuffer(event.target.value)}
              />
            </div>
          </>
        )}
        {status ? (
          <p className="text-sm text-slate-500">{status}</p>
        ) : null}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

