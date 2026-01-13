import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
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

const SESSION_PAGE_SIZE = 10;

export function RecentSessionsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [locations, setLocations] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [siteInFilter, setSiteInFilter] = useState("all");
  const [siteOutFilter, setSiteOutFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);

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

      const constraints: any[] = [where("userId", "==", user.uid)];

      if (siteInFilter !== "all") {
        constraints.push(where("siteInId", "==", siteInFilter));
      }
      if (siteOutFilter !== "all") {
        constraints.push(where("siteOutId", "==", siteOutFilter));
      }
      if (statusFilter === "complete") {
        constraints.push(where("status", "==", "complete"));
      } else if (statusFilter === "abnormal") {
        constraints.push(where("isAbnormal", "==", true));
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
      constraints.push(orderBy("checkInTime", "desc"));

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
  }, [user, dateStart, dateEnd, siteInFilter, siteOutFilter, statusFilter]);

  const pageCount = Math.max(
    1,
    Math.ceil(sessions.length / SESSION_PAGE_SIZE),
  );
  const pagedSessions = useMemo(() => {
    const start = pageIndex * SESSION_PAGE_SIZE;
    return sessions.slice(start, start + SESSION_PAGE_SIZE);
  }, [sessions, pageIndex]);

  useEffect(() => {
    setPageIndex(0);
  }, [dateStart, dateEnd, siteInFilter, siteOutFilter, statusFilter]);

  useEffect(() => {
    if (pageIndex >= pageCount) {
      setPageIndex(Math.max(0, pageCount - 1));
    }
  }, [pageCount, pageIndex]);

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
              <Label>Site-in</Label>
              <div className="sm:hidden">
                <select
                  value={siteInFilter}
                  onChange={(event) => setSiteInFilter(event.target.value)}
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
                  value={siteInFilter}
                  onValueChange={setSiteInFilter}
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
              <Label>Site-out</Label>
              <div className="sm:hidden">
                <select
                  value={siteOutFilter}
                  onChange={(event) => setSiteOutFilter(event.target.value)}
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
                  value={siteOutFilter}
                  onValueChange={setSiteOutFilter}
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
                  <option value="abnormal">Abnormal</option>
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
                    <SelectItem value="abnormal">Abnormal</SelectItem>
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
                  setSiteInFilter("all");
                  setSiteOutFilter("all");
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
                    <TableHead>Date</TableHead>
                    <TableHead>Site-in</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Site-out</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead>Total Hours</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedSessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>
                        {session.checkInTime
                          ? format(session.checkInTime.toDate(), "PP")
                          : session.dateKey ?? "-"}
                      </TableCell>
                      <TableCell>
                        {session.siteInName ?? session.siteName ?? "-"}
                      </TableCell>
                      <TableCell>
                        {session.checkInTime
                          ? format(session.checkInTime.toDate(), "p")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {session.siteOutName ?? session.siteName ?? "-"}
                      </TableCell>
                      <TableCell>
                        {session.checkOutTime
                          ? format(session.checkOutTime.toDate(), "p")
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
            {sessions.length > 0 ? (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  Total sessions: {sessions.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                    disabled={pageIndex === 0}
                  >
                    Prev
                  </Button>
                  <span className="text-sm text-slate-500">
                    Page {pageIndex + 1} of {pageCount}
                  </span>
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
        </Card>
      </main>
    </div>
  );
}

