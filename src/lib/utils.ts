import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeSiteName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildPrefixes(value: string) {
  const normalized = value.trim().toLowerCase();
  const parts = normalized.split(/[\s@._-]+/).filter(Boolean);
  const prefixes = new Set<string>();

  const condensed = normalized.replace(/\s+/g, "");
  if (condensed) {
    for (let i = 1; i <= condensed.length; i += 1) {
      prefixes.add(condensed.slice(0, i));
    }
  }

  parts.forEach((part) => {
    for (let i = 1; i <= part.length; i += 1) {
      prefixes.add(part.slice(0, i));
    }
  });

  return [...prefixes];
}

export function buildSearchPrefixes(values: string[]) {
  const prefixes = new Set<string>();

  values.forEach((value) => {
    buildPrefixes(value).forEach((prefix) => prefixes.add(prefix));
  });

  return [...prefixes];
}

export function getDayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function formatPhone(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+60")) return trimmed;
  if (trimmed.startsWith("60")) return `+${trimmed}`;
  if (trimmed.startsWith("0")) {
    return `+60${trimmed.replace(/^0+/, "")}`;
  }
  return `+60${trimmed}`;
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

export function getDateKey(date = new Date(), timeZone = "Asia/Kuala_Lumpur") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export function getTimeMinutes(date: Date, timeZone = "Asia/Kuala_Lumpur") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
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
  const hour = Number(values.hour ?? "0");
  const minute = Number(values.minute ?? "0");
  return hour * 60 + minute;
}

export function formatHoursMinutes(hours: number | null) {
  if (hours === null || Number.isNaN(hours)) return "-";
  const totalMinutes = Math.round(hours * 60);
  const displayHours = Math.floor(totalMinutes / 60);
  const displayMinutes = totalMinutes % 60;
  return `${displayHours.toString().padStart(2, "0")}:${displayMinutes
    .toString()
    .padStart(2, "0")}`;
}

export function formatCurrencyRM(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
