import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { LocateFixed } from "lucide-react";
import { format } from "date-fns";
import L from "leaflet";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { PageHeader } from "../components/layout/PageHeader";
import type { AttendanceLog } from "../types";

const markerIconInstance = new L.Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export function UserDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, logout } = useAuth();
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  const statusMessage = useMemo(() => {
    if (!location.state || typeof location.state !== "object") return null;
    const state = location.state as { status?: "success" | "error"; message?: string };
    if (!state.message) return null;
    return state;
  }, [location.state]);

  const requestPosition = () => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by this browser.");
      return;
    }
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setGeoError("Unable to retrieve your location.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  useEffect(() => {
    let isMounted = true;
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!isMounted) return;
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        if (!isMounted) return;
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "GPS permission denied. Enable location access."
            : "Unable to retrieve your location.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!position || !mapRef.current) return;
    mapRef.current.setView(
      [position.lat, position.lng],
      mapRef.current.getZoom(),
    );
  }, [position]);

  useEffect(() => {
    let isMounted = true;
    const fetchLogs = async () => {
      if (!user) return;
      setLoading(true);
      setLogsError(null);
      const logsQuery = query(
        collection(db, "attendance"),
        where("userId", "==", user.uid),
        where("status", "==", "success"),
        orderBy("scanTime", "desc"),
        limit(10),
      );
      try {
        const snapshot = await getDocs(logsQuery);
        if (!isMounted) return;
        const items = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<AttendanceLog, "id">),
          }))
          .filter((log) => !log.isDeleted);
        setLogs(items);
        setLoading(false);
      } catch (err: unknown) {
        if (!isMounted) return;
        setLogs([]);
        setLoading(false);
        let message = "Unable to load attendance history.";
        if (err && typeof err === "object") {
          const code = (err as { code?: string }).code;
          const errMessage = (err as { message?: string }).message;
          if (code === "failed-precondition" || /index/i.test(errMessage ?? "")) {
            message = "Missing Firestore index. Please contact admin.";
          } else if (code === "permission-denied") {
            message = "Permission denied. Please contact admin.";
          } else if (errMessage) {
            message = errMessage;
          }
        }
        setLogsError(message);
      }
    };
    fetchLogs();
    return () => {
      isMounted = false;
    };
  }, [user]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="User Dashboard"
        action={
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300"
            aria-label="Open account menu"
          >
            {profile?.name
              ? profile.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
              : "U"}
          </button>
        }
      />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 fade-in-up">
        {statusMessage ? (
          <Alert
            className={
              statusMessage.status === "success"
                ? "border-emerald-200 bg-emerald-50"
                : "border-red-200 bg-red-50"
            }
          >
            {/* <AlertTitle>
              {statusMessage.status === "success"
                ? "Check-in recorded"
                : "Check-in failed"}
            </AlertTitle> */}
            <AlertTitle>{statusMessage.message}</AlertTitle>
          </Alert>
        ) : null}

        {/* <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Quick Actions</CardTitle> */}
            <Button
              onClick={() =>
                navigate("/scanner", { state: { from: "/user" } })
              }
            >
              Open Scanner
            </Button>
          {/* </CardHeader>
        </Card> */}

        <Card>
          <CardHeader>
            <CardTitle>Current Site</CardTitle>
          </CardHeader>
          <CardContent>
            {geoError ? (
              <p className="text-sm text-red-600">{geoError}</p>
            ) : null}
            <div className="relative h-72 overflow-hidden rounded-lg border border-slate-200">
              {position ? (
                <MapContainer
                  center={[position.lat, position.lng]}
                  zoom={16}
                  scrollWheelZoom={false}
                  style={{ height: "100%", width: "100%" }}
                  ref={mapRef}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker
                    position={[position.lat, position.lng]}
                    icon={markerIconInstance}
                  />
                </MapContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Waiting for GPS signal...
                </div>
              )}
              <button
                type="button"
                onClick={requestPosition}
                className="absolute bottom-3 right-3 z-[500] flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
                aria-label="Re-center map"
                title="Re-center"
              >
                <LocateFixed className="h-4 w-4" />
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Check-ins & Check-outs</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-slate-500">Loading attendance...</p>
            ) : logsError ? (
              <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {logsError}
              </p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-slate-500">
                No successful check-ins yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        {format(log.scanTime.toDate(), "dd-MMM-yy")}
                      </TableCell>
                      <TableCell>
                        {format(log.scanTime.toDate(), "p")}
                      </TableCell>
                      <TableCell>{log.siteName}</TableCell>
                      <TableCell>
                        {log.scanType === "check-out" ? (
                          <Badge variant="secondary">Out</Badge>
                        ) : (
                          <Badge variant="success">In</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      {drawerOpen ? (
        <div className="fixed inset-0 z-[9999]">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close drawer"
          />
          <aside className="absolute right-0 top-0 h-full w-3/4 max-w-sm bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {profile?.name
                    ? profile.name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()
                    : "U"}
                </div>
                <div>
                  <p className="text-sm text-slate-500">Logged in as</p>
                  <p className="text-base font-semibold text-slate-900">
                    {profile?.name ?? "User"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Close
              </button>
            </div>
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Last login
              </p>
              <p className="text-sm font-medium text-slate-700">
                {profile?.lastLoginAt
                  ? format(profile.lastLoginAt.toDate(), "PPpp")
                  : "Unknown"}
              </p>
            </div>
            <div className="mt-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setDrawerOpen(false);
                  navigate("/sessions");
                }}
              >
                Recent Sessions
              </Button>
            </div>
            <div className="mt-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setDrawerOpen(false);
                  navigate("/reset-password");
                }}
              >
                Reset Password
              </Button>
            </div>
            <div className="mt-6">
              <Button className="w-full" onClick={logout}>
                Logout
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

