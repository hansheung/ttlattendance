import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { format } from "date-fns";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { formatCurrencyRM, formatHoursMinutes } from "../lib/utils";
import type { AttendanceSession, SiteItem } from "../types";

export function RecentSessionsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [locations, setLocations] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const snapshot = await getDocs(
          query(collection(db, "sites"), orderBy("name", "asc")),
        );
        const items = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<SiteItem, "id">),
        }));
        setLocations(items);
      } catch {
        setLocations([]);
      }
    };
    fetchLocations();
  }, []);

  useEffect(() => {
    const fetchSessions = async () => {
      if (!user) return;
      setLoading(true);
      setError(null);

      const constraints: any[] = [
        where("userId", "==", user.uid),
        orderBy("checkInTime", "desc"),
      ];

      if (locationFilter !== "all") {
        constraints.push(where("siteId", "==", locationFilter));
      }
      if (statusFilter !== "all") {
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

      try {
        const snapshot = await getDocs(
          query(collection(db, "attendanceSessions"), ...constraints),
        );
        const items = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<AttendanceSession, "id">),
        }));
        setSessions(items);
      } catch (err: unknown) {
        setSessions([]);
        setError(
          err instanceof Error ? err.message : "Unable to load sessions.",
        );
      } finally {
        setLoading(false);
      }
    };
    fetchSessions();
  }, [user, dateStart, dateEnd, locationFilter, statusFilter]);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Recent Sessions"
        action={
          <Button variant="outline" onClick={() => navigate("/user")}>
            Back
          </Button>
        }
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 fade-in-up">
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-6">
            <div className="space-y-2">
              <Label>Site</Label>
              <div className="sm:hidden">
                <select
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
                >
                  <option value="all">All</option>
                  {locations.map((locationItem) => (
                    <option key={locationItem.id} value={locationItem.id}>
                      {locationItem.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="hidden sm:block">
                <Select
                  value={locationFilter}
                  onValueChange={setLocationFilter}
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
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <div className="sm:hidden">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
                >
                  <option value="all">All</option>
                  <option value="complete">Complete</option>
                  <option value="incomplete">Incomplete</option>
                </select>
              </div>
              <div className="hidden sm:block">
                <Select
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                    <SelectItem value="incomplete">Incomplete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Start date</Label>
              <Input
                type="date"
                value={dateStart}
                onChange={(event) => setDateStart(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>End date</Label>
              <Input
                type="date"
                value={dateEnd}
                onChange={(event) => setDateEnd(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setLocationFilter("all");
                  setStatusFilter("all");
                  setDateStart("");
                  setDateEnd("");
                }}
              >
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session History</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-slate-500">Loading sessions...</p>
            ) : error ? (
              <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-slate-500">No sessions found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>
                        {session.siteInName ??
                          session.siteName ??
                          "-"}
                      </TableCell>
                      <TableCell>
                        {session.checkInTime
                          ? format(session.checkInTime.toDate(), "PPpp")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {session.checkOutTime
                          ? format(session.checkOutTime.toDate(), "PPpp")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {formatHoursMinutes(session.totalHours ?? null)}
                      </TableCell>
                      <TableCell>
                        {session.amountRM !== null
                          ? formatCurrencyRM(session.amountRM)
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {session.status === "complete" ? (
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
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

